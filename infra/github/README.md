# GitHub repository configuration

The settings on this GitHub repository — merge strategy, the `master` ruleset,
whether Actions may open a pull request — expressed as OpenTofu so they are
reviewable in a diff instead of clicked through a settings UI and forgotten.

The point is not the ten minutes it saves. It is that a change to branch
protection arrives as a pull request someone can read, and that a setting the
release job silently depends on is written down next to the reason it is
needed.

## Running it

The provider authenticates from `GITHUB_TOKEN`; no credentials live in this
repository. The token needs `repo` scope and admin on the repository.

```sh
cd infra/github
export GITHUB_TOKEN=$(gh auth token)
tofu init
tofu plan
```

Install the version in `.opentofu-version`, which is also what CI reads. A
version manager (`tenv`, `asdf`, `mise`) picks the file up from this directory
on its own; otherwise match it by hand.

Once the resources below are imported and applied, a clean checkout should plan
as **`No changes.`** Anything else means either someone changed a setting in
the web UI, or a change here has not been applied yet — the plan output tells
you which.

## Checking a change before applying it

`tofu apply` is the first thing that parses these files, and it runs against
live branch protection — a bad moment to discover a typo. `npm run check:infra`,
from the repository root, moves that discovery earlier:

```sh
npm run check:infra
```

It runs `tofu fmt -check`, then `tofu init -backend=false`, then
`tofu validate`. The `-backend=false` is what keeps it credential-free:
providers are installed for validation, and neither state nor the GitHub API is
touched. CI runs it on every pull request, so a syntax error or an attribute
the provider does not have fails in review.

It is not part of `npm run check`, which is the typecheck-build-test chain a
laptop runs constantly and which must not start requiring OpenTofu to be
installed.

This is not a substitute for reading `tofu plan` before an apply. Validation
knows the configuration is well-formed; only the plan knows what it will do.

## First run: import what exists, create what does not

Everything here except the ruleset already existed when the configuration was
written, so those resources are imported rather than created. That matters most
for the repository itself: letting Tofu create it fresh is not something it can
do to a repository that is already there, and the plan would say so in the most
alarming way available.

```sh
tofu import github_repository.projected_releases release-please-projected-releases-action
tofu import github_repository_vulnerability_alerts.projected_releases release-please-projected-releases-action
tofu import github_repository_dependabot_security_updates.projected_releases release-please-projected-releases-action
tofu import github_workflow_repository_permissions.projected_releases release-please-projected-releases-action
```

`github_repository_ruleset.master` is deliberately absent from that list: no
ruleset exists on this repository yet, so it is created by the apply. Creating
one is the safe direction — there is nothing to destroy first, and so no window
in which `master` is less protected than it was.

Then read the plan. Two changes are expected on the first apply and both are
the point of the exercise:

- **the ruleset is created**, which is what finally puts a mechanism behind
  CLAUDE.md's "never push to `master`";
- **`can_approve_pull_request_reviews` flips to true**, which is what lets the
  release job open its release pull request at all.

A third may show up depending on how the repository was left: if
`default_workflow_permissions` currently reads `write`, the apply narrows it to
`read`. Every workflow here declares the scopes its own jobs need, so nothing
loses a permission it was using.

If state is ever lost, rebuild it by importing rather than applying — including
the ruleset, which by then does exist:

```sh
tofu import github_repository_ruleset.master release-please-projected-releases-action:<ruleset_id>
```

Find the id with `gh api repos/jmcvetta/release-please-projected-releases-action/rulesets`.
Then confirm `tofu plan` reports `No changes.` before applying anything.

## Where state lives, and why it is committed

`terraform.tfstate` is committed to this repository. That is deliberate, and it
is the part most likely to look like a mistake to someone skimming — more so
here than in a private repository, because this one is public and its state is
therefore world-readable.

The reflex against committed state comes from state files that hold database
passwords and generated keys. **This stack holds none, by construction.** Every
resource it manages is something already public:

| Resource | What is in state |
|---|---|
| `github_repository` | repo name and feature flags — public metadata |
| `github_repository_ruleset` | the branch-protection rules, readable from the API |
| `github_repository_vulnerability_alerts` | a boolean |
| `github_repository_dependabot_security_updates` | a boolean |
| `github_workflow_repository_permissions` | two Actions settings |

Against that, the alternatives cost more than they return. An S3 backend means
an AWS account this repository has no other reason to touch; a hosted backend
means a paid external dependency in a project that has none. Keeping no state
at all would mean re-importing before every change and accepting silent drift,
which defeats the purpose. Merge conflicts on state are the real cost of
committing it, and with one operator applying occasionally they are rare and
resolvable by re-importing.

### The rule that keeps this safe

**Only add resources whose values are already public.**

This is a constraint on future edits, not a one-time observation. Committed
state is a durable artifact: git history is append-only in practice, so a
credential committed once is not fixed by deleting it in a later commit — it
stays in the history of every clone and of every fork. This repository being
public means there is no blast radius to limit.

So adding anything credential-bearing — `github_actions_secret`, a webhook with
a token, a deploy key — means **moving state off-repo first**, not making an
exception for the one resource.

## What is not managed here, and why

- **`required_status_checks` on the ruleset.** `test` is the check that should
  be required, and requiring it now would deadlock the one pull request that
  has to merge. GitHub suppresses workflow events for anything pushed with the
  default token, and the release job falls back to that token, so `test` never
  reports on the release pull request. A required check that cannot run is not
  protection, it is a permanent block with an admin bypass in front of it.

  The fix and the requirement land together: configure the release bot App
  (below), confirm `test` runs on a release pull request, then add

  ```hcl
  required_status_checks {
    strict_required_status_checks_policy = false
    do_not_enforce_on_create             = false

    required_check {
      context = "test"
    }
  }
  ```

  `preview` stays out of it whatever happens. That job is advisory by design
  and skips itself on release-please's own branches, so as a required check it
  would never report there either.

- **`RELEASE_BOT_APP_ID` and `RELEASE_BOT_PRIVATE_KEY`.** `release-please.yml`
  switches to a GitHub App when the variable is set, and the point of doing so
  is that an App is a distinct identity whose pushes do produce workflow
  events, so the release pull request arrives with checks on it. The private
  key cannot be managed here under the rule above, and the variable is
  deliberately not managed either: setting it while the key is missing or the
  App is not installed makes the release job fail on its first step, which is
  worse than the fallback it replaces. Both go in together, by hand, alongside
  installing the App on this repository.

- **Labels.** Untouched GitHub defaults that nothing in the workflow reads.
  Managing them would encode a default nobody chose.

- **`has_downloads`.** GitHub retired the legacy downloads feature and the
  provider deprecated the field, so setting it is inert.

- **`topics` and `homepage_url`.** Both empty on the repository today.
  Declaring them here would manage them to empty, which is a claim this file
  has no reason to make.
