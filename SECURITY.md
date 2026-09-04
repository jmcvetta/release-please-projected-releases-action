# Security policy

## Reporting a vulnerability

Report privately rather than in a public issue: use **Security → Advisories →
Report a vulnerability** on this repository, or email <jason.mcvetta@gmail.com>
if that is unavailable to you.

Please say what an attacker gains and how to reproduce it. There is no bounty
and no formal response window — this is a one-maintainer project — but a
report will be read and answered.

## Scope

This action runs inside other people's CI, so the interesting boundary is what
it does with input it does not control: a pull request title, a branch name, a
description, a changed file path, and the contents of a fork's workflow run.

In scope:

- anything that lets a pull request author reach beyond their own pull
  request — writing a comment elsewhere in the repository, reading a secret,
  influencing a job that holds a write token;
- command or expression injection through a title, branch name, description or
  file path;
- a projection that can be made to state a version other than the one
  release-please would actually cut, where that misdirection is attacker
  controlled rather than a bug in arithmetic.

Out of scope:

- a wrong projection with no attacker in it. That is a bug — open an issue;
- vulnerabilities in release-please itself, which this action bundles. Report
  those to [googleapis/release-please](https://github.com/googleapis/release-please);
- a workflow you wrote yourself that grants the action more than the README
  asks for.

## Note on the fork-safe examples

`examples/fork-safe-render.yml` and `examples/fork-safe-comment.yml` are a
security design, not a convenience: the posting job holds
`pull-requests: write` for the whole repository and is triggered by a workflow
file a fork can rewrite. The comments in those files explain what each step
must not assume. Findings against that arrangement are very much in scope.
