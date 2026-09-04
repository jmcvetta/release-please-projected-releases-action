/**
 * conventional decides which Conventional Commit types this repository's
 * changelog recognizes, and judges a pull request title against them.
 *
 * The projection itself does not need these types: release-please resolves
 * them from the config and decides what releases. They survive for the two
 * jobs that are not release-please's — withholding a projection when the
 * title is one that will never become a mergeable commit, and naming the
 * visible types in the message that explains why nothing releases.
 *
 * A fixed list does not travel: another repository's changelog may recognize
 * other types, and its title gate is its own. So the list is resolved per run
 * — from the
 * `changelog-sections` in release-please's own config when it declares them,
 * from explicit inputs when the caller overrides them, and otherwise from the
 * conventionalcommits defaults in conventional-types.json. The action reports
 * the resolved list as an output, which is how a caller's title gate can be
 * pinned to the same set without copying it.
 */

import { readFileSync } from "node:fs";

/** ConventionalTypes is the shape of conventional-types.json. */
interface ConventionalTypes {
  visible: string[];
  hidden: string[];
  releaseBranchPrefix: string;
}

// Read at runtime rather than imported, so the file stays a data file a
// caller in any language can parse. `../` resolves to the package root from
// src/ (vitest), build/ (tsc output) and dist/ (the bundled action) alike.
const data: ConventionalTypes = JSON.parse(
  readFileSync(new URL("../conventional-types.json", import.meta.url), "utf8"),
);

/**
 * TypeSet is one resolved answer to "which commit types does this
 * repository's changelog recognize, and which of them open a release".
 */
export interface TypeSet {
  /** visible are the types that render a changelog line, and so can open a
   * release on their own. */
  visible: ReadonlySet<string>;
  /** hidden are recognized but render nothing. A component whose whole
   * unreleased set is hidden is skipped rather than released. */
  hidden: ReadonlySet<string>;
  /** recognized is the union: every type a title may legitimately carry. */
  recognized: ReadonlySet<string>;
  /** releaseBranchPrefix is how release-please names its own release pull
   * request branches. */
  releaseBranchPrefix: string;
}

function typeSet(
  visible: Iterable<string>,
  hidden: Iterable<string>,
  releaseBranchPrefix: string,
): TypeSet {
  const v = new Set(visible);
  const h = new Set([...hidden].filter((t) => !v.has(t)));
  return {
    visible: v,
    hidden: h,
    recognized: new Set([...v, ...h]),
    releaseBranchPrefix,
  };
}

/**
 * DEFAULT_TYPES are the default `types` of
 * conventional-changelog-conventionalcommits, which is what release-please
 * writes notes with when a config declares no `changelog-sections`.
 */
export const DEFAULT_TYPES: TypeSet = typeSet(
  data.visible,
  data.hidden,
  data.releaseBranchPrefix,
);

/** VISIBLE_TYPES are the default visible types. Prefer a resolved TypeSet. */
export const VISIBLE_TYPES: ReadonlySet<string> = DEFAULT_TYPES.visible;
/** HIDDEN_TYPES are the default hidden types. Prefer a resolved TypeSet. */
export const HIDDEN_TYPES: ReadonlySet<string> = DEFAULT_TYPES.hidden;
/** RECOGNIZED_TYPES is the default union. Prefer a resolved TypeSet. */
export const RECOGNIZED_TYPES: ReadonlySet<string> = DEFAULT_TYPES.recognized;

/**
 * RELEASE_BRANCH_PREFIX is how release-please names the branch of its own
 * release pull requests. A workflow skips those: merging one cuts its tag
 * from the manifest and changelog already written into the branch, never from
 * the type in its title, so this preview's model does not describe it.
 */
export const RELEASE_BRANCH_PREFIX = DEFAULT_TYPES.releaseBranchPrefix;

/** ChangelogSection is one entry of release-please's `changelog-sections`. */
interface ChangelogSection {
  type?: unknown;
  hidden?: unknown;
}

/** sectionsOf collects every `changelog-sections` array in a config: the
 * top-level one and each package's, since a package may override it. */
function sectionsOf(config: Record<string, unknown>): ChangelogSection[][] {
  const found: ChangelogSection[][] = [];
  const take = (value: unknown) => {
    if (Array.isArray(value)) found.push(value as ChangelogSection[]);
  };
  take(config["changelog-sections"]);
  const packages = (config["packages"] ?? {}) as Record<string, unknown>;
  for (const pkg of Object.values(packages)) {
    if (pkg && typeof pkg === "object") {
      take((pkg as Record<string, unknown>)["changelog-sections"]);
    }
  }
  return found;
}

/** ResolveOptions are the sources a TypeSet is resolved from, in order of
 * precedence: an explicit list beats the config, which beats the defaults. */
export interface ResolveOptions {
  /** config is the parsed release-please-config.json, read for
   * `changelog-sections`. */
  config?: Record<string, unknown>;
  /** visible overrides the visible types entirely. */
  visible?: readonly string[];
  /** hidden overrides the hidden types entirely. */
  hidden?: readonly string[];
  /** releaseBranchPrefix overrides release-please's branch naming, for a
   * repository that has changed it. */
  releaseBranchPrefix?: string;
}

