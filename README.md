# projected-releases

A GitHub Action that says, on a pull request, which release-please tags
merging it will cut — or that nothing is released, which is the common case
and is stated as an answer rather than left as silence.

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0
- uses: jmcvetta/release-please-projected-releases-action@v0
```

`@v0` because this is pre-1.0: the major tag tracks the latest `0.x`, and a
minor bump may change behaviour, which is what 0.x means. Pin a full version
if that matters to you.

```
## Projected releases

| Component | Tag | Current | Without this PR | Projected |
| --- | --- | --- | --- | --- |
| `acme-api` | `acme-api@v2.5.0` | 2.4.1 | 2.4.2 | **2.5.0** |

minor bump.

<details><summary>Changelog preview</summary> … </details>
<details><summary>Components</summary> … </details>
```

## Why it exists

Two invisible things decide what a merge releases, and a reviewer cannot see
either one side by side with the other: which release-please components the
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

## How it works

`Manifest.buildPullRequests()` reads every commit through one call,
`github.mergeCommitIterator(targetBranch, options)`. This action wraps that
one method on a `GitHub` instance so it yields a synthetic commit — the pull
request title as subject, the description as body, the branch's changed files
— ahead of the real ones, and otherwise delegates. release-please then
computes the post-merge answer itself: the versions, the tags, the rendered
changelog, and its own decision that a commit releases nothing at all.

`GitHub` and `Manifest` are exported from release-please's public index.
`CommitSplit`, `DefaultVersioningStrategy`, `parseConventionalCommits` and
`DefaultChangelogNotes` are not, which is why this wraps a public method
rather than importing internals from `build/src/`.

It runs twice, with the synthetic commit and without, so the comment can
separate what this pull request causes from what the target branch was already
going to release.

### What is not delegated

Four things, all of them presentation:

- the comment itself — the table, the sticky body, the provenance footer;
- withholding a projection when the title is malformed, because such a title
  is not mergeable under a title gate and misleading without one, so any
  projection from it describes a commit that will never exist;
- tag spelling, a four-line mirror of `TagName.toString()`;
- attributing changed files to components (`src/split.ts`), which decides only
  what the comment *explains*. release-please does its own splitting, so
  getting this wrong costs a wrong "components touched" line, never a wrong
  version.

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

**Pull requests from forks get a read-only token**, so the comment cannot be
posted from a `pull_request` event on one. The action warns and leaves the
projection in the job summary rather than failing the run. To comment on fork
pull requests, use the `workflow_run` pair in
[`examples/`](examples) — not `pull_request_target`, which would run head code
with a write token.

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

## The canary

`release-please` is pinned to an exact version, so the seam cannot move under
a running action. The residual risk is the *upgrade*: if a version bump moves
it, an uncalled wrapper means release-please computes without the pull request
and the comment reports that nothing releases — which is also the most common
true answer, so nothing looks wrong.

So the action asserts the method exists before wrapping, records whether the
wrapper was entered, and throws if `buildPullRequests()` returned without it
(`assertConsulted` in `src/pr-view.ts`). A moved seam fails the dependency
bump instead of quietly degrading.

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

The same bundle is the command line, dispatching on whether it was given any
arguments, so a projection can be compared against the merge that follows it:

```
node dist/index.mjs --title "feat: a thing" --repo owner/name --base main --out preview.md
```

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

## History

Built inside [jmcvetta/career][career] as `projected-releases/`, so it could
be exercised against real releases, and extracted here per [career#86][86].

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
[career]: https://github.com/jmcvetta/career
[86]: https://github.com/jmcvetta/career/issues/86
