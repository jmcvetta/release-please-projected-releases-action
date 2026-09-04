# projected-releases

[![Test](https://github.com/jmcvetta/release-please-projected-releases-action/actions/workflows/test.yml/badge.svg)](https://github.com/jmcvetta/release-please-projected-releases-action/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/jmcvetta/release-please-projected-releases-action)](https://github.com/jmcvetta/release-please-projected-releases-action/releases)
[![License](https://img.shields.io/github/license/jmcvetta/release-please-projected-releases-action)](LICENSE)

A GitHub Action that comments on a pull request with the release-please tags
merging it will cut — or says plainly that nothing is released.

- Works with release-please in **manifest mode and plain mode**.
- **Read-only.** The default `GITHUB_TOKEN` is enough; no App identity needed.
- The answer comes from **release-please itself**, not a reimplementation.

## Quick start

```yaml
name: Projected releases
on:
  pull_request:
    types: [opened, reopened, synchronize, edited]
concurrency:
  group: projected-releases-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  preview:
    runs-on: ubuntu-latest
    if: ${{ !startsWith(github.event.pull_request.head.ref, 'release-please--') }}
    permissions:
      contents: read        # release-please's reads
      pull-requests: write  # the sticky comment only
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: jmcvetta/release-please-projected-releases-action@v0
```

Four lines are load-bearing:

- **`edited`** — the projection comes from the title; a title fixed after
  review has to re-render.
- **`concurrency`** — an edit and a push can race the sticky comment.
- **`fetch-depth: 0`** — the diff runs from the merge base. Shallow falls back
  to the API, capped at 3000 files.
- **the `if:`** — a release pull request cuts its tag from the manifest, not
  the title, so the projection would be wrong about it.

`@v0` tracks the latest `0.x`; pin a full version if a minor bump changing
behaviour would bother you.

## The comment

One sticky comment, edited in place as the title or branch changes:

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
`api/test/webhook.test.ts` — a file belongs to the package with the longest
matching path, and a repository-root file to none.

</details>

<sub>Projected for `9f3c1ab` · re-rendered 2026-09-04 11:20 UTC</sub>

---

A package gets a row when the pull request touched it or when either pass
projects a release for it; the rest are counted underneath. **Package**,
**Path** and **Tag** appear only when they add something. When nothing
releases there is no table at all, just ``None — `docs:` produces no
release.``

## Why

Two invisible things decide what a merge releases: which packages the changed
files belong to, and the Conventional Commit type in the **title**, which only
becomes a commit subject at squash time. Neither is visible while reviewing,
and getting either wrong is quiet — a stray `feat!:` cuts a major version,
noticed after the merge.

Squash-merge is therefore assumed. The action reads the repository's merge
settings and says so in the comment when they would not produce the single
commit it projects from.

## Manifest mode and plain mode

A `release-please-config.json` and `.release-please-manifest.json` in the
checkout are read as-is; nothing to configure. Without them, pass the same
`release-type` your release workflow does:

```yaml
      - uses: jmcvetta/release-please-projected-releases-action@v0
        with:
          release-type: node
```

`package-path`, `component`, `include-component-in-tag` and `tag-separator`
go with it and default to single-package conventions.

## Inputs

Everything about the pull request defaults to the webhook payload, so the
ordinary caller sets nothing. Full list with defaults in
[`action.yml`](action.yml).

| Input | Default | What it is for |
| --- | --- | --- |
| `token` | `github.token` | Needs `contents: read`, plus `pull-requests: write` to comment. |
| `mode` | `render-and-comment` | `render` writes the file and outputs only; `comment` posts a body an earlier job rendered. The two halves of the fork-safe arrangement. |
| `changed-files` | `auto` | `auto` diffs the checkout and falls back to the API (3000 files max) when it is too shallow; `git` insists; `api` skips the checkout. |
| `merge-method` | `auto` | `auto` reads the repository's settings. Set it to skip that read. |
| `release-type` | _unset_ | Plain mode; see above. Empty means manifest mode. |
| `visible-types` / `hidden-types` | resolved | Force the changelog type list when `changelog-sections` does not describe it. |
| `link-release-prs` | `true` | Lists open pull requests so a pending version links to the release pull request holding it. Costs `pull-requests: read`; set false to skip the call rather than grant it. |
| `comment-header` | `projected-releases` | Identifies the sticky comment. Change it only to keep two invocations apart. |

## Outputs

`comment-file`, `body`, `releases` (JSON, one `{component, version, notes}`
per tag), `releases-count`, `malformed-title` (`true` when the title is not a
Conventional Commit the changelog recognizes), and `recognized-types`.

Feed `recognized-types` to a PR-title gate rather than keeping a second copy
of the list: too strict red-lights a title that would have released correctly,
too loose lets a commit through that the changelog silently omits.

## Fork pull requests

A `pull_request` event from a fork gets a read-only token, so the comment
cannot be posted from that run. The action says so and leaves the projection
in the job summary rather than failing.

To comment anyway, copy the `workflow_run` pair:
[`fork-safe-render.yml`](examples/fork-safe-render.yml) renders under the
fork's read-only token and uploads the markdown,
[`fork-safe-comment.yml`](examples/fork-safe-comment.yml) runs from your
default branch and posts it. Deliberately not `pull_request_target`, which
would run the head's code with a write token; and the posting job takes the
pull request number from the API, never from the artifact a fork controls.

## Command line

The bundle is also a command line, for a projection before the pull request
exists — same configuration, same markdown:

```
node dist/index.mjs --title "feat: a thing" --repo owner/name --base main --out preview.md
```

## Compatibility

The action bundles `release-please@17.11.2`, so the projection is computed by
that version rather than whichever your release workflow runs. Nothing has to
match, but different majors can disagree.

## Contributing

Issues and pull requests welcome — [CONTRIBUTING.md](CONTRIBUTING.md) has the
build and tests, [SECURITY.md](SECURITY.md) how to report a vulnerability
privately.

## License

Copyright (C) 2026 Jason McVetta. GPL-3.0-or-later — see [LICENSE](LICENSE).
