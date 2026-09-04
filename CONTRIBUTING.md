# Contributing

Issues and pull requests are welcome.

```
npm ci
npm run check     # typecheck, build, test
npm run cover     # the same, with coverage
```

`dist/index.mjs` is committed — `npm run check` rebuilds it, so commit it with
your change or CI will fail on a stale bundle.
