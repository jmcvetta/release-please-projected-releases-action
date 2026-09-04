# Contributing

Issues and pull requests are welcome.

When reporting a bug, say which release-please mode you are in: manifest mode
has a `release-please-config.json` and a `.release-please-manifest.json` in
the checkout, plain mode has neither and sets `release-type:` on the action
instead. The two fail differently, so it is the first thing a report needs.
The pull request title matters for the same reason — it is what the
projection is computed from — so quote it verbatim.

## Where the design is written down

At the code, not in a document. Start with the header comment of
`src/pr-view.ts`: it wraps one release-please method so that the pull request
appears as a commit that has not happened yet, and everything else follows
from that. `SeamError` in the same file explains what happens when a
dependency bump moves the seam, and why that has to fail loudly.

The one thing worth knowing before you read anything: four things are *not*
delegated to release-please, and all four are presentation — the comment
itself (`src/comment.ts`, `src/render.ts`), withholding a projection when the
title is malformed, tag spelling, and attributing changed files to packages
(`src/split.ts`). Everything else is release-please's own answer: the
versions, the tags, the rendered changelog, and the decision that a commit
releases nothing at all. So a wrong version in the table is almost always a
wrong input rather than wrong arithmetic here, and a wrong **Files** count is
the reverse.

The rest of this file is the mechanics: how to build it, how the tests are
arranged, and how a change reaches a tag.

## Development

```
npm ci
npm run check     # typecheck, build, test
npm run cover     # the same, with line coverage on the test leg
```

`cover` runs `check` rather than restating it, and switches coverage on
through a variable the test script reads. That is the whole reason it is one
line: an entry point written as "the coverage variant of `check`" would be a
copy, and a copy has no way to notice when `check` grows a leg. CI runs the
same test script with the same variable set, and posts what the change left
uncovered as a comment on the pull request.

`dist/index.mjs` is committed, because a JavaScript action runs the file the
caller checked out with no install step. CI rebuilds it and fails a pull
request whose bundle is stale — and the build runs **before** the tests,
because one of them runs the bundle.

That one is `src/bundle.test.ts`, and it is the only test that covers what
bundling breaks. It runs `dist/index.mjs` as a process against a fake GitHub
served over real HTTP, and asserts the markdown that comes out. Everything
else substitutes a `GitHub` object, which skips URL assembly, the Octokit
clients, the changelog preset's own file reads, and the bundle entirely. Three
bugs have lived in that gap — a `require` esbuild could not resolve, a GraphQL
endpoint assembled as `/graphql/graphql`, and a changelog preset whose
template files were not shipped — and the suite was green through all three.
Each was reintroduced to confirm this test fails on it.

### About the tests

The tests in `src/project.test.ts` construct a real `Manifest` against a
fixture `GitHub` and assert what release-please actually returns. That is
deliberate. The implementation this replaced mirrored five release-please
rules in another language, and two were mirrored **backwards** — hidden types
were believed to release, and a miscased type was believed to fail outright.
Reading the source produced both errors; running it produced both corrections.
So the tests measure behaviour rather than restate source.

## Releasing

This repository runs the action on its own pull requests
(`.github/workflows/projected-releases.yml`), through `uses: ./` so the
projection a pull request shows comes from that pull request's own code. It is
released in plain mode, so that workflow is also the standing test that plain
mode works.

release-please, in its plain single-package mode: `.github/workflows/release-please.yml`
passes `release-type: node` and there is no `release-please-config.json` or
`.release-please-manifest.json` here. One package, one version, in
`package.json`. It keeps a standing release pull request; merging it writes
`CHANGELOG.md`, bumps the version, and cuts the tag.

Merges are squash-only, with the pull request title as the commit subject, so
the type in the title is what decides whether a merge releases anything and by
how much. `.github/workflows/pr-title-check.yml` checks it against the same
list `conventional-types.json` holds — the `conventional-changelog-conventionalcommits`
defaults, not the Angular list the enforcing action defaults to, which omits
`feature`. Nothing keeps the two lists equal, so keep them equal by hand: a
gate missing a type red-lights a title that would have released correctly, and
a gate carrying an extra one lets a commit onto `master` that the changelog
then omits without a word.

The workflow then moves `v<major>` and `v<major>.<minor>` onto that tag,
because an action is pinned by its major and release-please writes only the
exact version. Pre-1.0 that means `v0` and `v0.<minor>`, which is what the
examples above pin.

The bundle is deliberately identical across a version bump — the banner names
the release-please it wraps and nothing about this package — so the release
pull request does not trip CI's staleness check on the one merge that cuts a
tag. `src/packaging.test.ts` keeps it that way.

The release pull request is opened with the default `GITHUB_TOKEN` unless the
repository sets `RELEASE_BOT_APP_ID` and `RELEASE_BOT_PRIVATE_KEY`. GitHub
suppresses workflow events for anything the default token pushes, so without
the App that one pull request arrives with no checks on it.
