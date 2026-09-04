/**
 * The coverage wiring, asserted rather than assumed.
 *
 * Every line below exists because the failure it describes is silent. A
 * coverage entry point that has drifted from the suite still passes; a
 * provider that was never installed reports no coverage and says nothing
 * about it; a sticky comment sharing a marker with another one just quietly
 * overwrites it. None of that shows up as a red check, which is why it is
 * worth a test rather than a comment.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { DEFAULT_HEADER } from "./comment.js";
import config from "../vitest.config.js";

const url = (path: string) => new URL(path, import.meta.url);
const read = (path: string) => readFileSync(url(path), "utf8");

const pkg = JSON.parse(read("../package.json")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

const workflow = parse(read("../.github/workflows/test.yml")) as {
  jobs: Record<
    string,
    {
      permissions?: Record<string, string>;
      steps: {
        run?: string;
        uses?: string;
        with?: Record<string, string>;
        env?: Record<string, string>;
      }[];
    }
  >;
};

describe("the coverage entry point", () => {
  it("reaches the test suite through `check` rather than restating it", () => {
    // The rule: a variant entry point calls the original. `cover` written
    // as its own copy of `check`'s command line would keep passing while the
    // two drift, and CI runs the coverage side.
    expect(pkg.scripts.cover).toContain("npm run check");
  });

  it("turns coverage on with a variable the ordinary test leg reads", () => {
    expect(pkg.scripts.cover).toContain("VITEST_COVER=--coverage");
    expect(pkg.scripts.test).toContain("VITEST_COVER");
  });

  it("leaves coverage off when nothing asks for it", () => {
    // Unset expands to no argument at all, so `npm test` stays the fast run.
    expect(pkg.scripts.test).toContain("${VITEST_COVER:-}");
  });

  it("still builds before it tests", () => {
    // src/bundle.test.ts runs dist/index.mjs as a process, so a coverage run
    // that tested first would measure the previous build.
    const check = pkg.scripts.check ?? "";
    expect(check.indexOf("build")).toBeGreaterThan(-1);
    expect(check.indexOf("build")).toBeLessThan(check.indexOf("test"));
  });

  it("declares the provider on the same range as vitest", () => {
    // @vitest/coverage-v8 peer-depends on an exact vitest version, so the
    // pair has to move together or `npm ci` fails on a bump of either.
    expect(pkg.devDependencies["@vitest/coverage-v8"]).toBe(
      pkg.devDependencies["vitest"],
    );
  });
});

describe("what coverage measures", () => {
  const coverage = config.test?.coverage as
    | { include?: string[]; exclude?: string[]; reporter?: string[] }
    | undefined;

  it("is the action's sources and nothing else", () => {
    // dist/index.mjs is 2.4 MB of vendored release-please and would drown
    // the number; scripts/bundle.mjs is proved by packaging.test.ts and CI's
    // staleness check instead.
    expect(coverage?.include).toEqual(["src/**/*.ts"]);
  });

  it("does not count the tests or the fixtures as covered code", () => {
    // A fixture stands in for the GitHub API. Measuring it would report the
    // coverage of the harness rather than of the action.
    expect(coverage?.exclude).toContain("src/**/*.test.ts");
    expect(coverage?.exclude).toContain("src/**/*.fixture.ts");
  });

  it("writes the JSON the pull request comment is rendered from", () => {
    // Without json-summary there is no comment at all, and without json the
    // comment can only give a repository-wide percentage rather than the
    // lines this change left uncovered.
    expect(coverage?.reporter).toContain("json-summary");
    expect(coverage?.reporter).toContain("json");
  });
});

describe("the CI coverage comment", () => {
  const job = workflow.jobs["test"];
  const step = job?.steps.find((s) =>
    s.uses?.startsWith("davelosert/vitest-coverage-report-action"),
  );

  it("runs the same test leg CI already ran, with the variable set", () => {
    const test = job?.steps.find((s) => s.run === "npm test");
    expect(test?.env?.["VITEST_COVER"]).toBe("--coverage");
  });

  it("sticks under a name of its own", () => {
    // projected-releases.yml keeps a sticky comment on the same pull request
    // under the same bot identity. Two comments sharing a marker edit each
    // other; see the header of src/comment.ts.
    expect(step?.with?.["name"]).toBeDefined();
    expect(step?.with?.["name"]).not.toBe(DEFAULT_HEADER);
  });

  it("has the write permission that comment needs", () => {
    expect(job?.permissions?.["pull-requests"]).toBe("write");
  });
});
