/**
 * The pull request title gate, pinned to the type list it is meant to
 * enforce.
 *
 * Three files are involved and no two of them are in the same language.
 * conventional-types.json and the workflow hold the same type list, and
 * infra/github/main.tf names the check run that list has to arrive on.
 * Nothing makes any of them agree, and every drift is silent.
 *
 * A gate missing a type red-lights a title that would have released
 * correctly; a gate carrying an extra one lets a commit onto master that the
 * changelog then omits without a word. And a required context naming a check
 * nothing produces is worse than either: GitHub leaves it "expected" forever,
 * every pull request blocks, and the fix is someone applying the OpenTofu
 * stack by hand. Hence a test rather than a comment.
 *
 * The `paths:` filters belong here for the same reason from the other side.
 * A filtered workflow reports no check run rather than a skipped one, so a
 * filter and a required context are a pair that must never both name a job;
 * and test.yml's filter reaches back into infra/, because this file reads the
 * ruleset out of infra/github/main.tf and so the OpenTofu stack is an input
 * to the suite that guards it. Both directions of that are pinned below.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { RECOGNIZED_TYPES } from "./conventional.js";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const source = read("../.github/workflows/pr-title-check.yml");
const ruleset = read("../infra/github/main.tf");

interface Step {
  uses?: string;
  with?: Record<string, string>;
}

const workflow = parse(source) as {
  on: { pull_request: { types: string[] } };
  jobs: Record<string, { steps: Step[] } | undefined>;
};

const step = workflow.jobs["validate-title"]?.steps.find((s) =>
  s.uses?.startsWith("amannn/action-semantic-pull-request@"),
);

/** gateTypes are the types the workflow allows, parsed the way the action
 * itself parses them: split on newlines, trimmed, blanks dropped. */
const gateTypes = (step?.with?.types ?? "")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "");

/** Filters is the path gating GitHub applies to one event. The two keys are
 * mutually exclusive per event, and either of them withholds a check run. */
interface Filters {
  paths?: string[];
  "paths-ignore"?: string[];
}

interface Workflow {
  on?: { pull_request?: Filters | null; push?: Filters | null };
  jobs?: Record<string, { name?: string } | undefined>;
}

/** workflows are every file in .github/workflows, parsed, each with the name
 * it was read from so a failure says which one. */
function workflows(): { file: string; wf: Workflow }[] {
  const dir = new URL("../.github/workflows/", import.meta.url);
  return readdirSync(dir).map((file) => ({
    file,
    wf: parse(readFileSync(new URL(file, dir), "utf8")) as Workflow,
  }));
}

/** filtered says whether a pull request can fail to start this workflow. */
function filtered(wf: Workflow): boolean {
  const pr = wf.on?.pull_request;
  return Boolean(pr?.paths ?? pr?.["paths-ignore"]);
}

/** checkRunNames are the names a workflow's jobs report under: a job's `name:`
 * when it declares one, and its job id otherwise. */
function checkRunNames(wf: Workflow): string[] {
  return Object.entries(wf.jobs ?? {}).map(([id, job]) => job?.name ?? id);
}

/** requiredContexts are the check runs the master ruleset will not merge
 * without. */
function requiredContexts(): string[] {
  return [...ruleset.matchAll(/context\s*=\s*"([^"]+)"/g)].map(
    (m) => m[1] as string,
  );
}

