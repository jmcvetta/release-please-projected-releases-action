/**
 * The action's manifest and its code are two lists of input names that have
 * to agree, and neither half fails when they do not.
 *
 * An input the code reads but the manifest does not declare is always empty,
 * so the feature it controls silently does nothing. An input the manifest
 * declares but nothing reads is a documented knob with no effect. Both look
 * exactly like working software from the outside, which is why they are
 * checked here rather than left to review.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { Client } from "./api.js";
import type { Fetch } from "./api.js";
import { post } from "./action.js";

const manifest = parse(
  readFileSync(new URL("../action.yml", import.meta.url), "utf8"),
) as {
  inputs: Record<string, { description: string; default?: string }>;
  outputs: Record<string, { description: string }>;
  runs: { using: string; main: string };
};

// Only action.ts, because it is the only file that names an input. Scanning
// runner.ts too would pull in the placeholder names from its own tests.
const source = readFileSync(new URL("./action.ts", import.meta.url), "utf8");

/** literalsPassedTo collects the string literals handed to named functions. */
function literalsPassedTo(text: string, callees: string[]): Set<string> {
  const call = new RegExp(`\\b(?:${callees.join("|")})\\(\\s*\\n?\\s*"([^"]+)"`, "g");
  return new Set(
    [...text.matchAll(call)].flatMap((match) => (match[1] ? [match[1]] : [])),
  );
}

const read = literalsPassedTo(source, [
  "input",
  "inputOr",
  "boolInput",
  "listInput",
]);
const declared = new Set(Object.keys(manifest.inputs));

describe("action.yml", () => {
  it("declares every input the action reads", () => {
    // Guards against a scan that quietly matches nothing and so passes both
    // directions vacuously.
    expect(read.size).toBeGreaterThan(10);
    expect([...read].filter((name) => !declared.has(name)).sort()).toEqual([]);
  });

  it("declares no input the action ignores", () => {
    expect([...declared].filter((name) => !read.has(name)).sort()).toEqual([]);
  });

  it("describes every input and output", () => {
    for (const [name, spec] of Object.entries(manifest.inputs)) {
      expect(spec.description, `input ${name}`).toBeTruthy();
    }
    for (const [name, spec] of Object.entries(manifest.outputs)) {
      expect(spec.description, `output ${name}`).toBeTruthy();
    }
  });

  it("declares every output the action sets", () => {
    const set = literalsPassedTo(source, ["setOutput"]);
    expect(set.size).toBeGreaterThan(0);
    expect([...set].filter((name) => !(name in manifest.outputs)).sort()).toEqual([]);
  });

  it("points at the committed bundle on a runtime that still exists", () => {
    // Node 20 was removed from Actions runners on 2026-09-16.
    expect(manifest.runs.using).toBe("node24");
    expect(manifest.runs.main).toBe("dist/index.mjs");
  });
});

/**
 * Posting the comment can fail two ways that look alike and are not. A fork's
 * read-only token is forbidden, which is ordinary and must not fail the run.
 * A pull request that is not there is a mistake in the run's own inputs, and
 * softening it leaves a green check, no comment, and a warning blaming a
 * token that was never the problem.
 */
describe("post", () => {
  /** posting is a client whose every call answers with one status. */
  function posting(status: number): Client {
    const fetch: Fetch = async () => ({
      ok: status < 400,
      status,
      async text() {
        return JSON.stringify({ message: "no" });
      },
      headers: { get: () => null },
    });
    return new Client({ owner: "acme", repo: "widgets", token: "t", fetch });
  }

  /** annotations captures what the run wrote to the runner. */
  function annotations(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        lines.push(String(chunk));
        return true;
      });
    return { lines, restore: () => spy.mockRestore() };
  }

  it("warns and carries on when the token may not write", async () => {
    const { lines, restore } = annotations();
    try {
      await post(posting(403), 7, "header", "body");
    } finally {
      restore();
    }
    expect(lines.join("")).toContain("::warning::");
    expect(lines.join("")).toContain("read-only token");
  });

  it("fails on a pull request that is not there", async () => {
    const { lines, restore } = annotations();
    try {
      await expect(post(posting(404), 7, "header", "body")).rejects.toThrow(
        "pull request #7 was not found",
      );
    } finally {
      restore();
    }
    expect(lines.join("")).not.toContain("::warning::");
  });

  it("still fails on anything else", async () => {
    const { restore } = annotations();
    try {
      await expect(post(posting(500), 7, "header", "body")).rejects.toThrow();
    } finally {
      restore();
    }
  });
});
