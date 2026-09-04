# Contributing

Issues and pull requests are welcome.

## Development

```
npm ci
npm run check     # typecheck, build, test
npm run cover     # the same, with coverage
```

Run `npm run check` before pushing. The build has to come before the tests:
`src/bundle.test.ts` runs `dist/index.mjs` as a process, so a stale bundle
tests the previous build. `dist/index.mjs` is committed, since a JavaScript
action runs the file the caller checked out; CI fails a pull request whose
bundle is stale.

## Reporting a bug

Say which release-please mode you are in — manifest mode has a
`release-please-config.json` and a `.release-please-manifest.json` in the
checkout, plain mode has neither and sets `release-type:` on the action — and
quote the pull request title verbatim, since that is what the projection is
computed from.

## Design

Written at the code. Start with the header comment of `src/pr-view.ts`.

## Releasing

Squash-only, with the pull request title as the commit subject, so the
Conventional Commit type in the title decides what a merge releases.
release-please keeps a standing release pull request; merging it writes
`CHANGELOG.md`, bumps the version, and cuts the tag.
