/**
 * fake-scm builds a release-please `GitHub` backed by fixtures instead of the
 * API, so the tests can drive real release-please code.
 *
 * That is the point of the file. The rules this preview used to mirror were
 * each read off release-please's source, and two of them were read *wrongly*
 * — hidden types were thought to release, and a miscased type was thought to
 * fail outright. Both were corrected only by executing release-please. So the
 * tests assert what release-please actually does with a fixture, never what
 * its source appears to say.
 */

import type { Commit, GitHub } from "release-please";

/** FakeRelease is one published release, as release-please reads it. */
export interface FakeRelease {
  tagName: string;
  sha: string;
}

/** FakeScmOptions are the fixtures a fake repository is built from. */
export interface FakeScmOptions {
  /** config is the parsed release-please-config.json. */
  config: unknown;
  /** manifest is the parsed .release-please-manifest.json. */
  manifest: Record<string, string>;
  /** releases are the latest release per component. Defaults to one per
   * manifest entry, all at the sentinel sha, which is how a repository with
   * nothing unreleased looks. */
  releases?: FakeRelease[];
  /** commits are the merge commits on the target branch, newest first, above
   * the release sentinel. Defaults to none. */
  commits?: Commit[];
  /**
   * files are the file contents on the target branch, keyed by repository
   * path. Only what a strategy reads for itself needs to be here — a
   * package.json, say, which is where `release-type: node` finds the
   * component name a config that declares none leaves it to derive.
   */
  files?: Record<string, string>;
  configFile?: string;
  manifestFile?: string;
  /** record collects what the commit walk was asked for and what it handed
   * back, for the tests that are about the walk rather than the versions. */
  record?: WalkRecord;
}

/** WalkRecord is what a fake repository saw of the commit walks over it. */
export interface WalkRecord {
  /** walks is one entry per call of the iterator, with the options it was
   * given. A second entry means the history was read twice. */
  walks: { targetBranch: string; options: unknown }[];
  /** yielded is every commit sha handed out, in order and with repeats. */
  yielded: string[];
}

/** walkRecord is an empty record, for a test to hand in and read after. */
export function walkRecord(): WalkRecord {
  return { walks: [], yielded: [] };
}

/** RELEASE_SHA is the commit every fixture release points at. The commit
 * walk stops when it has seen every release sha, so this is what bounds it. */
export const RELEASE_SHA = "0000000000000000000000000000000000000000";

/**
 * fakeScm returns something release-please's `Manifest` accepts as a
 * `GitHub`, serving the given fixtures and nothing else.
 */
export function fakeScm(options: FakeScmOptions): GitHub {
  const configFile = options.configFile ?? "release-please-config.json";
  const manifestFile = options.manifestFile ?? ".release-please-manifest.json";
  const packages = (options.config as { packages?: Record<string, { component?: string }> })
    .packages ?? {};

  const releases =
    options.releases ??
    Object.entries(options.manifest).map(([path, version]) => ({
      tagName: `${packages[path]?.component ?? ""}@v${version}`,
      sha: RELEASE_SHA,
    }));

  // The sentinel release commit terminates the walk. Without it the iterator
  // runs to exhaustion and release-please warns about missing releases.
  const history: Commit[] = [
    ...(options.commits ?? []),
    { sha: RELEASE_SHA, message: "chore: release", files: [] },
  ];

  const scm = {
    repository: { owner: "acme", repo: "widgets", defaultBranch: "master" },
    async getFileJson(path: string): Promise<unknown> {
      if (path === configFile) return options.config;
      if (path === manifestFile) return options.manifest;
      throw new Error(`unexpected getFileJson: ${path}`);
    },
    async *mergeCommitIterator(
      targetBranch: string,
      iteratorOptions?: unknown,
    ): AsyncGenerator<Commit> {
      options.record?.walks.push({ targetBranch, options: iteratorOptions });
      for (const commit of history) {
        options.record?.yielded.push(commit.sha);
        yield commit;
      }
    },
    async *releaseIterator(): AsyncGenerator<
      FakeRelease & { notes: string }
    > {
      for (const release of releases) yield { ...release, notes: "" };
    },
    async *tagIterator(): AsyncGenerator<never> {},
    async getFileContentsOnBranch(path: string): Promise<unknown> {
      const content = options.files?.[path];
      if (content === undefined) {
        throw Object.assign(new Error(`not found: ${path}`), { status: 404 });
      }
      return {
        sha: "",
        mode: "100644",
        content: Buffer.from(content, "utf8").toString("base64"),
        parsedContent: content,
      };
    },
    async findFilesByFilenameAndRef(): Promise<string[]> {
      return [];
    },
    async findFilesByExtensionAndRef(): Promise<string[]> {
      return [];
    },
  };
  return scm as unknown as GitHub;
}
