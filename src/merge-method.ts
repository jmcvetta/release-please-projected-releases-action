/**
 * merge-method checks the one assumption the projection cannot verify from
 * inside itself: that merging this pull request writes a commit whose subject
 * is the pull request title.
 *
 * That is true of a squash-merge, and it is the reason this tool exists — a
 * squashed pull request contributes exactly one Conventional Commit, and it
 * is the title. It is not true of a merge commit or a rebase, where the
 * working commits land individually and release-please parses those instead.
 * It is also not quite true of a squash-merge under GitHub's
 * `COMMIT_OR_PR_TITLE` setting, which prefills the subject from the branch's
 * only commit when the branch has one commit.
 *
 * None of this can make the projection right, so none of it changes what is
 * projected. It goes in the comment as a note, where a reader can see that
 * the answer above it is answering a question their repository does not ask.
 */

import type { RepositoryMergeSettings } from "./api.js";

/** MergeMethod is how a caller says its repository merges. `auto` reads the
 * repository's settings; the rest assert one. */
export type MergeMethod = "auto" | "squash" | "merge" | "rebase";

/** MERGE_METHODS is every accepted value of the `merge-method` input. */
export const MERGE_METHODS: readonly MergeMethod[] = [
  "auto",
  "squash",
  "merge",
  "rebase",
];

/** isMergeMethod narrows an input string to a MergeMethod. */
export function isMergeMethod(value: string): value is MergeMethod {
  return (MERGE_METHODS as readonly string[]).includes(value);
}

/** MergeContext is what the advisories are computed from. */
export interface MergeContext {
  /** method is the caller's declared merge method, or `auto`. */
  method: MergeMethod;
  /** settings are the repository's merge settings, when they were read. */
  settings?: RepositoryMergeSettings | undefined;
  /** commits is the number of commits on the pull request branch. */
  commits?: number | undefined;
}

/**
 * mergeAdvisories lists what would make this projection describe a commit the
 * merge will not write. An empty list is the ordinary case.
 *
 * A repository that merely *allows* a merge commit alongside squash gets no
 * warning: nearly every repository does, and a note on every pull request is
 * a note nobody reads. Only a repository that cannot squash at all, or one
 * whose settings will take the subject from somewhere else, is worth saying
 * something about.
 */
export function mergeAdvisories(context: MergeContext): string[] {
  const advisories: string[] = [];

  if (context.method === "merge" || context.method === "rebase") {
    advisories.push(
      `- This repository is configured as \`merge-method: ${context.method}\`,` +
        " so the working commits reach the target branch individually and" +
        " release-please parses those, not the title. The projection below" +
        " models a squash-merge and does not describe this merge.",
    );
    return advisories;
  }

  const settings = context.settings;
  if (!settings) return advisories;

  if (!settings.allowSquash) {
    advisories.push(
      "- This repository does not allow squash-merge, and the projection" +
        " models one. Merging will put the working commits on the target" +
        " branch individually, and release-please will parse those instead" +
        " of the title.",
    );
    return advisories;
  }

  if (settings.squashTitle === "COMMIT_OR_PR_TITLE" && context.commits === 1) {
    advisories.push(
      "- This repository's squash setting is `COMMIT_OR_PR_TITLE` and the" +
        " branch has a single commit, so GitHub will prefill the squash" +
        " subject from **that commit's message**, not from this title. The" +
        " merge box is editable; the projection below assumes the title.",
    );
  }

  return advisories;
}
