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

The projection is computed by release-please itself, so it needs the same
configuration release-please has. Which of release-please's two modes your
repository runs in decides whether this action can find that on its own.

**Manifest mode — nothing to set.** Where the repository has a
`release-please-config.json` and a `.release-please-manifest.json`, the action
reads both out of the checkout. The quick start above is the whole
configuration.

**Plain mode — pass `release-type`.** Without those files release-please is
configured by the `release-type:` your release workflow hands it, and there is
nothing on disk for this action to read. Give it the same value:

```yaml
      - uses: jmcvetta/release-please-projected-releases-action@v0
        with:
          release-type: node
```

`release-type` is the switch between the two, exactly as it is on
release-please-action. Set it and the repository's one package is configured
here, by `package-path`, `component`, `include-component-in-tag` and
`tag-separator`; leave it unset and `config-file`, `manifest-file` and
`repo-root` say where the two files live.

Everything about the pull request itself — number, title, base branch, head
commit — comes from the webhook payload, so an ordinary caller sets none of
it. [`action.yml`](action.yml) lists every input; these are the ones a
repository is most likely to want.

| Input | Default | What it is for |
| --- | --- | --- |
| `token` | `github.token` | `contents: read` for release-please's reads, `pull-requests: write` for the comment. |
| `mode` | `render-and-comment` | `render` writes the file and the outputs but posts nothing; `comment` posts a body an earlier job rendered. The two halves of the fork-safe pair in [`examples/`](examples). |
| `changed-files` | `auto` | `auto` diffs the checkout and falls back to the API when the checkout is too shallow to hold the merge base; `git` insists on the checkout; `api` skips it. |
| `merge-method` | `auto` | `auto` reads the repository's merge settings and says so in the comment when they will not produce the commit the projection assumes. `squash`, `merge` or `rebase` assert one without the read. |
| `visible-types`, `hidden-types` | resolved from the config | Force the list of commit types that render a changelog line, and so can open a release, where `changelog-sections` does not describe it. |
| `link-release-prs` | `true` | Lists the open pull requests, so a pending version can link to the release pull request holding it. `false` skips that call, for a token that may not list them. |
| `comment-header` | `projected-releases` | Identifies the sticky comment. Change it only to keep two invocations on the same pull request from editing each other's. |
