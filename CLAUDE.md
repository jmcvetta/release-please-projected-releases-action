# projected-releases — working memory

A GitHub Action that comments on a pull request with the release-please tags
merging it will cut. The README is the user-facing description; this file is
for the things that are easy to get wrong twice.

---

## Writing a pull request description

**The description becomes the squash commit body and stays in the history
forever. Write it as a commit message for a public project.**

A reader wants a summary of what the change is and why. A few short
paragraphs, in the register an engineer would use writing to strangers.

Not in it:

- a diary of how the work went, or what was tried and abandoned;
- alternatives considered and rejected;
- measurement tables, benchmark output, tool version numbers;
- implementation trivia and internal file paths;
- what was learned along the way.

Those belong in the individual commit messages, in this file, in an issue, or
nowhere. They are not review material and they are certainly not commit-log
material.

Corrected 2026-09-02: this repository's own #1 reached about eighty-five lines
before someone read it — session narrative, rejected approaches, a table of
five failed attempts at a trailer, and a running account of bugs found that
day. All of it true, none of it a description of the change. Length is the
symptom; the cause is writing to record the work rather than to inform a
reader.

The same goes for the repository's public surface generally: it is a FOSS
project, and the audience is people who have never seen this conversation.

## Editing a pull request body: use the MCP tool, never `curl PATCH`

**Writing a PR body with `curl -X PATCH` from a Claude Code session appends an
attribution footer to the end, always.** Writing the same body with the
`mcp__github__update_pull_request` tool does not.

Measured, on this repository's own #1, after five failed attempts:

| how the body was written | stored result |
|---|---|
| `curl PATCH`, body ending in a trailer | `---` + footer appended after it |
| `curl PATCH`, footer written inline mid-body | inline one removed, a fresh one appended at the end |
| `curl PATCH`, footer written with this session's id | **two** footers, a bare one appended at the end |
| `mcp__github__update_pull_request` | stored verbatim, nothing appended |

It is not "append if absent" — it is "make the footer the last thing", which
is exactly the position a git trailer needs.

**Why it matters: this silently breaks `Release-As:`.** The trailer only
counts when it is the last paragraph. With the footer appended below it, it
stops being a trailer, release-please computes the version it would have
computed anyway, and nothing anywhere reports a problem. That is the failure
that cost `jmcvetta/career` a release on 2026-08-31, written up in its
CLAUDE.md, and it recurred here because the mechanism was reached for through
the wrong tool rather than because the rule was unknown.

So: **always read the stored body back and assert the trailer is last.** The
text that was submitted proves nothing.

Three wrong turns taken before finding this, none of them necessary:

- Concluding from `curl` alone that the append was unavoidable and the
  mechanism unusable. One tool was tested, not the mechanism.
- Reaching for `BEGIN_COMMIT_OVERRIDE` to route around the append. It works —
  `preprocessCommitMessage` in release-please's `commit.js` replaces the whole
  commit message with the block's contents and discards what follows — but it
  is a much bigger hammer than the problem needs, and the first attempt at it
  broke itself: the prose *explaining* the block contained the literal
  delimiters, and the parser splits on the **first** occurrence of each, so it
  would have parsed a fragment of a paragraph as the commit message.
- Proposing the `release-as` **input** on release-please-action. It is sticky:
  every later release stays at that version until the line is removed
  (measured — a `feat:` after 0.1.0 still came out 0.1.0). The trailer applies
  to one commit only.

The working examples were sitting in `jmcvetta/career` the whole time: PRs
#110, #111 and #112 each end with a footer *followed by* `Release-As:`. When
something like this is claimed to have worked before, go and read the ones
that worked.

## What decides the first version

Measured against real release-please, not read off the source:

| setting | 1st release | 2nd (a `feat:` after 0.1.0) |
|---|---|---|
| nothing | 1.0.0 | — |
| `package.json` version `0.3.0` | 1.0.0 | — |
| `Release-As: 0.1.0` in the commit body | 0.1.0 | 0.2.0 |
| `release-as: 0.1.0` action input | 0.1.0 | 0.1.0 — stuck |
| `initialVersion` (config only) | 0.1.0 | 0.2.0 |

`package.json` does **not** seed it: with no prior tag the version comes from
the strategy's `initialReleaseVersion()`. `initial-version` is a config-file
key and a CLI flag; release-please-action exposes no input for it, so in plain
mode it is unreachable.

## This repository releases in plain mode

`release-type: node`, no `release-please-config.json` and no
`.release-please-manifest.json`. That is deliberate: it is one package, and it
keeps the dogfood workflow exercising the action's plain-mode path, which is
where two bugs were caught that the fixtures could not see.

## Squash settings this repository relies on

`squash_merge_commit_title: PR_TITLE` and `squash_merge_commit_message:
PR_BODY`, squash-only. So the PR **title** becomes the commit subject
release-please parses, and the PR **body** becomes the commit body carrying
any `Release-As:` trailer. Check both before merging.

## Bundling breaks things no unit test sees

Three times now, and always the same shape: a dependency's ordinary runtime
behaviour becomes a crash once bundled, while the tests stay green because
they run against `src/`.

- `Dynamic require of "os"` on load — fixed by a `createRequire` banner.
- A GraphQL endpoint assembled as `/graphql/graphql` — the runner's
  `GITHUB_GRAPHQL_URL` is the endpoint, release-please wants the API root.
- The changelog preset reading `__dirname/templates/*.hbs`, which an ESM
  bundle has neither of — fixed by defining `__dirname` and copying the
  templates into `dist/`.

`src/bundle.test.ts` exists for this: it runs `dist/index.mjs` as a process
against a fake GitHub over real HTTP. Each of the three was reintroduced to
confirm it fails on them. **Build before testing**, in `npm run check` and in
CI, or that test measures the previous build.
