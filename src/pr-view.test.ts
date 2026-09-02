import { describe, expect, it } from "vitest";
import type { Commit, GitHub } from "release-please";
import { SeamError, viewWithPullRequest } from "./pr-view.js";

const COMMIT = {
  title: "feat: a thing",
  body: "why it matters",
  files: ["api/x.ts"],
  number: 12,
  headSha: "abcdef1234567890",
  headBranch: "topic",
  baseBranch: "master",
};

function base(commits: Commit[] = []): GitHub {
  return {
    async *mergeCommitIterator(): AsyncGenerator<Commit> {
      for (const commit of commits) yield commit;
    },
    async getFileJson(path: string) {
      return { from: "base", path };
    },
  } as unknown as GitHub;
}

async function drain(view: GitHub): Promise<Commit[]> {
  const out: Commit[] = [];
  for await (const commit of view.mergeCommitIterator("master", {})) {
    out.push(commit);
  }
  return out;
}

describe("the synthetic commit", () => {
  it("arrives ahead of the target branch's own commits", async () => {
    const older = { sha: "old", message: "fix: earlier", files: ["api/y.ts"] };
    const view = viewWithPullRequest(base([older]), COMMIT);
    const commits = await drain(view.github);
    expect(commits.map((c) => c.sha)).toEqual(["abcdef1234567890", "old"]);
  });

  it("joins the title and body the way squash-merge does", async () => {
    const view = viewWithPullRequest(base(), COMMIT);
    const [synthetic] = await drain(view.github);
    expect(synthetic?.message).toBe("feat: a thing\n\nwhy it matters");
  });

  it("is subject-only when the pull request has no description", async () => {
    const view = viewWithPullRequest(base(), { ...COMMIT, body: "  \n " });
    const [synthetic] = await drain(view.github);
    expect(synthetic?.message).toBe("feat: a thing");
  });

  it("carries the branch's changed files", async () => {
    const view = viewWithPullRequest(base(), COMMIT);
    const [synthetic] = await drain(view.github);
    expect(synthetic?.files).toEqual(["api/x.ts"]);
    expect(synthetic?.pullRequest?.number).toBe(12);
  });
});

describe("the head overrides", () => {
  it("serves the pull request's own config rather than the base branch's", async () => {
    const view = viewWithPullRequest(base(), COMMIT, {
      "release-please-config.json": { from: "head" },
    });
    expect(await view.github.getFileJson("release-please-config.json", "master"))
      .toEqual({ from: "head" });
  });

  it("falls through to the base branch for anything else", async () => {
    const view = viewWithPullRequest(base(), COMMIT, {
      "release-please-config.json": { from: "head" },
    });
    expect(await view.github.getFileJson("other.json", "master")).toEqual({
      from: "base",
      path: "other.json",
    });
  });
});

describe("the canary", () => {
  // The failure this guards against is silent: if an upgrade moves the seam,
  // release-please computes without the pull request and the comment reports
  // that nothing releases -- which is also the most common true answer, so
  // nothing on screen looks wrong.
  it("throws when release-please never read the synthetic commit", () => {
    const view = viewWithPullRequest(base(), COMMIT);
    expect(() => view.assertConsulted()).toThrow(SeamError);
  });

  it("passes once the iterator has been consumed", async () => {
    const view = viewWithPullRequest(base(), COMMIT);
    await drain(view.github);
    expect(() => view.assertConsulted()).not.toThrow();
  });

  it("refuses to build a view when the method is gone", () => {
    const moved = {} as unknown as GitHub;
    expect(() => viewWithPullRequest(moved, COMMIT)).toThrow(SeamError);
  });
});
