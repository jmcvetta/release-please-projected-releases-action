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
