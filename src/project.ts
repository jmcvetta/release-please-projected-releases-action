/**
 * project runs release-please twice and reports the difference the pull
 * request makes.
 *
 * Once over the target branch as it stands, which is what the standing
 * release pull requests already hold, and once over the target branch with
 * the squash-merge of this pull request on top. Both answers are
 * release-please's own; nothing here recomputes a version.
 *
 * Two passes means two rounds of API reads rather than one. That is a handful
 * of requests against a five-figure hourly budget, and paying it buys the
 * "already pending" column without a second model of what release-please
 * would have said.
 */

import { Manifest } from "release-please";
import type { GitHub, ReleasePullRequest, Strategy } from "release-please";
import { componentOfBranch } from "./conventional.js";
import { splitFiles } from "./split.js";
import type { HeadOverrides, SyntheticCommit } from "./pr-view.js";
import { SeamError, viewWithPullRequest } from "./pr-view.js";

/** DEFAULT_CONFIG_FILE is release-please's config path. */
export const DEFAULT_CONFIG_FILE = "release-please-config.json";
/** DEFAULT_MANIFEST_FILE is release-please's version manifest path. */
export const DEFAULT_MANIFEST_FILE = ".release-please-manifest.json";

/** PackageConfig is the part of one configured package this preview reads. */
export interface PackageConfig {
  /** path is the directory whose commits the component releases. */
  path: string;
  /** component is the name the component's tags carry. */
  component: string;
  /**
   * releaseComponent is the name release-please attributes its releases to,
   * which is the key a projected release is joined to this package by.
   *
   * It is `component` for an ordinary package, and the empty string for one
   * that keeps the component out of its tags — release-please reports no
   * component for those, whatever the config calls them.
   */
  releaseComponent: string;
  /** current is the manifest version, the base the next bump applies to. */
  current: string | undefined;
  separator: string;
  includeComponent: boolean;
}

/**
 * tagFor spells the git tag release-please creates for a version. Mirrors
 * util/tag-name.ts, which is not exported; a wrong prefix here is visible on
 * sight, unlike a wrong version.
 */
export function tagFor(pkg: PackageConfig, version: string): string {
  if (!pkg.includeComponent || !pkg.component) return `v${version}`;
  return `${pkg.component}${pkg.separator}v${version}`;
}

/**
 * readPackages reads the configured components out of a parsed
 * release-please-config.json and .release-please-manifest.json.
 *
 * Per-package options override the top-level ones, which is how
 * release-please itself resolves them.
 *
 * The config need not name a component at all, and this cannot invent the
 * name release-please would derive for one that does not: that takes the
 * strategy, which takes the repository. `namePackages` fills those in
 * afterwards, from release-please itself.
 */
