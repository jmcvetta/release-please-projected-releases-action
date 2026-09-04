# projected-releases

[![Test](https://github.com/jmcvetta/release-please-projected-releases-action/actions/workflows/test.yml/badge.svg)](https://github.com/jmcvetta/release-please-projected-releases-action/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/jmcvetta/release-please-projected-releases-action)](https://github.com/jmcvetta/release-please-projected-releases-action/releases)
[![License](https://img.shields.io/github/license/jmcvetta/release-please-projected-releases-action)](LICENSE)

A GitHub Action that says, on a pull request, which release-please tags
merging it will cut — or that nothing is released, which is the common case
and is stated as an answer rather than left as silence.

- Works with release-please in **manifest mode and in plain mode**.
- **Reads only.** The default `GITHUB_TOKEN` is enough; nothing is pushed and
  no App identity is needed.
- The answer comes from **release-please itself**, not from a reimplementation
  of its rules.

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- uses: jmcvetta/release-please-projected-releases-action@v0
```

`@v0` because this is pre-1.0: the major tag tracks the latest `0.x`, and a
minor bump may change behaviour, which is what 0.x means. Pin a full version
if that matters to you.

## What it puts on the pull request

One sticky comment, edited in place as the title or the branch changes. Here
on a two-package repository, where a `feat:` title touches only one of them:

---

### Projected releases

| Package | Path | Files | Current | Without this PR | Projected | Tag |
| --- | --- | --- | --- | --- | --- | --- |
| `acme-api` | `api` | 3 | 2.4.1 | 2.4.2 | **2.5.0** | `acme-api@v2.5.0` |
| `acme-ui` | `ui` | — | 1.0.0 | — | — | — |

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

The comment's own heading is one level up from the one shown here.

The table is the whole answer, so it is never collapsed and every package
gets a row — including the ones that did not move, which is what makes the
comparison a comparison.

Two columns appear only when they say something the others do not. **Tag**
is there when a tag carries its package's component, which
`include-component-in-tag` and `tag-separator` decide and nothing else in the
row predicts; without one a tag is `v` and the version, so the column would
repeat **Projected** on every line. **Path** is there when the rows disagree
on it, so a single-package repository does not carry a column of `.`.

A line appears above the table only when no row can answer — `None — \`docs\`
is a hidden type.` A merge that does release gets no line, because the row
already says what, how much, and under which tag.

## Why it exists

Two invisible things decide what a merge releases, and a reviewer cannot see
either one side by side with the other: which release-please packages the
changed files belong to, and the Conventional Commit type in the **title**,
which only becomes a commit subject at squash time. Getting either wrong is
quiet — a `feat!:` on a change that was not breaking cuts a major version, and
the number is noticed after the merge that caused it.

The answer cannot be had by running release-please, which computes from
commits already on the target branch:

- `googleapis/release-please-action` runs on `push` and has no preview input.
- [googleapis/release-please#2316][2316] ("dry run mode that only prints the
  changelog") is open and marked p3.
- `release-please release-pr --dry-run` reads the target branch, so pointed at
  a pull request head it sees the working commits, not the squashed one.
- The generic next-version actions compute one repo-wide version from commits
  on a branch. None reads a release-please manifest, knows about components,
  or produces tag names.

## What it assumes

**Squash-merge.** It is the reason the tool exists: a squashed pull request
contributes exactly one Conventional Commit, and it is the title. A repository
that merges or rebases puts the working commits on the target branch
individually and release-please parses those instead. The action reads the
repository's merge settings and says so in the comment rather than quietly
projecting the wrong thing — including the narrower case where a repository
squashes but is set to `COMMIT_OR_PR_TITLE`, which takes the subject from the
branch's only commit when the branch has one.

**Either release-please mode.** With a `release-please-config.json` and
`.release-please-manifest.json` in the checkout it reads those. Without them —
release-please's plain mode, one package selected by `release-type:` — set the
same `release-type` here and it configures the projection from the inputs
instead, through `Manifest.fromConfig`. There is no manifest naming the
current version in that mode, so it comes from the latest tag, which
release-please resolves.

**Nothing else.** Components, tag separators, `changelog-sections`, aggregated
or separate release pull requests, prerelease versions, `Release-As` — all of
that is release-please's own behaviour, reached through release-please.

## Inputs

Everything about the pull request defaults to the webhook payload, so the
ordinary caller sets nothing. The full list is in [`action.yml`](action.yml);
these are the ones worth knowing about.

| Input | Default | What it is for |
| --- | --- | --- |
| `token` | `github.token` | `contents: read` for release-please, `pull-requests: write` for the comment. |
| `mode` | `render-and-comment` | `render` writes the file and outputs only; `comment` posts a body an earlier job rendered. The two halves of the fork-safe arrangement. |
| `changed-files` | `auto` | `auto` diffs the checkout and falls back to the API when the checkout is too shallow; `git` insists; `api` skips the checkout entirely. |
| `merge-method` | `auto` | `auto` reads the repository's settings. Set it to skip that read. |
| `visible-types` / `hidden-types` | resolved | Force the changelog type list, when the config's `changelog-sections` do not describe it. |
| `config-file` / `manifest-file` | release-please's | Where the config and manifest live, in manifest mode. |
| `release-type` | _unset_ | Set it for plain mode: one package, no config or manifest on disk. `package-path`, `component`, `include-component-in-tag` and `tag-separator` go with it. |
| `comment-header` | `projected-releases` | Identifies the sticky comment. Change it only to keep two invocations from editing each other's. |

## Outputs

`comment-file`, `body`, `releases` (JSON, one `{component, version, notes}`
per tag), `releases-count`, `malformed-title`, and `recognized-types`.

That last one is worth a note. A repository with a PR-title gate needs the
same list of accepted types the changelog uses, and keeping a second copy of
it is how the two drift — too strict red-lights a title that would have
released correctly, too loose lets a commit onto the default branch that the
changelog silently omits. Read the gate's list from this output rather than
writing it down twice.

## Permissions

```yaml
permissions:
  contents: read        # release-please's reads
  pull-requests: write  # the sticky comment only
```

Everything release-please reads here is a read: commits, tags, releases, and
its own config. The default `GITHUB_TOKEN` is enough and no App identity is
needed, because nothing is pushed.

A job that only renders (`mode: render`) needs `pull-requests: read` rather
than `write`: the action lists the open release pull requests so the pending
version can link to the one holding it. Without it that call is forbidden and
every run carries a warning annotation. Set `link-release-prs: false` if you
would rather not grant it.

## Fork pull requests

A `pull_request` event from a fork gets a read-only token, so the comment
cannot be posted from that run at all. The action says so and leaves the
projection in the job summary rather than failing the run.

To comment on fork pull requests anyway, use the `workflow_run` pair in
[`examples/`](examples): one workflow renders the markdown under the fork's
read-only token and uploads it, and a second — running from your default
branch, with its own permissions — posts what the first one rendered.

Deliberately not `pull_request_target`, which would run the head's code with a
write token.

The posting job does not trust that artifact either. A `pull_request` run
executes the workflow file as the pull request writes it, so a fork chooses
what gets uploaded, a pull request number included — and the posting job holds
`pull-requests: write` for every pull request and issue in the repository. It
therefore resolves the number from the API, out of payload fields GitHub fills
in, and never reads it from the artifact. What the comment *says* is still the
fork's to write, and it lands only on the fork's own pull request, which is
somewhere it could have commented anyway.

## Examples

- [`examples/projected-releases.yml`](examples/projected-releases.yml) — the
  ordinary arrangement.
- [`examples/fork-safe-render.yml`](examples/fork-safe-render.yml) and
  [`examples/fork-safe-comment.yml`](examples/fork-safe-comment.yml) — the
  fork-safe pair.

Skip release-please's own release pull requests, as those examples do.
Merging one cuts its tag unconditionally, from the changelog and manifest
already written into the branch and never from the type in the title, so the
model this action applies does not describe it — and applying it anyway
reports "nothing releases" about the one merge that always releases.

## Command line

The action's bundle is also a command line, dispatching on whether it was
given any arguments. So a projection can be had before the pull request
exists, and compared against the merge that follows it:

```
node dist/index.mjs --title "feat: a thing" --repo owner/name --base main --out preview.md
```

It reads the same configuration and writes the same markdown, which makes it
the shortest way for a person — or an agent — to check what a title would
release without opening a pull request for it.

## Compatibility

This action bundles release-please and pins it to an exact version, currently
`release-please@17.11.2`. The projection is therefore computed by that
version rather than by whichever one your release workflow runs. Nothing has
to match, and the action only ever reads; but a projection and a release
computed by different majors can disagree, so the pin is worth knowing about.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) has
the build, the test layout, and how a change gets released.
[SECURITY.md](SECURITY.md) has what counts as a vulnerability here and how to
report one privately.

How the projection is actually computed is written at the code rather than in
a design document — start with the header comment of `src/pr-view.ts`.

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
