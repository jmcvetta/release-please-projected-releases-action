# Contributing

Issues and pull requests are welcome.

## Development

```
npm ci
npm run check     # typecheck, build, test
npm run cover     # the same, with coverage
```

Run `npm run check` before pushing — CI runs the same thing. The build has to
come before the tests, because `src/bundle.test.ts` runs `dist/index.mjs` as a
process; that bundle is committed (a JavaScript action has no install step),
and CI fails a pull request whose copy is stale.

## Reporting a bug

Quote the pull request title verbatim — the projection is computed from it —
and say whether the repository has a `release-please-config.json` or sets
`release-type:` on the action. The two configurations fail differently.

## Where to start reading

`src/pr-view.ts`, whose header comment explains the whole approach.
