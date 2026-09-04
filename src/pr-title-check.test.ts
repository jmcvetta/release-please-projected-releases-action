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
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
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

interface Workflow {
  on?: { pull_request?: { paths?: string[] } | null };
  jobs?: Record<string, { name?: string } | undefined>;
}

/** workflows are every file in .github/workflows, parsed. */
function workflows(): Workflow[] {
  const dir = new URL("../.github/workflows/", import.meta.url);
  return readdirSync(dir).map(
    (file) => parse(readFileSync(new URL(file, dir), "utf8")) as Workflow,
  );
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
    const produced = workflows().flatMap(checkRunNames);
    expect(requiredContexts().length).toBeGreaterThan(0);
    for (const context of requiredContexts())
      expect(produced).toContain(context);
  });

  it("requires nothing a `paths:` filter can withhold", () => {
    // The other way a required check goes missing, and the one this
    // repository is actually set up for: infra.yml is gated on `paths:`, and
    // GitHub evaluates that before allocating a runner, so an unaffected
    // pull request gets no check run at all -- not a skipped one. A required
    // context in that state is pending forever. Requiring such a job means
    // dropping its filter in the same commit; this fails on the combination.
    const required = new Set(requiredContexts());
    for (const wf of workflows()) {
      if (!wf.on?.pull_request?.paths) continue;
      for (const name of checkRunNames(wf))
        expect(required.has(name), `${name} is filtered and required`).toBe(
          false,
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
