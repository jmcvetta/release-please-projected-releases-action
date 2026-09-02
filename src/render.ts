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
import { ROOT_PACKAGE_PATH } from "./split.js";

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
  /** base is the branch the pull request targets, named when explaining what
   * that branch already releases on its own. */
  base?: string;
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
  const touchedPackages = [...projection.touched.keys()].flatMap((path) => {
    const pkg = projection.packages.find((p) => p.path === path);
    return pkg ? [pkg] : [];
  });
  const touched = new Set(touchedPackages.map((p) => p.releaseComponent));

  // Joined on the name release-please attributes releases to, not on the
  // name the config spells: a package that declares no component still gets
  // one, and a package that keeps its component out of its tags gets none.
  const byComponent = groupBy(projection.packages, (p) => p.releaseComponent);
  const shared = new Set(
    [...byComponent].filter(([, list]) => list.length > 1).map(([c]) => c),
  );
  const unclaimed = claimOrder(byComponent, new Set(projection.touched.keys()));
  const pendingBy = groupBy(projection.pending, (r) => r.component);

  // Every release gets a row. A release whose component matches no configured
  // package is the one case where that takes inventing the package, and it is
  // worth the invention: dropping the row instead made the comment say "None
  // -- release-please projects no release" for a merge that cuts a tag, which
  // is the false negative this whole action exists to prevent, and it said it
  // in silence.
  const unmatched: string[] = [];
  const rows: Row[] = projection.projected.map((projected) => {
    // Each release takes a package of its own. A component name is not
    // unique across packages, and handing the same package to two releases
    // lent one of them the other's current version, path and tag.
    const pkg = unclaimed.get(projected.component)?.shift();
    if (!pkg) unmatched.push(projected.component);
    return {
      pkg: pkg ?? unconfigured(projected, projection),
      projected,
      pending: pendingBy.get(projected.component)?.shift(),
    };
  });

  // A moved version is this pull request's doing whatever files it changed:
  // the two passes differ only by the merge, so nothing else could have moved
  // it. release-please attributes releases itself, and its `node-workspace`
  // and `linked-versions` plugins release components a pull request never
  // touches — which a filter on the touched components dropped, understating
  // the merge or reporting nothing for it at all.
  //
  // A version that does not move is another matter. That release is coming
  // from commits already on the target branch, so it is only this pull
  // request's business for a component it actually reaches.
  const moved = rows.filter((r) => r.pending?.version !== r.projected.version);
  const unmoved = rows.filter(
    (r) =>
      r.pending?.version === r.projected.version &&
      touched.has(r.projected.component),
  );

  const out = ["## Projected releases", ""];

  if (moved.length === 0) {
    out.push(
      ...(unmoved.length > 0
        ? ["No component's version changes."]
        : none(projection, options, touchedPackages)),
    );
  } else {
    out.push(
      "| Component | Tag | Current | Without this PR | Projected |",
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

  const warnings = warn(projection, options, moved, unmoved, {
    unmatched,
    shared: byComponent,
    named: new Set(
      [...moved, ...unmoved]
        .map((r) => r.pkg.releaseComponent)
        .filter((c) => shared.has(c)),
    ),
  });
  if (warnings.length > 0) out.push("", ...warnings);

  if (moved.length > 0) out.push("", changelog(moved));
  out.push("", components(projection));
  return out;
}

/**
 * unconfigured invents the package a projected release belongs to when no
 * configured one claims its component.
 *
 * It should not happen: the packages come from the same configuration
 * release-please projected from, and `namePackages` fills in the names it
 * derives. It did happen, twice, from the two ways that join can be read
 * wrongly, and both times the row simply vanished. So the fallback is a row
 * built from what release-please did say, plus a warning naming what is
 * missing, rather than nothing at all.
 *
 * `includeComponent` follows from the component itself: release-please
 * reports a component only for a package that tags with one (`getComponent`
 * is the empty string otherwise), so a named release tags with its name. The
 * separator is the repository's when its packages agree on one, which is the
 * only evidence available.
 */
function unconfigured(release: Release, projection: Projection): PackageConfig {
  const separators = new Set(projection.packages.map((p) => p.separator));
  return {
    path: "",
    component: release.component,
    releaseComponent: release.component,
    current: undefined,
    separator: separators.size === 1 ? [...separators][0]! : "-",
    includeComponent: release.component !== "",
  };
}

/** groupBy indexes values by a key several of them may share. */
function groupBy<T>(
  values: readonly T[],
  key: (value: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const value of values) {
    const list = out.get(key(value));
    if (list) list.push(value);
    else out.set(key(value), [value]);
  }
  return out;
}

/**
 * claimOrder copies the packages of each component into the order releases
 * should claim them in: the ones the pull request touches first.
 *
 * It only matters when a component names more than one package, where nothing
 * in release-please's answer says which of them a release belongs to. Having
 * changed a file under one of them is the best evidence available, and the
 * sort is stable, so packages the pull request does not touch keep their
 * configured order behind those it does.
 */
function claimOrder(
  byComponent: ReadonlyMap<string, PackageConfig[]>,
  touchedPaths: ReadonlySet<string>,
): Map<string, PackageConfig[]> {
  const out = new Map<string, PackageConfig[]>();
  for (const [component, list] of byComponent) {
    out.set(
      component,
      [...list].sort(
        (a, b) =>
          Number(touchedPaths.has(b.path)) - Number(touchedPaths.has(a.path)),
      ),
    );
  }
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

/**
 * releasePrUrl finds the standing release pull request holding a component's
 * pending version.
 *
 * The index is keyed by the component in the release branch's name, which is
 * the component release-please knows the package by. Under its *default*
 * `separate-pull-requests: false` there is no such segment: one pull request
 * aggregates every component, on a branch naming none of them, and it indexes
 * under the empty string. Looking a real component up in that index finds
 * nothing, which is how this feature came to cost an API call per run and
 * link nothing at all for the ordinary configuration.
 *
 * The empty key is only read as "the pull request for everything" when it is
 * the whole index. A repository that does separate its release pull requests
 * can have one keyed empty too — a root package that keeps its component out
 * of its branch name — and that one belongs to that package alone.
 */
function releasePrUrl(
  component: string,
  options: RenderOptions,
): string | undefined {
  const prs = options.releasePrs;
  if (!prs || prs.size === 0) return undefined;
  const own = prs.get(component);
  if (own) return own;
  return prs.size === 1 ? prs.get("") : undefined;
}

/** pendingCell is where the component's standing release PR already sits,
 * this pull request excluded, linked to that PR when one is open. */
function pendingCell(row: Row, options: RenderOptions): string {
  if (!row.pending) return "—";
  const url = releasePrUrl(row.pkg.component, options);
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
  const url = releasePrUrl(row.pkg.component, options);
  const version = row.projected.version;
  const what = visibleTitle(options)
    ? " this PR adds a changelog line to it, not a version."
    : " this PR does not move it.";

  // "Already pending" asserts that a release pull request is standing, which
  // is only known when one was found. Without that, all this measured is that
  // the target branch produces the same version on its own -- which is what
  // gets said instead. Saying "pending" there contradicts the Current column
  // in the very same comment, since a repository that has never released
  // shows no current version and has no release pull request to point at.
  //
  // Not "there is no release pull request", either: the listing is skipped by
  // `link-release-prs: false` and degrades to empty when the call fails, so an
  // absent URL means it was not found, never that it does not exist.
  const where = url
    ? `[${version}](${url}), already pending;`
    : `${version}, which ${branch(options)} already releases without it;`;
  return `- \`${row.pkg.component}\` stays at ${where}${what}`;
}

/** branch names the target branch for prose, falling back to a generic
 * phrase when the caller did not say which it is. */
function branch(options: RenderOptions): string {
  return options.base ? `\`${options.base}\`` : "the target branch";
}

/** warn is the terse list of things that will surprise someone. */
function warn(
  projection: Projection,
  options: RenderOptions,
  moved: Row[],
  unmoved: Row[],
  components: {
    unmatched: readonly string[];
    shared: ReadonlyMap<string, PackageConfig[]>;
    named: ReadonlySet<string>;
  },
): string[] {
  const warnings: string[] = [...(options.advisories ?? [])];
  // The row is shown from release-please's answer alone, so the reader is
  // told which parts of it this comment could not fill in.
  for (const component of [...new Set(components.unmatched)].sort()) {
    warnings.push(
      `- release-please releases ${component ? `\`${component}\`` : "a component this comment cannot name"},` +
        " which matches no configured package here. The row's **Current**" +
        " and matched files are unknown, and its tag is this comment's" +
        " reading rather than a configured one.",
    );
  }
  // Nothing in release-please's answer says which of two packages sharing a
  // component name a release belongs to, so a row that could be either says
  // so rather than presenting a guess as the working.
  for (const component of [...components.named].sort()) {
    const paths = (components.shared.get(component) ?? [])
      .map((p) => `\`${p.path}\``)
      .join(", ");
    warnings.push(
      `- ${paths} release under one component name, so a row's` +
        " **Current** and matched files may belong to either. Give each" +
        " package its own `component`.",
    );
  }
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
      `- \`${type}\` adds no changelog line and changes no version.` +
        ` ${branch(options)} releases the same versions without it.`,
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
  // Which of the two rules applies depends on whether a package is rooted at
  // the repository. `splitFiles` hands a root package every file, so printing
  // "a repository-root file matches nothing" there contradicted the very
  // listing above it -- as it did on every comment this action posted on its
  // own repository, which releases in plain mode from `.`.
  const rooted = projection.packages.some((p) => p.path === ROOT_PACKAGE_PATH);
  lines.push(
    "",
    rooted
      ? `Longest path wins; \`${ROOT_PACKAGE_PATH}\` takes every file besides.`
      : "Longest path wins; a repository-root file matches nothing.",
    "",
    "</details>",
  );
  return lines.join("\n");
}
