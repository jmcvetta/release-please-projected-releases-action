/**
 * The pull request title gate, pinned to the type list it is meant to
 * enforce.
 *
 * Two files hold the same list in two languages: conventional-types.json,
 * which src/conventional.ts falls back to and which a caller can read, and
 * .github/workflows/pr-title-check.yml, which rejects a title carrying
 * anything else. Nothing makes them agree, and drift in either direction is
 * silent -- a gate missing a type red-lights a title that would have released
 * correctly, and a gate carrying an extra one lets a commit onto master that
 * the changelog then omits without a word. Hence a test rather than a comment.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { RECOGNIZED_TYPES } from "./conventional.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const source = read("../.github/workflows/pr-title-check.yml");
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

  it("requires no scope", () => {
    // There is nothing a scope could route to: release-please splits commits
    // by the paths they touch, and this repository is one package in plain
    // mode besides.
    expect(step?.with?.requireScope).toBe(false);
  });
});
