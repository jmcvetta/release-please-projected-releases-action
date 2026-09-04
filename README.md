# projected-releases

[![Test](https://github.com/jmcvetta/release-please-projected-releases-action/actions/workflows/test.yml/badge.svg)](https://github.com/jmcvetta/release-please-projected-releases-action/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/jmcvetta/release-please-projected-releases-action)](https://github.com/jmcvetta/release-please-projected-releases-action/releases)
[![License](https://img.shields.io/github/license/jmcvetta/release-please-projected-releases-action)](LICENSE)

A GitHub Action that comments on a pull request with the release-please tags
merging it will cut — or says plainly that nothing is released. The numbers
come from a bundled release-please, not a reimplementation of its rules.

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

## Does it fit your repository?

- **release-please**, manifest mode or plain mode (`release-type:`).
- **Squash-merge**, which is what makes the title the commit.

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

Everything about the pull request comes from the webhook payload, so the
ordinary caller sets nothing. Full list in [`action.yml`](action.yml); in
practice:

| Input | Default | |
| --- | --- | --- |
| `release-type` | _unset_ | Plain mode — `node`, `python`, `simple`, … Empty means manifest mode. |
| `mode` | `render-and-comment` | `render` writes the file and outputs only, `comment` posts what an earlier job rendered — the fork-safe pair. |

Outputs: `body`, `comment-file`, `releases` (JSON, one
`{component, version, notes}` per tag), `releases-count`, `malformed-title`,
and `recognized-types`, which a PR-title gate can use instead of its own copy
of the list.

## Fork pull requests

A fork's token is read-only, so the comment cannot be posted from that run —
the action says so and leaves the projection in the job summary. To comment
anyway, copy the `workflow_run` pair,
[`fork-safe-render.yml`](examples/fork-safe-render.yml) +
[`fork-safe-comment.yml`](examples/fork-safe-comment.yml). Deliberately not
`pull_request_target`, which would run the head's code with a write token.

## Command line

The same bundle is a command line, for a projection before the pull request
exists:

```
node dist/index.mjs --title "feat: a thing" --repo owner/name --base main --out preview.md
```

## Contributing

Issues and pull requests welcome — [CONTRIBUTING.md](CONTRIBUTING.md) has the
build and tests, [SECURITY.md](SECURITY.md) how to report a vulnerability
privately.

## License

Copyright (C) 2026 Jason McVetta. GPL-3.0-or-later — see [LICENSE](LICENSE).