describe("the pull request title gate", () => {
  it("runs the type check", () => {
    expect(step).toBeDefined();
  });

  it("allows every type release-please recognizes", () => {
    for (const type of RECOGNIZED_TYPES) expect(gateTypes).toContain(type);
  });

  it("allows nothing else", () => {
    // The Angular list the enforcing action defaults to is what this guards
    // against in the other direction, and it is a near-miss rather than a
    // wild one: it omits `feature`, which release-please treats as a synonym
    // for `feat`. A gate that has quietly reverted to a default would fail
    // here on that one word.
    for (const type of gateTypes) expect(RECOGNIZED_TYPES.has(type)).toBe(true);
  });

  it("carries each type once", () => {
    expect(gateTypes.length).toBe(new Set(gateTypes).size);
  });

  it("holds no comment lines inside the list", () => {
    // The action does no comment handling: a `#` line inside the block
    // becomes a type of its own, matching nothing and printed back to the
    // contributor in the "Available types" list on failure.
    for (const type of gateTypes) expect(type.startsWith("#")).toBe(false);
  });

  it("re-runs on a push, so the answer describes the head commit", () => {
    // A push cannot change a title, but a status check is resolved per head
    // SHA. Without this the check reports against a commit that is no longer
    // the one merging.
    expect(workflow.on.pull_request.types).toContain("synchronize");
  });

  it("is the check the master ruleset requires", () => {
    // A required context is a check-run *name*, which for an Actions job is
    // its `name:` when it has one and its job id otherwise. This job has no
    // `name:`, so the job id below and the string in main.tf are one pair
    // spanning two files in two languages.
    expect(Object.keys(workflow.jobs)).toContain("validate-title");
    expect(ruleset).toMatch(
      /required_check\s*\{\s*context\s*=\s*"validate-title"/,
    );
  });

  it("names no required context no job here produces", () => {
    // The same pair, checked from the other end and over every workflow: a
    // context nothing reports blocks every merge, so this fails on the
    // rename that would cause it rather than on the pull request after it.
    const produced = workflows().flatMap(({ wf }) => checkRunNames(wf));
    expect(requiredContexts().length).toBeGreaterThan(0);
    for (const context of requiredContexts())
      expect(produced).toContain(context);
  });

  it("requires nothing a path filter can withhold", () => {
    // The other way a required check goes missing, and the one this
    // repository is actually set up for: infra.yml is gated on `paths:` and
    // test.yml on `paths-ignore:`, and GitHub evaluates both before
    // allocating a runner, so an unaffected pull request gets no check run at
    // all -- not a skipped one. A required context in that state is pending
    // forever. Requiring such a job means dropping its filter in the same
    // commit; this fails on the combination.
    const required = new Set(requiredContexts());
    for (const { file, wf } of workflows()) {
      if (!filtered(wf)) continue;
      for (const name of checkRunNames(wf))
        expect(
          required.has(name),
          `${name} is required and ${file} is filtered`,
        ).toBe(false);
    }
  });

  it("filters a push the same way it filters a pull request", () => {
    // GitHub Actions does not read YAML anchors, so every filtered workflow
    // writes its list twice and nothing but this makes the copies agree. The
    // halves drifting is not visible on a pull request at all: it shows up
    // later as a merge to master that skipped the leg its own pull request
    // ran.
    for (const { file, wf } of workflows()) {
      const push = wf.on?.push ?? {};
      const pull = wf.on?.pull_request ?? {};
      expect(push.paths ?? null, file).toEqual(pull.paths ?? null);
      expect(push["paths-ignore"] ?? null, file).toEqual(
        pull["paths-ignore"] ?? null,
      );
    }
  });

  it("requires no scope", () => {
    // There is nothing a scope could route to: release-please splits commits
    // by the paths they touch, and this repository is one package in plain
    // mode besides.
    expect(step?.with?.requireScope).toBe(false);
  });
});

/** ignored are the paths test.yml declines to start on. */
const ignored =
  workflows().find(({ file }) => file === "test.yml")?.wf.on?.pull_request?.[
    "paths-ignore"
  ] ?? [];

/** trackedInfra are the files under infra/, asked of git rather than walked:
 * `tofu init` leaves a ~40MB .terraform/ beside them, and a walk on a laptop
 * that has run `npm run check:infra` would find provider binaries there. */
function trackedInfra(): string[] {
  const root = fileURLToPath(new URL("../", import.meta.url));
  return execFileSync("git", ["ls-files", "infra"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line !== "");
}

/** infraInputs are the files under infra/ that a test in src/ reads, found the
 * only way that stays true as tests are added: by looking at what they open. */
function infraInputs(): string[] {
  const dir = new URL("./", import.meta.url);
  const found = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".test.ts")) continue;
    const text = readFileSync(new URL(file, dir), "utf8");
    for (const match of text.matchAll(/["'`]\.\.\/(infra\/[^"'`]+)["'`]/g))
      found.add(match[1] as string);
  }
  return [...found];
}

describe("the test workflow's path filter", () => {
  it("skips the infra files no test reads", () => {
    // The reason the filter exists. A pull request that only moves the
    // OpenTofu state has nothing to say to a suite that never opens it, and
    // infra.yml is already the leg that reads those files.
    const inputs = new Set(infraInputs());
    for (const file of trackedInfra()) {
      if (inputs.has(file)) continue;
      expect(ignored, `${file} is read by no test`).toContain(file);
    }
  });

  it("skips no infra file a test reads", () => {
    // infra/github/main.tf is the one, because this file reads the master
    // ruleset out of it. Ignoring it would let a renamed required context
    // merge unchecked, which is the failure the test above it exists to
    // prevent -- and the filter would have switched that test off for exactly
    // the pull request that needed it.
    const inputs = infraInputs();
    expect(inputs.length).toBeGreaterThan(0);
    for (const file of inputs)
      expect(ignored, `${file} is a test input`).not.toContain(file);
  });

  it("skips nothing that is no longer there", () => {
    // A path renamed out from under the list is not an error to GitHub: it
    // silently matches nothing, and the entry reads as though it still does
    // something.
    const tracked = new Set(trackedInfra());
    for (const file of ignored)
      expect(tracked.has(file), `${file} is not a tracked file`).toBe(true);
  });
});
