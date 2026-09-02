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
import { buildComment } from "./run.js";

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
    expect(out).toContain("| `acme-api` | `acme-api@v2.5.0` | 2.4.1 |");
    expect(out).toContain("minor bump.");
    expect(out).toContain("Changelog preview");
  });

  it("says nothing releases for a hidden type, as an answer", async () => {
    const out = await comment("chore: tidy up");
    expect(out).toContain("`chore` is a hidden type");
    expect(out).toContain("Components touched: `acme-api`.");
  });

  it("says which directories a pull request outside every component hit", async () => {
    const out = await comment("feat: a thing", { files: ["docs/x.md", "README.md"] });
    expect(out).toContain("no changed file is under a component path");
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

    const rejected = await comment("feat: a thing", { config });
    expect(rejected).toContain("None — malformed PR title.");
    expect(rejected).toContain("`ship`, `tidy`");
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
