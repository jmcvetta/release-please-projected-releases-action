/**
 * conventional reads the Conventional Commit type list this repository shares
 * between languages, and judges a pull request title against it.
 *
 * The projection itself no longer needs these types: release-please resolves
 * them from the config (`changelog-sections` included) and decides what
 * releases. They survive for the two jobs that are not release-please's:
 * withholding a projection when the title is one the PR-title gate will
 * reject, and naming the visible types in the message that explains why
 * nothing releases.
 */

import { readFileSync } from "node:fs";

/** ConventionalTypes is the shape of conventional-types.json. */
interface ConventionalTypes {
  visible: string[];
  hidden: string[];
  releaseBranchPrefix: string;
}

// Read at runtime rather than imported, so the file stays a data file that
// tests/test_infra_github.py can parse from the other side of the language
// boundary. `../` resolves to the package root from both src/ (vitest) and
// dist/ (the built action).
const data: ConventionalTypes = JSON.parse(
  readFileSync(new URL("../conventional-types.json", import.meta.url), "utf8"),
);

/**
 * VISIBLE_TYPES are the types that render a changelog line, and so can open a
 * release on their own.
 */
export const VISIBLE_TYPES: ReadonlySet<string> = new Set(data.visible);

/**
 * HIDDEN_TYPES are recognized but render nothing. A component whose whole
 * unreleased set is hidden is skipped rather than released.
 */
export const HIDDEN_TYPES: ReadonlySet<string> = new Set(data.hidden);

/** RECOGNIZED_TYPES is every type the PR-title gate accepts. */
export const RECOGNIZED_TYPES: ReadonlySet<string> = new Set([
  ...data.visible,
  ...data.hidden,
]);

/**
 * RELEASE_BRANCH_PREFIX is how release-please names the branch of its own
 * release pull requests. The workflow skips those: merging one cuts its tag
 * from the manifest and changelog already written into the branch, never from
 * the type in its title, so this preview's model does not describe it.
 */
export const RELEASE_BRANCH_PREFIX = data.releaseBranchPrefix;

// conventional-commits-parser's default header pattern, plus the `!` breaking
// marker. The space after the colon is required, as it is upstream.
const HEADER = /^(?<type>\w+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: (?<subject>.+)$/;

/**
 * titleType is the Conventional Commit type of a pull request title, or
 * undefined when the title does not parse as one at all.
 */
export function titleType(title: string): string | undefined {
  return HEADER.exec(title.trim())?.groups?.["type"];
}

/**
 * isMalformed reports a title the PR-title gate will not accept.
 *
 * Three ways in: it does not parse as a Conventional Commit, its type is not
 * one release-please recognizes, or the type is not lowercase. That last one
 * is the case worth catching, because it half-works rather than failing:
 * `Feat:` renders a correct-looking Features entry (the changelog preset
 * lowercases before matching) while bumping only a patch (the versioning
 * strategy compares the type literally), so a feature ships as a patch with
 * no error anywhere.
 *
 * A malformed title is not mergeable as written, so any projection from it
 * describes a commit that will never exist. The caller withholds one.
 */
export function isMalformed(title: string): boolean {
  const type = titleType(title);
  if (type === undefined) return true;
  if (type !== type.toLowerCase()) return true;
  return !RECOGNIZED_TYPES.has(type);
}

/**
 * isReleaseBranch reports whether a branch is one of release-please's own
 * release pull request branches.
 */
export function isReleaseBranch(branch: string): boolean {
  return branch.startsWith(RELEASE_BRANCH_PREFIX);
}

// release-please names a release branch deterministically, so the component
// can be recovered from `headRefName` without asking the API what the pull
// request is for. Single-component repositories get the prefix with no
// `--components` segment; this repository always has one.
const RELEASE_BRANCH =
  /^release-please--branches--(?<base>.+?)--components--(?<component>.+)$/;

/**
 * componentOfBranch recovers the component name from a release branch, or
 * undefined when the branch is not one.
 */
export function componentOfBranch(branch: string): string | undefined {
  return RELEASE_BRANCH.exec(branch.trim())?.groups?.["component"];
}
