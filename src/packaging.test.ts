/**
 * The committed bundle is the artifact callers actually run, and two things
 * about it are checked here because nothing else would notice them.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";

const url = (path: string) => new URL(path, import.meta.url);
const pkg = JSON.parse(readFileSync(url("../package.json"), "utf8")) as {
  version: string;
};
const manifest = parse(readFileSync(url("../action.yml"), "utf8")) as {
  runs: { main: string };
};
const bundle = url(`../${manifest.runs.main}`);

describe("the committed bundle", () => {
  it("is where action.yml says it is", () => {
    expect(existsSync(bundle)).toBe(true);
  });

  it("does not carry the package version", () => {
    // release-please bumps package.json on its release pull request. A
    // banner naming the package version would make the bundle stale on
    // exactly that pull request, and CI's staleness check would fail the one
    // merge that cuts a tag -- so the bundle is built to be identical across
    // a version bump. Measured before this test existed: with the version in
    // the banner, bumping 0.0.0 to 1.0.0 changed dist; without it, the two
    // builds are byte-identical.
    //
    // Scoped to the banner rather than the whole file, since a 2.4 MB bundle
    // of vendored dependencies will contain any short version string
    // somewhere by chance.
    const banner = readFileSync(bundle, "utf8").slice(0, 500);
    expect(banner).not.toContain(pkg.version);
    // The pinned release-please, on the other hand, is worth stamping: the
    // whole tool is a view over one version of it, and that version does not
    // move when this package's does.
    expect(banner).toMatch(/release-please \d+\.\d+\.\d+/);
  });
});
