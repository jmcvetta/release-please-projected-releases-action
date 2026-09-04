/**
 * Test-runner configuration: coverage, and one default stated on purpose.
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
    // vitest's default, restated so that it is a decision rather than an
    // accident -- and so that vitest stops offering to change it.
    //
    // v5 prints a performance hint after every run, in CI too, estimating
    // that `isolate: false` would be a few hundred milliseconds faster by
    // reusing a worker across test files instead of spawning one per file.
    // Measured with `vitest doctor`, that is real: about -31% of a two-second
    // suite, and the suite passes with it off, twice, under a shuffled file
    // order.
    //
    // It is still declined. The saving is under a second on a CI job that is
    // about eighteen, and what it buys that back with is shared module state
    // between files: whichever file runs first leaves its modules behind for
    // the next one. This suite has such state -- `setLogger` from
    // release-please is global, and two test files set it -- and the
    // documented failure mode is not a clean break but an order-dependent
    // test that passes on a laptop and flakes in CI.
    //
    // Writing it explicitly also silences the hint: vitest never suggests
    // changing an option the configuration sets on purpose.
    isolate: true,

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
