/**
 * The command line entry point, driven against a fake GitHub over real HTTP.
 *
 * It exists so a projection can be produced from a checkout by hand, which is
 * how one gets compared against the merge that follows it. That makes it the
 * tool a maintainer reaches for when the action's answer looks wrong, so it
 * has to agree with the action -- and the two read the same options from
 * different places, which is exactly the kind of pair that drifts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli } from "./main.js";
import { startFakeGitHub } from "./fake-github-server.fixture.js";
import type { FakeGitHub, FakeRepo } from "./fake-github-server.fixture.js";

const REPO: FakeRepo = {
  owner: "acme",
  repo: "widgets",
  branch: "master",
  files: {
    "package.json": JSON.stringify({ name: "widgets", version: "0.0.0" }),
  },
  commits: [],
  releases: [],
};

let fake: FakeGitHub | undefined;
let stdout: string[] = [];

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  // cli() points release-please's logger at stderr, which is the whole reason
  // it does so: the comment body goes to stdout and the logging must not.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fake?.close();
  fake = undefined;
});

const tmp = () => mkdtempSync(join(tmpdir(), "projected-releases-"));

/** flags are the ordinary invocation. `--files` is supplied rather than
 * diffed, so nothing here depends on the checkout it runs in. */
async function flags(
  extra: string[] = [],
  over: Partial<FakeRepo> = {},
): Promise<string[]> {
  fake = await startFakeGitHub({ ...REPO, ...over });
  return [
    "--title", "feat: a thing",
    "--repo", `${REPO.owner}/${REPO.repo}`,
    "--base", REPO.branch,
    "--release-type", "node",
    "--api-url", fake.url,
    "--graphql-url", `${fake.url}/graphql`,
    "--number", "7",
    "--head-sha", "c".repeat(40),
    "--files", "src/b.ts",
    ...extra,
  ];
}

const printed = () => stdout.join("");

describe("cli", () => {
  it("prints the rendered comment", async () => {
    await cli(await flags());
    expect(printed()).toContain("| **1.0.0** |");
    expect(printed()).toContain("Changelog preview");
  });

  it("writes to a file instead when asked", async () => {
    const out = join(tmp(), "body.md");
    await cli(await flags(["--out", out]));
    expect(readFileSync(out, "utf8")).toContain("| **1.0.0** |");
    // Either the file or standard output, never both: a caller redirecting
    // stdout into the same file would otherwise get it twice.
    expect(printed()).toBe("");
  });

  it("reads the body from a file, so a trailer can be projected", async () => {
    const body = join(tmp(), "body.md");
    writeFileSync(body, "Release-As: 9.9.9\n");
    await cli(await flags(["--body-file", body]));
    expect(printed()).toContain("9.9.9");
  });

  it("requires the two things it cannot guess", async () => {
    await expect(cli(["--repo", "acme/widgets"])).rejects.toThrow(/--title is required/);
    await expect(cli(["--title", "feat: a thing"])).rejects.toThrow(
      /--repo is required, as owner\/name/,
    );
    await expect(
      cli(["--title", "feat: a thing", "--repo", "widgets"]),
    ).rejects.toThrow(/owner\/name/);
  });

  it("takes the changelog types from the flags when they are given", async () => {
    const out = await flags(["--visible-types", "ship,tidy", "--hidden-types", "chore"]);
    await cli(out);
    // `feat` is not among the declared types, so the title cannot become a
    // commit this repository recognizes and the projection is withheld.
    expect(printed()).toContain("malformed PR title");
    expect(printed()).toContain("`ship`");
  });

  it("carries the plain-mode package options through to the tag", async () => {
    await cli(
      await flags([
        "--component", "acme-api",
        "--include-component-in-tag", "true",
        "--tag-separator", "@",
      ]),
    );
    expect(printed()).toContain("acme-api@v1.0.0");
  });

  // The reason `--include-component-in-tag` is a string option rather than a
  // boolean: `parseArgs` reads a boolean as set or unset and drops `=false`,
  // so a boolean here could ask for the component in the tag but never ask
  // for it to be left out -- which is the half that differs from
  // release-please's own default for a component this action was given.
  it("can be told to leave the component out of the tag", async () => {
    await cli(
      await flags([
        "--component", "acme-api",
        "--include-component-in-tag", "false",
      ]),
    );
    // The tag is `v1.0.0`, which the renderer drops as a column because it
    // only repeats the version. The component is nowhere in it, which is the
    // whole assertion.
    expect(printed()).toContain("| **1.0.0** |");
    expect(printed()).not.toContain("acme-api");
  });

  it("refuses a value for it that is neither", async () => {
    await expect(
      cli(await flags(["--include-component-in-tag", "yes"])),
    ).rejects.toThrow(/--include-component-in-tag must be true or false/);
  });

  it("reads a package file the pull request adds, from the head", async () => {
    // Adopting release-please: the pull request adds package.json, so the
    // target branch does not have one and release-please cannot name the
    // component from it. The head's copy is the one that branch will have
    // after the merge, so that is what gets served -- and only for a path the
    // pull request actually changes.
    const root = tmp();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "adopted", version: "0.0.0" }),
    );
    await cli(
      await flags(
        ["--files", "package.json", "--repo-root", root, "--component", "adopted",
         "--include-component-in-tag", "true"],
        // Nothing in the target branch's tree, which is the whole point.
        { files: {} },
      ),
    );
    expect(printed()).toContain("adopted-v1.0.0");
  });

  it("reads the standing release pull requests from a file", async () => {
    // The action queries the API for these; the command line takes the
    // `<branch>\t<url>` lines one `gh pr list` call produces.
    const file = join(tmp(), "prs.tsv");
    writeFileSync(
      file,
      "release-please--branches--master\thttps://github.com/acme/widgets/pull/3\n",
    );
    await cli(await flags(["--release-prs", file]));
    expect(printed()).toContain("| **1.0.0** |");
  });
});
