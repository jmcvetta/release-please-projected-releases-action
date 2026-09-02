/**
 * render writes the sticky comment body.
 *
 * It is tool output, not a message: the table first, then only the notes
 * needed to read it. Most pull requests in a repository like this one release
 * nothing at all, so "nothing will be released" is stated as an answer rather
 * than left as silence.
 */

import { DEFAULT_TYPES, titleType } from "./conventional.js";
import type { TypeSet } from "./conventional.js";
import type { PackageConfig, Projection, Release } from "./project.js";
import { tagFor } from "./project.js";

/** RenderOptions are the pull request facts the body is stamped with. */
export interface RenderOptions {
  /** title is the pull request title, which squash-merge makes the subject. */
  title: string;
  /** malformed withholds the projection: see conventional.isMalformed. */
  malformed: boolean;
  /** releasePrs maps a component to its standing release pull request URL. */
  releasePrs?: Map<string, string>;
  /** headSha is the commit the projection describes. */
  headSha?: string;
  /** runUrl is this workflow run, linked from the footer. */
  runUrl?: string;
  /** types is the resolved changelog type list, which decides what "visible"
   * means for this repository. Defaults to the conventionalcommits preset. */
  types?: TypeSet;
  /**
   * advisories are warnings the caller found that the projection itself
   * cannot see — chiefly that the repository will not build the merge commit
   * this preview assumes. Rendered with the projection's own warnings.
   */
  advisories?: readonly string[];
  /** now is the render time; injected so the footer is testable. */
  now?: Date;
}

/** visibleTitle reports whether the pull request title's type is one that
 * renders a changelog line, and so can open a release on its own. */
function visibleTitle(options: RenderOptions): boolean {
  const types = options.types ?? DEFAULT_TYPES;
  return types.visible.has(titleType(options.title) ?? "");
}

/** Row is one component's line in the table. */
interface Row {
  pkg: PackageConfig;
  projected: Release;
  pending: Release | undefined;
}

/**
 * bumpLevel names the size of a bump by comparing the two versions, rather
 * than by re-deriving it from the commit type. What release-please did is
 * more informative than what it should have done.
 */
export function bumpLevel(from: string, to: string): string {
  const a = from.split(".").map(Number);
  const b = to.split(".").map(Number);
  if (a.length !== 3 || b.length !== 3) return "version";
  if (b[0] !== a[0]) return "major";
  if (b[1] !== a[1]) return "minor";
  if (b[2] !== a[2]) return "patch";
  return "no";
}

/**
 * footer stamps the comment with what it was rendered from.
 *
 * A sticky comment is edited in place, so a re-render posts no new comment,
 * sends no notification, and does not move in the thread. When the verdict is
 * unchanged — which it is for every title edit that does not cross the
 * hidden/visible line — nothing on screen distinguishes a fresh render from a
 * stale one. This line is the difference.
 */
export function footer(options: RenderOptions): string {
  const parts: string[] = [];
  if (options.headSha) parts.push(`\`${options.headSha.slice(0, 7)}\``);
  const stamp = (options.now ?? new Date())
    .toISOString()
    .replace("T", " ")
    .slice(0, 16);
  parts.push(
    options.runUrl
      ? `[re-rendered ${stamp} UTC](${options.runUrl})`
      : `re-rendered ${stamp} UTC`,
  );
  return `<sub>Projected for ${parts.join(" · ")}</sub>`;
}

/**
 * renderWithheld replaces the projection when the title is malformed.
 *
 * Such a title is not mergeable as written, so a projection from it describes
 * a commit that will never exist. The reader needs to know it is wrong and
 * what shape it should be; what release-please does with it is not their
 * problem here.
 */
function renderWithheld(options: RenderOptions): string[] {
  const types = options.types ?? DEFAULT_TYPES;
  const recognized = [...types.recognized]
    .sort()
    .map((t) => `\`${t}\``)
    .join(", ");
  return [
    "## Projected releases",
    "",
    "None — malformed PR title.",
    "",
    `> ${options.title}`,
    "",
    "Titles must be [Conventional Commits](https://www.conventionalcommits.org/)" +
      " format, with a lowercase type the changelog recognizes:" +
      ` ${recognized}.`,
  ];
}

/**
 * render writes the whole comment body for a projection.
 */
