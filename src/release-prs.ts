/**
 * release-prs reads the standing release pull requests, so the "already
 * pending" version in the comment can link to the pull request holding it.
 *
 * release-please keeps one open release pull request per component (or one
 * for the repository, aggregating them). Whichever it is, the number the
 * comment shows is whatever that pull request holds, and linking it puts the
 * accumulated changelog one click away.
 */

import { DEFAULT_TYPES, releaseBranch } from "./conventional.js";

/** ReleasePr is one open release pull request. */
export interface ReleasePr {
  /** headRefName is the branch release-please opened it from. */
  headRefName: string;
  /** url is where the pull request lives. */
  url: string;
}

/**
 * indexReleasePrs maps a component to its standing release pull request.
 *
 * A branch that is not a release branch is skipped rather than raising: the
 * input is whatever open pull requests happen to exist, and an unrecognized
 * one is not an error. A repository releasing a single component, or
 * aggregating every component into one pull request, indexes under the empty
 * string, which is the component name release-please gives it.
 *
 * `base` narrows the listing to the release pull requests targeting one
 * branch, and should be passed whenever the caller knows which branch it is
 * describing. A repository maintaining a `v1.x` branch alongside `master` has
 * a standing release pull request on each, and under the aggregated
 * configuration both name no component -- so without this they share the
 * empty key, the index looks like the single aggregated one it is not, and
 * the "already pending" cell on a `master` pull request links the `v1.x`
 * release.
 */
export function indexReleasePrs(
  prs: readonly ReleasePr[],
  prefix: string = DEFAULT_TYPES.releaseBranchPrefix,
  base?: string,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const pr of prs) {
    const branch = releaseBranch(pr.headRefName, prefix);
    if (!branch || !pr.url.trim()) continue;
    if (base !== undefined && branch.base !== base) continue;
    index.set(branch.component, pr.url.trim());
  }
  return index;
}

/**
 * loadReleasePrs reads `<branch>\t<url>` lines, the form a workflow can
 * produce with one `gh pr list` call. The action queries the API itself; this
 * is for driving the tool by hand from a checkout.
 */
export function loadReleasePrs(
  text: string,
  prefix: string = DEFAULT_TYPES.releaseBranchPrefix,
  base?: string,
): Map<string, string> {
  const prs: ReleasePr[] = [];
  for (const line of text.split("\n")) {
    const [headRefName = "", url = ""] = line.split("\t");
    if (headRefName.trim()) prs.push({ headRefName, url });
  }
  return indexReleasePrs(prs, prefix, base);
}
