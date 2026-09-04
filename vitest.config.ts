/**
 * Test-runner configuration, which exists only to turn coverage on.
 *
 * vitest finds and runs this suite without help, but it reports no coverage
 * at all until a provider is named, and it reports that absence silently:
 * the whole suite ran here for as long as it existed and never measured a
 * line.
 *
 * Coverage is off unless asked for -- `--coverage`, which `npm run cover`
 * passes through VITEST_COVER. Measuring on every `npm test` would slow the
 * suite for a number nobody reads at that moment.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // `text` for a human reading the CI log; the two JSON reporters are
      // what the pull request comment is rendered from -- `json-summary` for
      // the totals, `json` for the per-file lines that make the comment say
      // what *this* change left uncovered rather than a repository-wide
      // percentage.
      reporter: ["text", "json-summary", "json"],
      // The action's own sources, and nothing else.
      //
      // dist/index.mjs is excluded by omission, and deliberately: it is a
      // 2.4 MB bundle of vendored release-please, and measuring it would
      // report this repository's few hundred lines against someone else's
      // hundred thousand. scripts/bundle.mjs is outside for the same
      // reason -- its real test is packaging.test.ts and CI's staleness
      // check, which prove the committed bundle *is* the source. A line-coverage number over it would report a gap that no
      // assertion should close.
      include: ["src/**/*.ts"],
      // The tests, and the fixtures the tests are built from. A fixture is
      // test scaffolding rather than shipped code -- fake-github-server and
      // fake-scm exist to stand in for the GitHub API -- so counting their
      // lines would measure the harness instead of the action.
      exclude: ["src/**/*.test.ts", "src/**/*.fixture.ts"],
    },
  },
});