/**
 * resolveTypes works out which types this repository's changelog recognizes.
 *
 * A config that declares `changelog-sections` has replaced the preset's
 * `types` wholesale, so the declared sections are the whole *visible* list
 * rather than an addition to it. Sections are unioned across the top level
 * and every package: a type any component renders is a type that can open a
 * release, so calling it hidden repository-wide would be wrong for that
 * component.
 *
 * What the sections do not narrow is `recognized`. A type they omit renders
 * nothing, which is what hidden means; it does not stop being a commit type
 * a contributor may legitimately write. Only the explicit `visible`/`hidden`
 * overrides narrow that, because a caller passing them is describing their
 * own title gate.
 */
export function resolveTypes(options: ResolveOptions = {}): TypeSet {
  const prefix =
    options.releaseBranchPrefix ?? DEFAULT_TYPES.releaseBranchPrefix;

  const sections = options.config ? sectionsOf(options.config) : [];
  let visible: string[] = [...DEFAULT_TYPES.visible];
  let hidden: string[] = [...DEFAULT_TYPES.hidden];

  if (sections.length > 0) {
    const declaredVisible = new Set<string>();
    const declaredHidden = new Set<string>();
    for (const section of sections.flat()) {
      const type = section.type;
      if (typeof type !== "string" || !type) continue;
      if (section.hidden === true) declaredHidden.add(type);
      else declaredVisible.add(type);
    }
    if (declaredVisible.size + declaredHidden.size > 0) {
      visible = [...declaredVisible];
      // A type the sections leave out is hidden, not unrecognized. The
      // sections replace the preset's `types`, so it renders no changelog
      // line and cannot open a release on its own -- but the parser still
      // reads it and release-please still versions from it, so a title
      // carrying it is a perfectly ordinary commit. Dropping it from
      // `recognized` instead made `isMalformed` reject one: a repository
      // declaring only feat/fix/perf sections got "None -- malformed PR
      // title" on every `chore:` and `docs:` pull request it had.
      hidden = [
        ...new Set([
          ...declaredHidden,
          ...DEFAULT_TYPES.visible,
          ...DEFAULT_TYPES.hidden,
        ]),
      ];
    }
  }

  if (options.visible) visible = [...options.visible];
  if (options.hidden) hidden = [...options.hidden];
  return typeSet(visible, hidden, prefix);
}

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
 * isMalformed reports a title that will not become a usable commit subject.
 *
 * Three ways in: it does not parse as a Conventional Commit, its type is not
 * one the changelog recognizes, or the type is not lowercase. That last one
 * is the case worth catching, because it half-works rather than failing:
 * `Feat:` renders a correct-looking Features entry (the changelog preset
 * lowercases before matching) while bumping only a patch (the versioning
 * strategy compares the type literally), so a feature ships as a patch with
 * no error anywhere.
 *
 * A malformed title is not mergeable under a title gate and is misleading
 * without one, so any projection from it describes a commit that will never
 * exist, or one whose changelog lies. The caller withholds one.
 */
export function isMalformed(
  title: string,
  types: TypeSet = DEFAULT_TYPES,
): boolean {
  const type = titleType(title);
  if (type === undefined) return true;
  if (type !== type.toLowerCase()) return true;
  return !types.recognized.has(type);
}

/**
 * isReleaseBranch reports whether a branch is one of release-please's own
 * release pull request branches.
 */
export function isReleaseBranch(
  branch: string,
  prefix: string = DEFAULT_TYPES.releaseBranchPrefix,
): boolean {
  return branch.startsWith(prefix);
}

/** escape quotes a string for use as a regular expression literal. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ReleaseBranch is what release-please's branch naming encodes: which
 * branch the release targets, and which component it is for. */
export interface ReleaseBranch {
  /** base is the branch the release pull request targets. */
  base: string;
  /** component is the component the release is for, empty for a branch with
   * no `--components--` segment. */
  component: string;
}

/**
 * releaseBranch takes release-please's branch naming apart, or returns
 * undefined when the branch is not one of its release branches.
 *
 * release-please names a release branch deterministically
 * (`util/branch-name.ts`), so both halves can be recovered without asking the
 * API what the pull request is for. A repository releasing a single
 * component, or aggregating every component into one pull request, gets a
 * branch with no `--components--` segment; that is a release branch for the
 * unnamed component, so the component is the empty string rather than
 * undefined.
 *
 * The base matters because the component alone does not identify a release
 * pull request. A repository maintaining a `v1.x` branch alongside `master`
 * has a standing release pull request on each, and under the ordinary
 * aggregated configuration both name no component at all — so keyed by
 * component they are the same key, and the comment on a `master` pull request
 * linked whichever of them was read last.
 */
export function releaseBranch(
  branch: string,
  prefix: string = DEFAULT_TYPES.releaseBranchPrefix,
): ReleaseBranch | undefined {
  const pattern = new RegExp(
    `^${escape(prefix)}branches--(?<base>[^-]|.+?)(?:--components--(?<component>.+))?$`,
  );
  const groups = pattern.exec(branch.trim())?.groups;
  if (!groups) return undefined;
  return { base: groups["base"] ?? "", component: groups["component"] ?? "" };
}

/**
 * componentOfBranch recovers the component name from a release branch, or
 * undefined when the branch is not one. See releaseBranch, which also says
 * which branch the release targets.
 */
export function componentOfBranch(
  branch: string,
  prefix: string = DEFAULT_TYPES.releaseBranchPrefix,
): string | undefined {
  return releaseBranch(branch, prefix)?.component;
}
