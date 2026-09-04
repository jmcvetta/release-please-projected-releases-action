import { beforeAll, describe, expect, it } from "vitest";
import { GitHub, setLogger } from "release-please";
import type { Commit, GitHub as GitHubType } from "release-please";
import { commitSource } from "./commits.js";
import { startFakeGitHub } from "./fake-github-server.fixture.js";
import { project } from "./project.js";

beforeAll(() => {
  const quiet = () => {};
  setLogger({
    debug: quiet,
    info: quiet,
    warn: quiet,
    error: quiet,
    trace: quiet,
    fatal: quiet,
  } as Parameters<typeof setLogger>[0]);
});

/** history is a client whose walk can be watched: how many times it was
 * started, and which commits it actually handed out. */
function history(shas: string[]): {
  github: GitHubType;
  walks: number;
  yielded: string[];
  backfilled: string[];
} {
  const state = {
    walks: 0,
    yielded: [] as string[],
    backfilled: [] as string[],
    github: undefined as unknown as GitHubType,
  };
  state.github = {
    async *mergeCommitIterator(): AsyncGenerator<Commit> {
      state.walks += 1;
      for (const sha of shas) {
        state.yielded.push(sha);
        yield { sha, message: "fix: a thing", files: [] };
      }
    },
    async getCommitFiles(sha: string): Promise<string[]> {
      state.backfilled.push(sha);
      return [`from-api/${sha}.ts`];
    },
  } as unknown as GitHubType;
  return state as never;
}

async function walk(
  github: GitHubType,
  options?: Parameters<GitHubType["mergeCommitIterator"]>[1],
  stopAfter = Number.POSITIVE_INFINITY,
): Promise<string[]> {
  const out: string[] = [];
  for await (const commit of github.mergeCommitIterator("master", options)) {
    out.push(commit.sha);
    if (out.length >= stopAfter) break;
  }
  return out;
}

describe("the cached walk", () => {
  it("reads the history once and replays it to the second pass", async () => {
    const client = history(["a", "b", "c"]);
    const source = commitSource(client.github);

    expect(await walk(source)).toEqual(["a", "b", "c"]);
    expect(await walk(source)).toEqual(["a", "b", "c"]);
    expect(client.walks).toBe(1);
    expect(client.yielded).toEqual(["a", "b", "c"]);
  });

  it("continues the upstream walk the first pass stopped short of", async () => {
    // release-please stops by breaking out of a `for await`, which calls
    // return() on the generator it is reading. Forwarding that upstream --
    // which `yield*` does -- would close the shared walk for good, and the
    // second pass would silently see only what the first one happened to
    // need.
    const client = history(["a", "b", "c", "d"]);
    const source = commitSource(client.github);

    expect(await walk(source, undefined, 2)).toEqual(["a", "b"]);
    expect(await walk(source)).toEqual(["a", "b", "c", "d"]);
    expect(client.walks).toBe(1);
    expect(client.yielded).toEqual(["a", "b", "c", "d"]);
  });

  it("delegates a walk asking a different question", async () => {
    const client = history(["a", "b"]);
    const source = commitSource(client.github);

    await walk(source, { maxResults: 500 });
    await walk(source, { maxResults: 50 });
    expect(client.walks).toBe(2);
  });

  it("hands the client back untouched when the seam has moved", () => {
    // pr-view.ts raises the error for this; here it is only important that
    // nothing wraps a method that is not there.
    const moved = {} as unknown as GitHubType;
    expect(commitSource(moved)).toBe(moved);
  });
});

describe("the commit file lists", () => {
  it("come from the local index when it knows the commit", async () => {
    const client = history(["a"]);
    const source = commitSource(client.github, {
      files: (sha) => (sha === "a" ? ["local/a.ts"] : undefined),
    });
    expect(await source.getCommitFiles("a")).toEqual(["local/a.ts"]);
    expect(client.backfilled).toEqual([]);
  });

  it("fall back to the API for a commit it does not", async () => {
    const client = history(["a"]);
    const source = commitSource(client.github, { files: () => undefined });
    expect(await source.getCommitFiles("z")).toEqual(["from-api/z.ts"]);
    expect(client.backfilled).toEqual(["z"]);
  });
});

/**
 * The rest of this file drives real release-please over real HTTP.
 *
 * What it is here to catch is the receiver. release-please backfills a file
 * list by calling `this.getCommitFiles` from inside its own iterator, so an
 * override installed on a wrapper only ever runs if the wrapper is the
 * receiver that iterator was started with. Get that wrong and everything
 * still works — the API answers, the projection is right, and the index this
 * builds is simply never consulted. Nothing fails; the action is just slow
 * again.
 */

const CONFIG = {
  "separate-pull-requests": true,
  packages: {
    api: { "release-type": "simple", component: "acme-api" },
    ui: { "release-type": "simple", component: "acme-ui" },
  },
};
const MANIFEST = { api: "2.4.1", ui: "1.0.0" };
const RELEASE_SHA = "0".repeat(40);

/**
 * projectOverHttp projects one pull request against a branch holding a single
 * direct-push commit, whose file list the API reports under `ui/`.
 *
 * The index, when given, says `api/` instead. They disagree on purpose: the
 * component that comes out names which of the two release-please read.
 */
async function projectOverHttp(
  files?: (sha: string) => string[] | undefined,
): Promise<{ pending: string[]; requests: string[] }> {
  const fake = await startFakeGitHub({
    owner: "acme",
    repo: "widgets",
    branch: "master",
    files: {
      "release-please-config.json": JSON.stringify(CONFIG),
      ".release-please-manifest.json": JSON.stringify(MANIFEST),
    },
    commits: [
      {
        sha: "feed01",
        message: "feat: a thing",
        files: ["ui/x.ts"],
        unassociated: true,
      },
      { sha: RELEASE_SHA, message: "chore: release", files: [] },
    ],
    releases: [
      { tagName: "acme-api-v2.4.1", sha: RELEASE_SHA },
      { tagName: "acme-ui-v1.0.0", sha: RELEASE_SHA },
    ],
  });

  try {
    const github = await GitHub.create({
      owner: "acme",
      repo: "widgets",
      defaultBranch: "master",
      token: "fake",
      apiUrl: fake.url,
      graphqlUrl: fake.url,
    });
    const projection = await project({
      github,
      config: CONFIG,
      manifest: MANIFEST,
      ...(files ? { commitFiles: files } : {}),
      commit: {
        title: "docs: nothing releasable",
        body: "",
        files: ["README.md"],
        number: 7,
        headSha: "c".repeat(40),
        headBranch: "topic",
        baseBranch: "master",
      },
    });
    return {
      pending: projection.pending.map((release) => release.component),
      requests: [...fake.requests],
    };
  } finally {
    await fake.close();
  }
}

describe("the file lists release-please reads", () => {
  it("come from the index, and decide the answer", async () => {
    const seen = await projectOverHttp((sha) =>
      sha === "feed01" ? ["api/x.ts"] : undefined,
    );
    expect(seen.pending).toEqual(["acme-api"]);
    expect(seen.requests).not.toContain("GET /repos/acme/widgets/commits/feed01");
  });

  it("fall back to a request per commit when the index has none", async () => {
    const seen = await projectOverHttp();
    expect(seen.pending).toEqual(["acme-ui"]);
    expect(seen.requests).toContain("GET /repos/acme/widgets/commits/feed01");
  });
});
