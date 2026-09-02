/**
 * run is the whole job in one function, shared by the action and the CLI.
 *
 * Both entry points do the same thing and differ only in where the inputs
 * come from: the action reads them from the runner and the webhook payload,
 * the CLI from flags. Keeping the work here means driving the tool by hand
 * from a checkout exercises the same code path a pull request does, which is
 * how a projection gets compared against the merge that follows it.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GitHub, setLogger } from "release-please";
import type { GitHub as GitHubType } from "release-please";
import { isMalformed, resolveTypes } from "./conventional.js";
import type { TypeSet } from "./conventional.js";
import { project, DEFAULT_CONFIG_FILE, DEFAULT_MANIFEST_FILE } from "./project.js";
import type { PlainConfig, Projection } from "./project.js";
import { render } from "./render.js";

/** EMPTY is the projection rendered when the title is withheld from one. */
const EMPTY: Projection = {
  packages: [],
  touched: new Map(),
  files: [],
  projected: [],
  pending: [],
};

/** RunOptions are everything a projection needs, from either entry point. */
export interface RunOptions {
  owner: string;
  repo: string;
  token: string;
  /** apiUrl is the REST root release-please reads through, for GitHub
   * Enterprise Server. Undefined means github.com. */
  apiUrl?: string | undefined;
  /** graphqlUrl is the GraphQL endpoint, for GitHub Enterprise Server, where
   * it is not derivable from the REST root. */
  graphqlUrl?: string | undefined;
  /** title is the pull request title, which squash-merge makes the subject. */
  title: string;
  /** body is the pull request description, which becomes the commit body. */
  body: string;
  /** number is the pull request number, so changelog lines can link to it. */
  number: number;
  /** base is the branch the pull request targets, by name. */
  base: string;
  /** headSha is the commit the projection describes. */
  headSha: string;
  /** headBranch is the pull request's head branch. */
  headBranch: string;
  /** files are the paths the pull request changes. */
  files: string[];
  /** repoRoot is the checkout the config and manifest are read from. */
  repoRoot?: string;
  /**
   * plain selects release-please's non-manifest mode: one package configured
   * here rather than by a release-please-config.json in the checkout. Nothing
   * is read from disk when it is set.
   */
  plain?: PlainConfig | undefined;
  configFile?: string;
  manifestFile?: string;
  /** releasePrs maps a component to its standing release pull request URL. */
  releasePrs?: Map<string, string>;
  /** runUrl is this workflow run, linked from the comment's footer. */
  runUrl?: string;
  /** typeOverrides force the changelog type list, when a caller knows better
   * than the config does. */
  typeOverrides?: { visible?: readonly string[]; hidden?: readonly string[] };
  /** releaseBranchPrefix is how release-please names its release branches. */
  releaseBranchPrefix?: string;
  /** advisories are notes the caller found that the projection cannot see,
   * chiefly about how the repository merges. */
  advisories?: readonly string[];
  /** now is the render time; injected so the footer is testable. */
  now?: Date;
  /**
   * github replaces the client this would otherwise build from `owner`,
   * `repo` and `token`. Injected so the whole path from options to rendered
   * markdown can be tested against a fixture repository, which is the only
   * way to test what release-please actually does with one.
   */
  github?: GitHubType;
}

/** Outcome is the rendered comment plus what it was rendered from. */
export interface Outcome {
  /** body is the comment markdown. */
  body: string;
  /** projection is what release-please returned, empty when withheld. */
  projection: Projection;
  /** malformed reports that the projection was withheld. */
  malformed: boolean;
  /** types is the changelog type list this run resolved. */
  types: TypeSet;
}

/**
 * graphqlRoot normalizes a GraphQL URL to the form release-please wants.
 *
 * release-please hands the value to Octokit as `baseUrl`, and Octokit appends
 * `/graphql` to it -- so its own default is `https://api.github.com`, the API
 * root, not the endpoint. A runner's `GITHUB_GRAPHQL_URL` is the endpoint
 * (`https://api.github.com/graphql`), and so is `${{ github.graphql_url }}`,
 * which is the obvious thing for a caller to pass. Handing either through
 * unchanged produces `https://api.github.com/graphql/graphql` and a bare
 * `HttpError: Not Found` from the first merge-commit query.
 *
 * Found by running the action on its own pull request, which is the only
 * place this could be found: every test drives a fixture `GitHub` that is
 * never constructed from a URL.
 */
export function graphqlRoot(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/graphql$/, "");
}

