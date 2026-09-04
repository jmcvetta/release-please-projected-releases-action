import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedFiles, commitFileIndex } from "./git.js";

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

describe("commitFileIndex", () => {
  const LOG = "\0aaa\n\nsrc/x.ts\nREADME.md\n\0bbb\n\nsrc/y.ts";

  it("reads a file list per commit", () => {
    const run = (args: string[]) =>
      args[0] === "rev-parse" ? "false\n" : LOG;
    expect(commitFileIndex(["origin/master"], 500, run)).toEqual(
      new Map([
        ["aaa", ["src/x.ts", "README.md"]],
        ["bbb", ["src/y.ts"]],
      ]),
    );
  });

  it("asks git for merge diffs, which it does not show by default", () => {
    // Without this a merge commit indexes as changing nothing, and a commit
    // attributed to no component is worse than one the API is asked about.
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      return args[0] === "rev-parse" ? "false\n" : LOG;
    };
    commitFileIndex(["origin/master"], 250, run);
    expect(calls[1]).toContain("--diff-merges=first-parent");
    expect(calls[1]).toContain("--max-count=250");
    expect(calls[1]?.at(-1)).toBe("origin/master");
  });

  it("declines a shallow checkout, which holds a fraction of the history", () => {
    const run = (args: string[]) => (args[0] === "rev-parse" ? "true\n" : LOG);
    expect(commitFileIndex(["origin/master"], 500, run)).toBeUndefined();
  });

  it("declines an index git had to quote a path in", () => {
    const run = (args: string[]) =>
      args[0] === "rev-parse" ? "false\n" : '\0aaa\n\n"src/a\\tb.ts"';
    expect(commitFileIndex(["origin/master"], 500, run)).toBeUndefined();
  });

  it("tries the next ref when one cannot be read", () => {
    const asked: string[] = [];
    const run = (args: string[]) => {
      if (args[0] === "rev-parse") return "false\n";
      const ref = args[args.length - 1] ?? "";
      asked.push(ref);
      if (ref !== "HEAD") throw new Error("unknown revision");
      return LOG;
    };
    expect(commitFileIndex(["origin/master", "master", "HEAD"], 500, run)?.size).toBe(2);
    expect(asked).toEqual(["origin/master", "master", "HEAD"]);
  });

  it("gives up rather than guessing when git is not there at all", () => {
    const run = () => {
      throw new Error("git: not found");
    };
    expect(commitFileIndex(["HEAD"], 500, run)).toBeUndefined();
  });
});

describe("commitFileIndex, against a real repository", () => {
  // The injected runners above prove the parsing; this proves it against what
  // git actually prints, which is the half that a reworded flag or a changed
  // default would break silently.
  it("indexes ordinary commits and merges alike", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-index-"));
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    const commit = (name: string, message: string) => {
      writeFileSync(join(dir, name), `${name}\n`);
      git(["add", name]);
      git(["commit", "-q", "-m", message]);
      return git(["rev-parse", "HEAD"]).trim();
    };

    try {
      git(["init", "-q", "-b", "master"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test"]);
      const first = commit("a.txt", "feat: a");
      git(["checkout", "-q", "-b", "topic"]);
      const branched = commit("b.txt", "feat: b");
      git(["checkout", "-q", "master"]);
      commit("c.txt", "feat: c");
      git(["merge", "-q", "--no-ff", "-m", "merge topic", "topic"]);
      const merge = git(["rev-parse", "HEAD"]).trim();

      const index = commitFileIndex(["master"], 500, git);
      expect(index?.get(first)).toEqual(["a.txt"]);
      expect(index?.get(branched)).toEqual(["b.txt"]);
      expect(index?.get(merge)).toEqual(["b.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
