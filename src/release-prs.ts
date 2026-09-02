/**
 * release-prs reads the standing release pull requests the workflow collected.
 *
 * release-please keeps one open release pull request per component, and the
 * "already pending" version in the comment is whatever that pull request is
 * holding. Linking the number to it puts the accumulated changelog one click
 * away.
 */

import { componentOfBranch } from "./conventional.js";

/**
 * loadReleasePrs maps a component to its standing release pull request.
 *
 * Reads `<branch>\t<url>` lines. A branch that does not parse is skipped
 * rather than raising: the file is whatever open pull requests happen to
 * exist, and an unrecognized one is not an error.
 */
export function loadReleasePrs(text: string): Map<string, string> {
  const prs = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [branch = "", url = ""] = line.split("\t");
    const component = componentOfBranch(branch);
    if (component && url.trim()) prs.set(component, url.trim());
  }
  return prs;
}
