# Design

Why the projection is computed the way it is. The README is the user-facing
description; [CONTRIBUTING.md](../CONTRIBUTING.md) is the build and the tests.

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
- attributing changed files to packages (`src/split.ts`), which decides only
  what the comment *explains*. release-please does its own splitting, so
  getting this wrong costs a wrong **Files** count, never a wrong version.

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