export function render(
  projection: Projection,
  options: RenderOptions,
): string {
  const lines = options.malformed
    ? [
        ...renderWithheld(options),
        // Advisories survive a withheld projection: "this repository does not
        // squash-merge" is as true of a malformed title as of a good one, and
        // it is the note most likely to explain why the whole comment is
        // beside the point.
        ...(options.advisories?.length ? ["", ...options.advisories] : []),
      ]
    : renderProjection(projection, options);
  return [...lines, "", footer(options)].join("\n") + "\n";
}

function renderProjection(
  projection: Projection,
  options: RenderOptions,
): string[] {
  // Joined on the name release-please attributes releases to, not on the
  // name the config spells: a package that declares no component still gets
  // one, and a package that keeps its component out of its tags gets none.
  const byComponent = new Map(
    projection.packages.map((p) => [p.releaseComponent, p]),
  );
  const touchedPackages = [...projection.touched.keys()].flatMap((path) => {
    const pkg = projection.packages.find((p) => p.path === path);
    return pkg ? [pkg] : [];
  });
  const touched = new Set(touchedPackages.map((p) => p.releaseComponent));
  const pendingBy = new Map(projection.pending.map((r) => [r.component, r]));

  const rows: Row[] = projection.projected
    .filter((r) => touched.has(r.component))
    .flatMap((projected) => {
      const pkg = byComponent.get(projected.component);
      return pkg
        ? [{ pkg, projected, pending: pendingBy.get(projected.component) }]
        : [];
    });

  const moved = rows.filter((r) => r.pending?.version !== r.projected.version);
  const unmoved = rows.filter((r) => r.pending?.version === r.projected.version);

  const out = ["## Projected releases", ""];

  if (moved.length === 0) {
    out.push(
      ...(unmoved.length > 0
        ? ["No component's version changes."]
        : none(projection, options, touchedPackages)),
    );
  } else {
    out.push(
      "| Component | Tag | Current | Pending | Projected |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const row of moved) {
      out.push(
        `| \`${row.pkg.component}\`` +
          ` | \`${tagFor(row.pkg, row.projected.version)}\`` +
          ` | ${row.pkg.current ?? "—"}` +
          ` | ${pendingCell(row, options)}` +
          ` | **${row.projected.version}** |`,
      );
    }
    out.push("", basis(moved, projection));
  }

  if (unmoved.length > 0) {
    out.push("", ...unmoved.map((row) => unmovedNote(row, options)));
  }

  const warnings = warn(projection, options, moved, unmoved);
  if (warnings.length > 0) out.push("", ...warnings);

  if (moved.length > 0) out.push("", changelog(moved));
  out.push("", components(projection));
  return out;
}

/**
 * none states which of the two reasons applies. They call for different
 * fixes: one is about the files the branch touches, the other about the type
 * in the title.
 *
 * Both statements are scoped to the components this pull request touches,
 * which is what an empty table actually establishes. A standing release
 * pull request for some other component says nothing about this one, and
 * reading it as "nothing user-facing is pending" contradicts the warning
 * below, which counts every pending release in the repository.
 */
function none(
  projection: Projection,
  options: RenderOptions,
  touched: readonly PackageConfig[],
): string[] {
  if (touched.length === 0) {
    const dirs = [
      ...new Set(projection.files.map((f) => f.split("/")[0] ?? f)),
    ].sort();
    let line = "None — no changed file is under a component path.";
    if (dirs.length > 0) {
      line += ` Touched: ${dirs.map((d) => `\`${d}\``).join(", ")}.`;
    }
    return [line];
  }

  const types = options.types ?? DEFAULT_TYPES;
  const visible = [...types.visible].sort().map((t) => `\`${t}\``).join(", ");
  const type = titleType(options.title) ?? "";
  // A visible type reaching here is not the ordinary case -- release-please
  // attributes files itself, so it can project nothing for a component this
  // preview counts as touched (a path the package excludes, say). Whatever
  // the cause, the title is not a hidden type and must not be called one.
  const line = visibleTitle(options)
    ? `None — release-please projects no release for the components this` +
      ` pull request touches, and none has one pending.`
    : `None — \`${type}\` is a hidden type, and no component it touches has` +
      ` a release pending. Only ${visible} open a release.`;
  return [
    line,
    "",
    `Components touched: ${nameList(touched)}.`,
  ];
}

/** nameList spells a set of packages by the name their tags carry, falling
 * back to the path for a package whose tags name no component. */
function nameList(packages: readonly PackageConfig[]): string {
  return [...new Set(packages.map((p) => p.component || p.path))]
    .sort()
    .map((name) => `\`${name}\``)
    .join(", ");
}

/** pendingCell is where the component's standing release PR already sits,
 * this pull request excluded, linked to that PR when one is open. */
