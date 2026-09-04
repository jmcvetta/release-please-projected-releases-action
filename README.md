# projected-releases

[![Test](https://github.com/jmcvetta/release-please-projected-releases-action/actions/workflows/test.yml/badge.svg)](https://github.com/jmcvetta/release-please-projected-releases-action/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/jmcvetta/release-please-projected-releases-action)](https://github.com/jmcvetta/release-please-projected-releases-action/releases)
[![License](https://img.shields.io/github/license/jmcvetta/release-please-projected-releases-action)](LICENSE)

A GitHub Action for repositories that squash-merge: it comments on a pull
request with the release-please tags merging it will cut — or says plainly
that nothing is released. The numbers come from a bundled release-please, not
a reimplementation of its rules.

---

### Projected releases

| Package | Path | Files | Current | Without this PR | Projected | Tag |
| --- | --- | --- | --- | --- | --- | --- |
| `acme-api` | `api` | 3 | 2.4.1 | 2.4.2 | **2.5.0** | `acme-api@v2.5.0` |

_1 other package unchanged: `acme-ui`._

<details><summary>Changelog preview</summary>

#### `acme-api`

### Features

* verify the webhook signature header ([#41](https://github.com/acme/acme/pull/41)) ([9f3c1ab](https://github.com/acme/acme/commit/9f3c1ab))

</details>

<details><summary>Matched files</summary>

`acme-api` matched `api/src/webhook.ts`, `api/src/verify.ts`,
`api/test/webhook.test.ts`.

</details>

<sub>Projected for `9f3c1ab` · re-rendered 2026-09-04 11:20 UTC</sub>

---

One sticky comment, re-rendered as the title or the branch changes. When
nothing releases there is no table, just ``None — `docs:` produces no
release.``

It also says when the numbers cannot be trusted. If a component's entry in
`.release-please-manifest.json` names a version that no release or tag
matches, release-please has no boundary to compute from: it replays the
component's whole history into one changelog and reaches a version by
arithmetic over all of it. That is what a lost tag looks like — and what a
first release looks like — so the comment reports the disagreement and marks
the affected version as unreliable rather than presenting it as the answer.

## Does it fit your repository?

- **release-please**, manifest mode or plain mode (`release-type:`).
- **Squash-merge**, which is what makes the title the commit. Merge commits
  and rebase are planned —
  [#50](https://github.com/jmcvetta/release-please-projected-releases-action/issues/50).

## Quick start

Copy to `.github/workflows/projected-releases.yml`:

```yaml
name: Projected releases
on:
  pull_request:
    types: [opened, reopened, synchronize, edited]
permissions:
  contents: read
  pull-requests: write
jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: jmcvetta/release-please-projected-releases-action@v0
```

Keep `edited` in the trigger list: the projection comes from the title, so a
title fixed after review has to re-render. `@v0` tracks the latest `0.x`, and
[`examples/projected-releases.yml`](examples/projected-releases.yml) adds a
`concurrency` group and skips release-please's own release pull requests.

## Configuration

None, where release-please reads `release-please-config.json` and
`.release-please-manifest.json` from the repository.

Without those files, release-please is configured by the `release-type:` your
release workflow passes it. Pass this action the same value:

```yaml
      - uses: jmcvetta/release-please-projected-releases-action@v0
        with:
          release-type: node
```