export function readPackages(
  config: Record<string, unknown>,
  manifest: Record<string, string>,
): PackageConfig[] {
  const packages = (config["packages"] ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const topSeparator = (config["tag-separator"] as string) ?? "-";
  const topInclude = (config["include-component-in-tag"] as boolean) ?? true;

  return Object.keys(packages)
    .sort()
    .map((path) => {
      const pkg = packages[path] ?? {};
      const component = (pkg["component"] as string) ?? "";
      const includeComponent =
        (pkg["include-component-in-tag"] as boolean) ?? topInclude;
      return {
        path,
        component,
        releaseComponent: includeComponent ? component : "",
        current: manifest[path],
        separator: (pkg["tag-separator"] as string) ?? topSeparator,
        includeComponent,
      };
    });
}

/**
 * namePackages replaces the configured component names with release-please's
 * own.
 *
 * A package need not declare a component. `release-type: node` derives one
 * from the package.json `name` (minus the scope), and other strategies derive
 * one too. Since a projected release is joined to a package by that name, a
 * package left holding the empty string matches no release: the table comes
 * out empty and the comment says "None" for a pull request that really would
 * cut a tag. Only release-please can say what the name is, so it is asked.
 *
 * `Manifest` builds its strategies internally and does not export them, so
 * this reaches for a private method. The strategies are already built and
 * cached by `buildPullRequests`, so asking costs nothing — but it is a seam,
 * and an upgrade could move it.
 *
 * A package that spells its own `component` needs none of this: the name
 * release-please would derive is the one the config already gives, so losing
 * the seam changes nothing and the run carries on. A package that does not is
 * the case this exists for, and there the fallback is the failure the whole
 * preview has to be loud about — an empty join key matches no release, so the
 * comment says "None" for a merge that really would cut a tag, and nothing on
 * screen looks wrong. That one raises `SeamError` rather than degrading, for
 * the same reason `assertConsulted` does: the breakage belongs on the
 * dependency-bump pull request, where someone is already looking.
 */
export async function namePackages(
  manifest: Manifest,
  packages: readonly PackageConfig[],
): Promise<PackageConfig[]> {
  // Only a package whose tags carry a component it did not spell needs a name
  // from release-please. One that keeps its component out of its tags reports
  // no component either way, and matches the releases that carry none.
  const derived = packages.filter((pkg) => !pkg.component && pkg.includeComponent);

  const build = (
    manifest as unknown as {
      getStrategiesByPath?: () => Promise<Record<string, Strategy>>;
    }
  ).getStrategiesByPath;
  if (typeof build !== "function") return withoutSeam(packages, derived, "gone");

  let strategies: Record<string, Strategy>;
  try {
    strategies = await build.call(manifest);
  } catch (error) {
    return withoutSeam(packages, derived, `unusable (${String(error)})`);
  }

  return await Promise.all(
    packages.map(async (pkg) => {
      const strategy = strategies[pkg.path];
      if (!strategy) {
        if (!pkg.component && pkg.includeComponent) {
          throw new SeamError(
            `release-please built no strategy for the package \`${pkg.path}\`,` +
              " whose config names no component, so the name its releases are" +
              " attributed to cannot be known. Every projected release for it" +
              " would be dropped from the comment.",
          );
        }
        return pkg;
      }
      // getBranchComponent is the name release-please knows the package by
      // whether or not it tags with it; getComponent is the empty string
      // when it does not, which is what the releases then carry.
      const [name, releaseComponent] = await Promise.all([
        strategy.getBranchComponent(),
        strategy.getComponent(),
      ]);
      return {
        ...pkg,
        component: pkg.component || name || "",
        releaseComponent: releaseComponent ?? "",
      };
    }),
  );
}

/**
 * withoutSeam decides what a missing `getStrategiesByPath` costs: nothing at
 * all when every package spells its own component, and the run otherwise.
 */
function withoutSeam(
  packages: readonly PackageConfig[],
  derived: readonly PackageConfig[],
  state: string,
): PackageConfig[] {
  if (derived.length === 0) return [...packages];
  throw new SeamError(
    `release-please's \`Manifest.getStrategiesByPath\` is ${state}, and` +
      ` ${derived.map((p) => `\`${p.path}\``).join(", ")} name no component in` +
      " release-please-config.json, so the name their releases are attributed" +
      " to cannot be known. Every projected release for them would be dropped" +
      " from the comment.",
  );
}

/** Release is one component release-please would open a release for. */
export interface Release {
  /** component is the release-please component name. */
  component: string;
  /** version is the version the release would carry. */
  version: string;
  /** notes are the rendered changelog entries, as release-please writes them. */
  notes: string;
}

/**
 * toReleases reads release-please's candidate release pull requests into the
 * flat form the comment renders.
 *
 * One pull request is not one release. Under `separate-pull-requests: true`
 * it is, and the component comes from the branch name, which release-please
 * derives from the base branch and component. The default aggregates every
 * component with pending changes into a single pull request instead: one
 * `releaseData` entry per component, on a branch naming none of them, and no
 * version on the pull request itself. Reading only the branch there would
 * report one release for a merge that cuts several tags, or none at all.
 *
 * So the entries decide whenever they can — they carry both the component and
 * the version — and the pull request's own version is the fallback for the
 * separate case, where it is the authoritative one.
 */
export function toReleases(
  prs: readonly ReleasePullRequest[],
  releaseBranchPrefix?: string,
): Release[] {
  const releases: Release[] = [];
  for (const pr of prs) {
    const data = pr.body.releaseData;
    const branchComponent = componentOfBranch(pr.headRefName, releaseBranchPrefix);
    const entries = data.flatMap((entry) => {
      const version = entry.version?.toString();
      return version
        ? [
            {
              component: entry.component ?? branchComponent ?? "",
              version,
              notes: entry.notes.trim(),
            },
          ]
        : [];
    });

    if (entries.length > 1 || (entries.length === 1 && !pr.version)) {
      releases.push(...entries);
      continue;
    }

    const version = pr.version?.toString();
    if (!version) continue;
    releases.push({
      component: branchComponent ?? data[0]?.component ?? "",
      version,
      notes: data
        .map((d) => d.notes.trim())
        .filter(Boolean)
        .join("\n\n"),
    });
  }
  return releases;
}

/** Projection is everything the comment needs to describe a pull request. */
export interface Projection {
  /** packages are the configured components and their manifest versions. */
  packages: PackageConfig[];
  /** touched maps a package path to the pull request's files under it. */
  touched: Map<string, string[]>;
  /** files are every path the pull request changes, owned or not. Needed to
   * say which directories a pull request that touches no component hit. */
  files: string[];
  /** projected is what merging this pull request leads to, per component. */
  projected: Release[];
  /** pending is what the target branch already releases without it. */
  pending: Release[];
  /** releaseAs is the version a `Release-As:` line in the body asked for. */
  releaseAs?: string;
  /**
   * ignoredReleaseAs is a `Release-As:` version release-please did not
   * honour, which happens silently when non-trailer text follows the note.
   * Observed by comparing the versions release-please actually returned
   * against the one the note asked for, rather than by mirroring the
   * trailer-placement rule that decides it.
   */
  ignoredReleaseAs?: string;
}

/** ProjectOptions are the inputs to a projection. */
export interface ProjectOptions {
  github: GitHub;
  commit: SyntheticCommit;
  config: Record<string, unknown>;
  manifest: Record<string, string>;
  configFile?: string;
  manifestFile?: string;
  /** releaseBranchPrefix is how release-please names its release branches,
   * which is how a candidate release is attributed to a component. */
  releaseBranchPrefix?: string;
}

// A `Release-As:` note on a line of its own. The key is matched
// case-insensitively because release-please lowercases the footer token
// before comparing it, and `release-as: 1.2.3` is honoured (measured).
const RELEASE_AS_LINE = /^release-as:[ \t]*(\S.*?)[ \t]*$/i;

// A fenced code block's opening or closing line, indented up to three spaces
// as CommonMark allows.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// release-please reads the version out of a note with an unanchored match
// (util/version.ts VERSION_REGEX), so `Release-As: 1.1.1 was the old one`
// forces 1.1.1 rather than failing. SEEN mirrors that; MEANT is the anchored
// form, which is what a note someone wrote on purpose looks like.
const SEEN = /\d+\.\d+\.\d+(?:-[^+\s]+)?(?:\+\S+)?/;
const MEANT = /^\d+\.\d+\.\d+(?:-[^+\s]+)?(?:\+\S+)?$/;

/** ReleaseAsNotes are the `Release-As:` notes a pull request body carries. */
export interface ReleaseAsNotes {
  /**
   * seen is every version a note in the body could be read as asking for, in
   * document order. Permissive: it exists to recognize that release-please
   * honoured *one* of them, and a note that forced a version is not an
   * ignored note whichever line it came from.
   */
  seen: string[];
  /**
   * meant is the note the pull request can fairly be said to have asked for,
   * or undefined when nothing in the body qualifies. Strict: only this one
   * can raise the "was ignored" warning, which is why the bar is a line
   * someone plausibly wrote as a trailer rather than any mention at all.
   */
  meant: string | undefined;
}

/**
 * releaseAsNotes reads the `Release-As:` notes out of a pull request body.
 *
 * Whether release-please honours a note is not decided here — that is
 * observed afterwards, from the versions it returned. What is decided here is
 * narrower and still needed: which lines were notes at all. A body that
 * *discusses* the trailer is not asking for a version, and in a repository
 * whose contributors have been bitten by the placement rule that body is
 * ordinary, so a mention must be able to stay a mention.
 *
 * A mention stays a mention by being quoted the way prose quotes anything:
 * inside a code fence, in backticks, in a blockquote, or indented. Only a
 * line beginning at column 0 with nothing after the version counts, and a
 * placeholder such as `Release-As: x.y.z` counts as nothing at all, since
 * release-please could not have parsed it as a version.
 *
 * What is deliberately *not* excluded is a qualifying line in the middle of a
 * body. It is the exact shape of the failure this warns about — a note with
 * non-trailer text below it, which release-please drops in silence — so it is
 * read as a note that will be ignored rather than as prose.
 */
export function releaseAsNotes(body: string): ReleaseAsNotes {
  const seen: string[] = [];
  const meant: string[] = [];
  let fence: string | undefined;

  for (const line of body.split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;

    const value = RELEASE_AS_LINE.exec(line)?.[1];
    if (value === undefined) continue;
    const version = SEEN.exec(value)?.[0];
    if (!version) continue;
    seen.push(version);
    if (MEANT.test(value)) meant.push(version);
  }

  // The last one, because a trailer sits at the end of a message: an earlier
  // line saying what the version used to be is not the ask.
  return { seen, meant: meant[meant.length - 1] };
}

/**
 * project runs both passes and assembles the result.
 *
 * The head's config and manifest are served to the pull request pass, because
 * after the merge those are the files master carries: a branch that adds a
 * component should preview as adding one. The target-branch pass reads the
 * target branch normally, since that is the state it describes.
 */
export async function project(options: ProjectOptions): Promise<Projection> {
  const configFile = options.configFile ?? DEFAULT_CONFIG_FILE;
  const manifestFile = options.manifestFile ?? DEFAULT_MANIFEST_FILE;
  const declared = readPackages(options.config, options.manifest);
  const overrides: HeadOverrides = {
    [configFile]: options.config,
    [manifestFile]: options.manifest,
  };

  const view = viewWithPullRequest(
    options.github,
    options.commit,
    overrides,
  );
  const withPr = await Manifest.fromManifest(
    view.github,
    options.commit.baseBranch,
    configFile,
    manifestFile,
  );
  const prefix = options.releaseBranchPrefix;
  const projected = toReleases(await withPr.buildPullRequests(), prefix);
  view.assertConsulted();

  // After the pull requests are built, so the strategies this reads are the
  // ones release-please has already constructed and cached.
  const packages = await namePackages(withPr, declared);

  const withoutPr = await Manifest.fromManifest(
    options.github,
    options.commit.baseBranch,
    configFile,
    manifestFile,
  );
  const pending = toReleases(await withoutPr.buildPullRequests(), prefix);

  const touched = splitFiles(
    options.commit.files,
    packages.map((p) => p.path),
  );

  // A note was honoured when release-please returned the version it names.
  // Any note in the body will do for that: honouring the wrong one is still
  // not ignoring the ask, and reporting the note that was ignored is the
  // whole point of the warning.
  const notes = releaseAsNotes(options.commit.body);
  const honoured = notes.seen.find((v) => projected.some((r) => r.version === v));
  const asked = honoured ?? notes.meant;
  const ignoredReleaseAs =
    !honoured && notes.meant && touched.size > 0 ? notes.meant : undefined;

  return {
    packages,
    touched,
    files: [...options.commit.files],
    projected,
    pending,
    ...(asked ? { releaseAs: asked } : {}),
    ...(ignoredReleaseAs ? { ignoredReleaseAs } : {}),
  };
}
