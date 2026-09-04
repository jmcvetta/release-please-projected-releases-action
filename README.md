# projected-releases

[![Test](https://github.com/jmcvetta/release-please-projected-releases-action/actions/workflows/test.yml/badge.svg)](https://github.com/jmcvetta/release-please-projected-releases-action/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/jmcvetta/release-please-projected-releases-action)](https://github.com/jmcvetta/release-please-projected-releases-action/releases)
[![License](https://img.shields.io/github/license/jmcvetta/release-please-projected-releases-action)](LICENSE)

A GitHub Action that comments on a pull request with the release-please tags
merging it will cut — or says plainly that nothing is released.

- Works with release-please in **manifest mode and plain mode**.
- **Read-only.** The default `GITHUB_TOKEN` is enough; no App identity needed.
- The answer comes from **release-please itself**, not a reimplementation.

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- uses: jmcvetta/release-please-projected-releases-action@v0
```

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

`acme-api` matched:
- `api/src/webhook.ts`
- `api/src/verify.ts`
- `api/test/webhook.test.ts`

A file belongs to the package with the longest matching path; a
repository-root file belongs to none.

</details>

<sub>Projected for `9f3c1ab` · re-rendered 2026-09-04 11:20 UTC</sub>

---

A package gets a row when the pull request changed a file under it, or when
either pass projects a release for it. The rest are counted below the table.
The **Package**, **Path** and **Tag** columns appear only when they say
something the other columns do not.

When nothing releases, a line replaces the table entirely — ``None — `docs:`
produces no release.`` — and there is no table under it.

## Why

Two invisible things decide what a merge releases: which release-please
packages the changed files belong to, and the Conventional Commit type in the
**title**, which only becomes a commit subject at squash time. Getting either
wrong is quiet — a stray `feat!:` cuts a major version, noticed after the
merge.

Nothing existing answers it: release-please computes from commits already on
the target branch ([googleapis/release-please#2316][2316] is open and p3), and
generic next-version actions know nothing about manifests, components, or tags.

## Assumptions

**Squash-merge**, which is the whole premise: a squashed pull request
contributes exactly one Conventional Commit, and it is the title. The action
reads the repository's merge settings and says so in the comment rather than
projecting the wrong thing.

**Either release-please mode.** With a `release-please-config.json` and
`.release-please-manifest.json` in the checkout it reads those; without them,
set `release-type` and it configures the projection from the inputs, taking
the current version from the latest tag.

Everything else — components, tag separators, `changelog-sections`, prerelease
versions, `Release-As` — is release-please's own behaviour, reached through
release-please.

## Inputs

Everything about the pull request defaults to the webhook payload, so the
ordinary caller sets nothing. Full list in [`action.yml`](action.yml).

| Input | Default | What it is for |
| --- | --- | --- |
| `token` | `github.token` | `contents: read`, plus `pull-requests: write` for the comment. |
| `mode` | `render-and-comment` | `render` writes the file and outputs only; `comment` posts a body an earlier job rendered. The two halves of the fork-safe arrangement. |
| `changed-files` | `auto` | `auto` diffs the checkout and falls back to the API when it is too shallow; `git` insists; `api` skips the checkout. |
| `merge-method` | `auto` | `auto` reads the repository's settings. Set it to skip that read. |
| `visible-types` / `hidden-types` | resolved | Force the changelog type list when `changelog-sections` does not describe it. |
| `config-file` / `manifest-file` | release-please's | Where the config and manifest live, in manifest mode. |
| `release-type` | _unset_ | Set it for plain mode. `package-path`, `component`, `include-component-in-tag` and `tag-separator` go with it. |
| `comment-header` | `projected-releases` | Identifies the sticky comment. Change it only to keep two invocations apart. |

## Outputs

`comment-file`, `body`, `releases` (JSON, one `{component, version, notes}`
per tag), `releases-count`, `malformed-title`, and `recognized-types`.

Feed `recognized-types` to a PR-title gate rather than writing the list down
twice: too strict red-lights a title that would have released correctly, too
loose lets a commit through that the changelog silently omits.

## Permissions

```yaml
permissions:
  contents: read        # release-please's reads
  pull-requests: write  # the sticky comment only
```

A job that only renders (`mode: render`) needs `pull-requests: read` instead,
so the pending version can link to the release pull request holding it.
Without it, every run carries a warning annotation; `link-release-prs: false`
drops the requirement.

## Fork pull requests

A `pull_request` event from a fork gets a read-only token, so the comment
cannot be posted from that run. The action says so and leaves the projection
in the job summary rather than failing.

To comment anyway, use the `workflow_run` pair in [`examples/`](examples): one
workflow renders the markdown under the fork's read-only token and uploads it,
and a second — running from your default branch — posts it. Deliberately not
`pull_request_target`, which would run the head's code with a write token. The
posting job resolves the pull request number from the API rather than the
artifact, since a fork controls what it uploads.

## Examples

- [`examples/projected-releases.yml`](examples/projected-releases.yml) — the
  ordinary arrangement.
- [`examples/fork-safe-render.yml`](examples/fork-safe-render.yml) +
  [`examples/fork-safe-comment.yml`](examples/fork-safe-comment.yml) — the
  fork-safe pair.

Skip release-please's own release pull requests, as those examples do: merging
one cuts its tag from the manifest already in the branch, never from the
title, so this action would report "nothing releases" about the one merge that
always releases.

## Command line

The bundle is also a command line, so a projection can be had before the pull
request exists:

```
node dist/index.mjs --title "feat: a thing" --repo owner/name --base main --out preview.md
```

Same configuration, same markdown.

## Compatibility

The action bundles release-please pinned to an exact version, currently
`release-please@17.11.2`, so the projection is computed by that version rather
than whichever your release workflow runs. Nothing has to match, but
projections across different majors can disagree.

## Contributing

Issues and pull requests welcome. [CONTRIBUTING.md](CONTRIBUTING.md) has the
build, test layout, and release process; [SECURITY.md](SECURITY.md) has how to
report a vulnerability privately. How the projection is computed is documented
at the code — start with the header comment of `src/pr-view.ts`.

## License

Copyright (C) 2026 Jason McVetta.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
A PARTICULAR PURPOSE. See the [GNU General Public License](LICENSE) for more
details.

[2316]: https://github.com/googleapis/release-please/issues/2316
