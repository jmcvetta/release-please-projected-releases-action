/**
 * git reads the pull request's changed files out of the checkout.
 *
 * The workflow checks the repository out with full history, so this is a
 * local read: cheaper than the API, and the same list release-please would
 * see for the squashed commit.
 */

import { execFileSync } from "node:child_process";

/** Runner runs a git command and returns its stdout. Injected for tests. */
export type Runner = (args: string[]) => string;

const gitRunner: Runner = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/**
 * changedFiles lists the files the pull request adds to its base.
 *
 * Diffed from the merge base rather than from the base tip, so files that
 * merely arrived on the base branch since the branch started are not
 * attributed to the pull request.
 */
export function changedFiles(
  base: string,
  head: string,
  run: Runner = gitRunner,
): string[] {
  const mergeBase = run(["merge-base", base, head]).trim();
  return run(["diff", "--name-only", mergeBase, head])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
