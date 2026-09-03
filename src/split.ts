/**
 * split attributes changed files to release-please packages.
 *
 * This is the one rule still mirrored from release-please rather than taken
 * from it, and it is worth being precise about why that is acceptable here:
 * it decides only what the comment *explains*, never what it predicts.
 * release-please does its own splitting inside `buildPullRequests`, so the
 * versions and tags in the table come from upstream whatever this file says.
 * Getting it wrong costs a wrong **Files** count in the table, not a wrong
 * version.
 *
 * The rule, from util/commit-split.ts: package paths are sorted longest
 * first and matched with `file.indexOf(`${p}/`) === 0`, so the deepest
 * package wins and `viewer2/x` is not read as `viewer`. A path with no `/`
 * is skipped outright, which is why a file at the repository root belongs to
 * no package. The special "." root package is excluded from prefix
 * matching there and handed every commit in manifest.ts instead.
 */

/** ROOT_PACKAGE_PATH is the path release-please reserves for a package rooted
 * at the repository itself. */
export const ROOT_PACKAGE_PATH = ".";

/**
 * splitFiles groups changed files by the package path that owns them.
 * Packages owning no changed file are absent from the result.
 */
export function splitFiles(
  files: readonly string[],
  packagePaths: readonly string[],
): Map<string, string[]> {
  const prefixed = packagePaths
    .filter((p) => p !== ROOT_PACKAGE_PATH)
    .sort((a, b) => b.length - a.length);
  const hasRoot = packagePaths.includes(ROOT_PACKAGE_PATH);

  const owned = new Map<string, string[]>();
  const add = (path: string, file: string) => {
    const list = owned.get(path);
    if (list) list.push(file);
    else owned.set(path, [file]);
  };

  for (const file of files) {
    if (hasRoot) add(ROOT_PACKAGE_PATH, file);
    if (!file.includes("/")) continue;
    for (const path of prefixed) {
      if (file.startsWith(`${path}/`)) {
        add(path, file);
        break;
      }
    }
  }
  return owned;
}
