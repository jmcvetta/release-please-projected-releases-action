/**
 * fake-github-server serves just enough of the GitHub API, over real HTTP, to
 * drive one projection end to end.
 *
 * The other fixture, fake-scm, substitutes a `GitHub` object and so skips
 * everything between this action's options and release-please's HTTP calls:
 * URL assembly, the Octokit clients, and the whole bundled artifact. Two bugs
 * lived in exactly that gap and neither was reachable from a unit test -- a
 * GraphQL URL built as `.../graphql/graphql`, and a changelog preset reading
 * template files that the bundle did not ship.
 *
 * So this fake is deliberately literal about URLs. It serves GraphQL at
 * `/graphql` and nothing else, which is what makes a wrongly-assembled
 * endpoint a 404 here exactly as it is against github.com.
 */

import { createServer } from "node:http";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";

/** FakeRepo is the repository state the fake serves. */
export interface FakeRepo {
  owner: string;
  repo: string;
  branch: string;
  /** files are served through the git tree and blob endpoints, which is how
   * release-please reads a package.json. */
  files: Record<string, string>;
  /** commits are the merge commits on the branch, newest first. */
  commits: { sha: string; message: string; files: string[] }[];
  /** releases are the published releases, newest first. */
  releases: { tagName: string; sha: string }[];
}

/** FakeGitHub is a running fake, and the record of what was asked of it. */
export interface FakeGitHub {
  /** url is the API root to hand the action as both api-url and graphql-url. */
  url: string;
  /** requests are every path requested, in order. */
  requests: string[];
  close(): Promise<void>;
}

const BLOB = (path: string) => `blob-${Buffer.from(path).toString("hex")}`;

/** startFakeGitHub serves `repo` until closed. */
export async function startFakeGitHub(repo: FakeRepo): Promise<FakeGitHub> {
  const requests: string[] = [];

  const commitNodes = repo.commits.map((commit) => ({
    associatedPullRequests: {
      nodes: [
        {
          number: 1,
          title: commit.message.split("\n")[0],
          baseRefName: repo.branch,
          headRefName: "topic",
          labels: { nodes: [] },
          body: "",
          mergeCommit: { oid: commit.sha },
          files: {
            nodes: commit.files.map((path) => ({ path })),
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      ],
    },
    sha: commit.sha,
    message: commit.message,
    author: { name: "A", email: "a@b.c", user: { login: "a" } },
  }));

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = req.url ?? "";
      requests.push(`${req.method} ${url.split("?")[0]}`);
      const send = (code: number, payload: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      // GraphQL, at exactly one path. An endpoint assembled as
      // `/graphql/graphql` falls through to the 404 below, which is the whole
      // point of serving this over real HTTP.
      if (url === "/graphql") {
        const query = String(JSON.parse(body || "{}").query ?? "");
        if (query.includes("query releases")) {
          return send(200, {
            data: {
              repository: {
                releases: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: repo.releases.map((release) => ({
                    name: release.tagName,
                    tagName: release.tagName,
                    url: "",
                    description: "",
                    isDraft: false,
                    databaseId: 1,
                    tagCommit: { oid: release.sha },
                  })),
                },
              },
            },
          });
        }
        // Both commit-walking queries share a shape.
        return send(200, {
          data: {
            repository: {
              ref: {
                target: {
                  history: {
                    nodes: commitNodes,
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          },
        });
      }

      const base = `/repos/${repo.owner}/${repo.repo}`;
      if (url.startsWith(`${base}/git/trees/`)) {
        return send(200, {
          sha: "tree",
          truncated: false,
          tree: Object.keys(repo.files).map((path) => ({
            path,
            mode: "100644",
            type: "blob",
            sha: BLOB(path),
            size: repo.files[path]!.length,
          })),
        });
      }
      if (url.startsWith(`${base}/git/blobs/`)) {
        const sha = url.split("/").pop() ?? "";
        const path = Object.keys(repo.files).find((p) => BLOB(p) === sha);
        if (path === undefined) return send(404, { message: "no blob" });
        return send(200, {
          sha,
          encoding: "base64",
          content: Buffer.from(repo.files[path]!, "utf8").toString("base64"),
        });
      }
      if (url.startsWith(`${base}/tags`)) {
        // release-please falls back to tags when the release list does not
        // resolve a version, so a fake that omits them changes the answer.
        return send(
          200,
          repo.releases.map((release) => ({
            name: release.tagName,
            commit: { sha: release.sha },
          })),
        );
      }
      if (url === base) {
        return send(200, {
          default_branch: repo.branch,
          allow_squash_merge: true,
          squash_merge_commit_title: "PR_TITLE",
        });
      }
      return send(404, { message: `fake has no ${url}` });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