function pendingCell(row: Row, options: RenderOptions): string {
  if (!row.pending) return "—";
  const url = options.releasePrs?.get(row.pkg.component);
  return url ? `[${row.pending.version}](${url})` : row.pending.version;
}

/** basis is the one line stating what produced the table. */
function basis(moved: Row[], projection: Projection): string {
  const asked = projection.releaseAs;
  if (asked && !projection.ignoredReleaseAs) {
    if (moved.some((r) => r.projected.version === asked)) {
      return `\`Release-As: ${asked}\` forces the version.`;
    }
  }
  const levels = [
    ...new Set(
      moved.map((r) => bumpLevel(r.pkg.current ?? "0.0.0", r.projected.version)),
    ),
  ];
  return `${levels.join(" / ")} bump.`;
}

/**
 * unmovedNote covers a component whose projected version is exactly what its
 * standing release pull request already holds.
 *
 * That release is coming from commits already on the target branch, so naming
 * its tag in the table would claim a bump this pull request did not cause.
 * Such rows move down here instead.
 *
 * A visible type still contributes to that release even though it moves no
 * number: its changelog line ships in the version already pending. Saying
 * only that the version does not move reads as contributing nothing, which
 * for a `feat:` is wrong.
 */
function unmovedNote(row: Row, options: RenderOptions): string {
  const url = options.releasePrs?.get(row.pkg.component);
  const version = row.projected.version;
  const where = url ? `[${version}](${url})` : version;
  const what = visibleTitle(options)
    ? " this PR adds a changelog line to it, not a version."
    : " this PR does not move it.";
  return `- \`${row.pkg.component}\` stays at ${where}, already pending;${what}`;
}

/** warn is the terse list of things that will surprise someone. */
function warn(
  projection: Projection,
  options: RenderOptions,
  moved: Row[],
  unmoved: Row[],
): string[] {
  const warnings: string[] = [...(options.advisories ?? [])];
  if (projection.ignoredReleaseAs) {
    warnings.push(
      `- \`Release-As: ${projection.ignoredReleaseAs}\` was **ignored** —` +
        " release-please returned a different version. A note only counts" +
        " when it parses as a git trailer, so no non-trailer text may follow" +
        " it: a `---` rule or an attribution line below it voids it silently." +
        " Check the merge box too, which is prefilled from the description" +
        " but editable.",
    );
  }
  // Only a hidden type contributes nothing. A visible one whose version does
  // not move still writes its changelog line into the release already
  // pending, so telling its author otherwise is false twice over.
  //
  // The pending releases this speaks of are the ones noted just above, so it
  // needs an unmoved row rather than a pending release anywhere in the
  // repository. Without a row, none() has already given the whole answer.
  if (moved.length === 0 && unmoved.length > 0 && !visibleTitle(options)) {
    const type = titleType(options.title) ?? "";
    warnings.push(
      `- \`${type}\` adds no changelog line and changes no version. The` +
        " releases already pending happen without it.",
    );
  }
  return warnings;
}

/** changelog shows the notes release-please rendered, which are the release
 * notes the tag will actually carry. */
function changelog(moved: Row[]): string {
  const body = moved
    .filter((r) => r.projected.notes)
    .map((r) => `#### \`${r.pkg.component}\`\n\n${r.projected.notes}`)
    .join("\n\n");
  return [
    "<details><summary>Changelog preview</summary>",
    "",
    body || "_release-please rendered no notes._",
    "",
    "</details>",
  ].join("\n");
}

/** components is the collapsed working: which file pulled in which component,
 * so a surprising row can be traced to its cause. */
function components(projection: Projection): string {
  const lines = [
    "<details><summary>Components</summary>",
    "",
    "| Component | Path | Current |",
    "| --- | --- | --- |",
  ];
  for (const pkg of projection.packages) {
    lines.push(
      `| \`${pkg.component}\` | \`${pkg.path}\` | ${pkg.current ?? "—"} |`,
    );
  }
  for (const [path, files] of projection.touched) {
    const pkg = projection.packages.find((p) => p.path === path);
    const shown = files.slice(0, 10);
    lines.push("", `\`${pkg?.component ?? path}\` matched:`);
    for (const file of shown) lines.push(`- \`${file}\``);
    if (files.length > shown.length) {
      lines.push(`- …and ${files.length - shown.length} more`);
    }
  }
  lines.push(
    "",
    "Longest path wins; a repository-root file matches nothing.",
    "",
    "</details>",
  );
  return lines.join("\n");
}
