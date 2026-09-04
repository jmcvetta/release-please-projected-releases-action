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

/**
 * commitFileIndex maps each commit on `refs` to the files it changed, read
 * from the local checkout.
 *
 * release-please backfills a commit's file list with one serial REST call
 * whenever GitHub does not associate the commit with a merged pull request —
 * on a branch carrying direct pushes that is most of its history, and it was
 * about 60 seconds of a measured 183-second step (issue #54). One `git log`
 * answers the same question for every commit at once.
 *
 * A sha is right or it is absent: a commit's file list is a property of the
 * commit, not of the branch it was found on, so an index built from a
 * different ref than the one release-please walks is still correct for every
 * sha it holds. Anything it does not hold falls back to the API, which is why
 * the checks below can afford to be blunt.
 *
 * Returns undefined when the checkout cannot answer: no git, no such ref, or
 * a shallow clone, which `actions/checkout` produces by default and which
 * would otherwise index a fraction of the history and look complete doing it.
 */
export function commitFileIndex(
  refs: readonly string[],
  depth: number,
  run: Runner = gitRunner,
): Map<string, string[]> | undefined {
  try {
    if (run(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
      return undefined;
    }
  } catch {
    return undefined;
  }
  for (const ref of refs) {
    const index = indexOf(ref, depth, run);
    if (index && index.size > 0) return index;
  }
  return undefined;
}

/**
 * indexOf reads one ref's history, or undefined when it cannot be read
 * faithfully.
 *
 * `--diff-merges=first-parent` is what makes a merge commit report files at
 * all: `git log --name-only` shows none for one by default, and an empty list
 * served confidently is worse than no index, since it attributes the commit to
 * no component. It is also the diff GitHub's own commit endpoint returns.
 *
 * Each commit is announced by a NUL-prefixed line so a path can never be
 * mistaken for a sha, and a quoted path abandons the whole index: git escapes
 * a path holding a control character or a quote, C-style, and unescaping it
 * here to save a few API calls would be a second parser to get wrong. Such a
 * repository simply pays what it paid before.
 */
function indexOf(
  ref: string,
  depth: number,
  run: Runner,
): Map<string, string[]> | undefined {
  let out: string;
  try {
    out = run([
      "-c",
      "core.quotePath=false",
      "log",
      `--max-count=${depth}`,
      "--name-only",
      "--diff-merges=first-parent",
      "--pretty=format:%x00%H",
      ref,
    ]);
  } catch {
    return undefined;
  }

  const index = new Map<string, string[]>();
  let files: string[] | undefined;
  for (const line of out.split("\n")) {
    if (line.startsWith("\0")) {
      files = [];
      index.set(line.slice(1).trim(), files);
      continue;
    }
    const path = line.trim();
    if (!path || !files) continue;
    if (path.startsWith('"')) return undefined;
    files.push(path);
  }
  return index;
}