/**
 * quietLogger sends release-please's logging to stderr.
 *
 * It logs to stdout by default, which for the CLI would land in the middle of
 * the comment body it prints there. On a runner both streams reach the same
 * log, so nothing is lost either way.
 */
export function quietLogger(): void {
  const toStderr = (...args: unknown[]) => console.error(...args);
  setLogger({
    debug: toStderr,
    info: toStderr,
    warn: toStderr,
    error: toStderr,
    trace: toStderr,
    fatal: toStderr,
  } as Parameters<typeof setLogger>[0]);
}

/**
 * buildComment renders the projected-releases comment for one pull request.
 *
 * A malformed title short-circuits the whole thing: such a title is not
 * mergeable under a title gate and misleading without one, so a projection
 * from it describes a commit that will never exist. Nothing is worth
 * fetching.
 */
export async function buildComment(options: RunOptions): Promise<Outcome> {
  const root = options.repoRoot ?? ".";
  const configFile = options.configFile ?? DEFAULT_CONFIG_FILE;
  const manifestFile = options.manifestFile ?? DEFAULT_MANIFEST_FILE;
  const readJson = (path: string) =>
    JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<
      string,
      unknown
    >;

  // Plain mode has no files to read. The empty objects stand in so the rest
  // of the pipeline keeps one shape; `project` ignores them when `plain` is
  // set.
  const config = options.plain ? {} : readJson(configFile);
  const manifest = options.plain
    ? {}
    : (readJson(manifestFile) as Record<string, string>);

  const types = resolveTypes({
    // A plain-mode caller declares its changelog sections on the releaser
    // config rather than in a file, and they mean the same thing: the
    // types this repository's changelog recognizes.
    config: options.plain?.changelogSections
      ? { "changelog-sections": options.plain.changelogSections }
      : config,
    ...(options.typeOverrides?.visible
      ? { visible: options.typeOverrides.visible }
      : {}),
    ...(options.typeOverrides?.hidden
      ? { hidden: options.typeOverrides.hidden }
      : {}),
    ...(options.releaseBranchPrefix
      ? { releaseBranchPrefix: options.releaseBranchPrefix }
      : {}),
  });

  const malformed = isMalformed(options.title, types);

  const projection = malformed
    ? EMPTY
    : await projectPullRequest(options, config, manifest, {
        configFile,
        manifestFile,
        releaseBranchPrefix: types.releaseBranchPrefix,
      });

  const body = render(projection, {
    title: options.title,
    malformed,
    types,
    ...(options.releasePrs ? { releasePrs: options.releasePrs } : {}),
    ...(options.headSha ? { headSha: options.headSha } : {}),
    ...(options.runUrl ? { runUrl: options.runUrl } : {}),
    ...(options.base ? { base: options.base } : {}),
    ...(options.advisories ? { advisories: options.advisories } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  return { body, projection, malformed, types };
}

async function projectPullRequest(
  options: RunOptions,
  config: Record<string, unknown>,
  manifest: Record<string, string>,
  files: {
    configFile: string;
    manifestFile: string;
    releaseBranchPrefix: string;
  },
): Promise<Projection> {
  const github =
    options.github ??
    (await GitHub.create({
      owner: options.owner,
      repo: options.repo,
      defaultBranch: options.base,
      ...(options.token ? { token: options.token } : {}),
      ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
      ...(options.graphqlUrl
      ? { graphqlUrl: graphqlRoot(options.graphqlUrl) }
      : {}),
    }));

  return project({
    github,
    config,
    manifest,
    configFile: files.configFile,
    manifestFile: files.manifestFile,
    releaseBranchPrefix: files.releaseBranchPrefix,
    // Serve the head's copy of any file the pull request changes. release-please
    // reads the package file from the target branch to name the component, and a
    // pull request that adds it -- adopting release-please -- has a target branch
    // without it. After the merge, the head's copy is the one that branch has.
    readHeadFile: (path: string) => {
      if (!options.files.includes(path)) return undefined;
      const full = resolve(options.repoRoot ?? ".", path);
      return existsSync(full) ? readFileSync(full, "utf8") : undefined;
    },
    ...(options.plain ? { plain: options.plain } : {}),
    commit: {
      title: options.title,
      body: options.body,
      files: options.files,
      number: options.number,
      headSha: options.headSha || "0".repeat(40),
      headBranch: options.headBranch || "HEAD",
      baseBranch: options.base,
    },
  });
}
