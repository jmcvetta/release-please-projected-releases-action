import { describe, expect, it } from "vitest";
import { changedFiles } from "./git.js";

describe("changedFiles", () => {
  it("diffs from the merge base, not the base tip", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      return args[0] === "merge-base" ? "deadbeef\n" : "a.ts\nb/c.ts\n";
    };
    expect(changedFiles("origin/master", "HEAD", run)).toEqual([
      "a.ts",
      "b/c.ts",
    ]);
    expect(calls[0]).toEqual(["merge-base", "origin/master", "HEAD"]);
    expect(calls[1]).toEqual(["diff", "--name-only", "deadbeef", "HEAD"]);
  });

  it("drops blank lines", () => {
    const run = (args: string[]) =>
      args[0] === "merge-base" ? "sha\n" : "a.ts\n\n\n";
    expect(changedFiles("m", "h", run)).toEqual(["a.ts"]);
  });
});

describe("changedFiles, against the checkout it is running in", () => {
  // The injected runner above proves the arguments; this proves the default
  // one, which is the only part of this module a workflow actually uses and
  // the part that is one typo from failing on every pull request.
  it("diffs a ref against itself and finds nothing", () => {
    // True in any checkout, shallow ones included: the merge base of HEAD
    // and HEAD is HEAD.
    expect(changedFiles("HEAD", "HEAD")).toEqual([]);
  });

  it("raises when the checkout cannot answer, so the caller can fall back", () => {
    // The signal src/action.ts turns into "check the repository out with
    // fetch-depth: 0" before reading the file list from the API instead.
    expect(() => changedFiles("origin/no-such-branch-here", "HEAD")).toThrow();
  });
});
