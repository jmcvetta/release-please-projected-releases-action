/**
 * End-to-end: options in, comment markdown out, against a fixture repository
 * driven by real release-please.
 *
 * The unit tests either side of this one check a piece each. This checks that
 * the pieces are wired to each other -- that the type list resolved from the
 * config is the one the comment explains with, that the projection reaches
 * the table, and that a malformed title stops the whole thing before any of
 * it.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setLogger } from "release-please";
import { fakeScm } from "./fake-scm.fixture.js";
import { buildComment, graphqlRoot } from "./run.js";

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

const CONFIG = {
  "separate-pull-requests": true,
  packages: {
    api: {
      "release-type": "simple",
      component: "acme-api",
      "include-component-in-tag": true,
      "tag-separator": "@",
    },
  },
};
const MANIFEST = { api: "2.4.1" };

/** fixture writes a config and manifest somewhere buildComment can read
 * them, the way a checkout would. */
function fixture(config: unknown = CONFIG): string {
  const root = mkdtempSync(join(tmpdir(), "projected-releases-"));
  writeFileSync(join(root, "release-please-config.json"), JSON.stringify(config));
  writeFileSync(join(root, ".release-please-manifest.json"), JSON.stringify(MANIFEST));
  return root;
}

async function comment(
  title: string,
  over: { config?: unknown; files?: string[]; advisories?: string[]; body?: string } = {},
): Promise<string> {
  const config = over.config ?? CONFIG;
  const outcome = await buildComment({
    owner: "acme",
    repo: "widgets",
    token: "",
    title,
    body: over.body ?? "",
    number: 7,
    base: "master",
    headSha: "abcdef1234567890",
    headBranch: "topic",
    files: over.files ?? ["api/src/x.ts"],
    repoRoot: fixture(config),
    github: fakeScm({ config, manifest: MANIFEST }),
    now: new Date("2026-09-01T12:00:00Z"),
    ...(over.advisories ? { advisories: over.advisories } : {}),
  });
  return outcome.body;
}

describe("buildComment", () => {
  it("renders the tag a feature would cut", async () => {
    const out = await comment("feat: a thing");
    // One package, so no Package or Path column: they would be `acme-api`
    // and `api`, once each, on the one row there is.
    expect(out).toContain("| 1 | 2.4.1 | — | **2.5.0** | `acme-api@v2.5.0` |");
    expect(out).toContain("Changelog preview");
  });

  // The answer is the line; a table of em dashes under it is one the reader
  // has to check before finding out there was nothing in it.
  it("says nothing releases for a type that does not, as an answer", async () => {
    const out = await comment("chore: tidy up");
    expect(out).toContain("None — `chore:` produces no release.");
    expect(out).not.toContain("| Current |");
  });

  it("says which directories a pull request outside every package hit", async () => {
    const out = await comment("feat: a thing", { files: ["docs/x.md", "README.md"] });
    expect(out).toContain("no changed file is under a package path");
    expect(out).toContain("`docs`");
  });

  it("withholds a projection from a title that cannot become that commit", async () => {
    const out = await comment("WIP: still working");
    expect(out).toContain("None — malformed PR title.");
    expect(out).toContain("> WIP: still working");
    expect(out).not.toContain("acme-api@v");
  });

  it("resolves the recognized types from the repository's own config", async () => {
    // `changelog-sections` replaces the preset's types, so `feat` is not one
    // of them here and `ship` is.
    //
    // Measured, and worth knowing: `ship` renders its own changelog section
    // and bumps a *patch*. release-please's default versioning strategy
    // compares the type against the literal strings `feat` and `fix`, so a
    // custom visible type releases without moving the minor. That is the same
    // shape as a miscased `Feat:`, and it is upstream behaviour rather than
    // anything this action decides -- which is the point of asserting it here
    // instead of describing it in a comment somewhere.
    const config = {
      ...CONFIG,
      "changelog-sections": [
        { type: "ship", section: "Shipped" },
        { type: "tidy", section: "Tidying", hidden: true },
      ],
    };
    const shipped = await comment("ship: a thing", { config });
    expect(shipped).toContain("acme-api@v2.4.2");
    expect(shipped).toContain("### Shipped");

    // `feat` is not one of the declared sections, so it renders nothing and
    // releases nothing here. It is still an ordinary commit type, though:
    // the parser reads it and release-please versions from it. Withholding
    // the projection as malformed told the author to rewrite a title that was
    // fine, on every `chore:` and `docs:` pull request such a repository has.
    const quiet = await comment("feat: a thing", { config });
    expect(quiet).toContain("None — `feat:` produces no release.");
    expect(quiet).not.toContain("malformed PR title");

    const rejected = await comment("nonsense: a thing", { config });
    expect(rejected).toContain("None — malformed PR title.");
    expect(rejected).toContain("`ship`");
    expect(rejected).toContain("`tidy`");
  });

  it("warns that a Release-As footer was ignored", async () => {
    // Non-trailer text below the note voids it, and release-please says
    // nothing. Observed here from the version it returned, not from mirroring
    // the trailer rule.
    const out = await comment("fix: a thing", {
      body: "Release-As: 9.9.9\n\n---\n\nSome attribution line.",
    });
    expect(out).toContain("was **ignored**");
  });

  it("honours a Release-As footer that release-please accepted", async () => {
    const out = await comment("fix: a thing", { body: "Release-As: 9.9.9" });
    expect(out).toContain("acme-api@v9.9.9");
    expect(out).toContain("`Release-As: 9.9.9` forces the version.");
  });

  it("carries a caller's advisory into the comment", async () => {
    const out = await comment("feat: a thing", {
      advisories: ["- this repository does not allow squash-merge"],
    });
    expect(out).toContain("does not allow squash-merge");
  });

  it("stamps the head and the render time in the footer", async () => {
    const out = await comment("feat: a thing");
    expect(out).toContain("Projected for `abcdef1`");
    expect(out).toContain("re-rendered 2026-09-01 12:00 UTC");
  });
});

describe("graphqlRoot", () => {
  // release-please hands this to Octokit as `baseUrl` and Octokit appends
  // `/graphql`, so the value has to be the API root. A runner's
  // GITHUB_GRAPHQL_URL and `${{ github.graphql_url }}` are both the endpoint,
  // and passing one through unchanged asks for `/graphql/graphql` -- a bare
  // `HttpError: Not Found` on the first merge-commit query, which is exactly
  // how this was found.
  it("strips the endpoint suffix a runner supplies", () => {
    expect(graphqlRoot("https://api.github.com/graphql")).toBe(
      "https://api.github.com",
    );
  });

  it("leaves a root alone", () => {
    expect(graphqlRoot("https://api.github.com")).toBe("https://api.github.com");
  });

  it("handles an Enterprise Server endpoint and a trailing slash", () => {
    expect(graphqlRoot("https://ghe.example/api/graphql/")).toBe(
      "https://ghe.example/api",
    );
    expect(graphqlRoot("https://ghe.example/api/")).toBe("https://ghe.example/api");
  });
});
