# GitHub configuration for the release-please-projected-releases-action
# repository.
#
# See README.md for how to run it, and for the rule governing what may be added
# to this stack.

# The repository itself.
#
# Squash-only merging with a PR_TITLE subject and a PR_BODY body is
# load-bearing rather than taste. release-please parses commit subjects on
# master, so the pull request title has to become the master commit subject,
# and a `Release-As:` trailer reaches release-please only through the pull
# request body. Re-enabling merge or rebase commits would put unparseable
# subjects on master and break version selection silently -- silently, because
# a release pull request would still open, just with the wrong number on it.
resource "github_repository" "projected_releases" {
  name        = "release-please-projected-releases-action"
  description = "GHA Action that comments on a PR with the releases projected to be generated for the PR by release-please manifest mode."
  visibility  = "public"

  # Merge strategy. Do not relax without reading the note above.
  allow_squash_merge          = true
  allow_merge_commit          = false
  allow_rebase_merge          = false
  allow_auto_merge            = true
  squash_merge_commit_title   = "PR_TITLE"
  squash_merge_commit_message = "PR_BODY"
  delete_branch_on_merge      = true
  allow_update_branch         = false

  # Merge-commit message shape. Inert while allow_merge_commit is false, but
  # recorded so the value is not silently reset to a provider default.
  merge_commit_title   = "MERGE_MESSAGE"
  merge_commit_message = "PR_TITLE"

  # Features. Issues carry the work tracking; wiki and projects are on as
  # GitHub defaults rather than by choice.
  #
  # has_downloads is omitted deliberately: GitHub retired the legacy downloads
  # feature and the provider deprecated the field, so setting it is inert.
  has_issues      = true
  has_projects    = true
  has_wiki        = true
  has_discussions = false
  is_template     = false
  allow_forking   = true
  archived        = false

  web_commit_signoff_required = false
}

# Dependabot vulnerability alerts: does GitHub tell us about a known-vulnerable
# dependency at all. Its own resource because the inline
# github_repository.vulnerability_alerts field is deprecated in favour of this.
resource "github_repository_vulnerability_alerts" "projected_releases" {
  repository = github_repository.projected_releases.name
  enabled    = true
}

# Dependabot security updates: does GitHub additionally open pull requests to
# fix those alerts. A separate feature from the alerts above, not a synonym for
# it, so both are pinned.
#
# The version updates in .github/dependabot.yml are a third, unrelated thing
# and stay in that file: they are a schedule and a grouping policy, which is
# repository content rather than a repository setting.
resource "github_repository_dependabot_security_updates" "projected_releases" {
  repository = github_repository.projected_releases.name
  enabled    = true
}

# Settings -> Actions -> General -> Workflow permissions, which is the setting
# the release job actually depends on.
#
# `can_approve_pull_request_reviews` is GitHub's "Allow GitHub Actions to
# create and approve pull requests", and the create half is the one that
# matters here: with it off, release-please does all its work, pushes its
# release branch, and then fails the run on the call that opens the pull
# request -- so the failure reads as a partial success and no release ever
# gets cut. This repository releases itself, so that switch is part of its
# configuration rather than a preference.
#
# `default_workflow_permissions` stays at read. Every workflow here declares
# the scopes its jobs need, so a permissive default would only widen the token
# for a workflow that forgot to.
resource "github_workflow_repository_permissions" "projected_releases" {
  repository                       = github_repository.projected_releases.name
  default_workflow_permissions     = "read"
  can_approve_pull_request_reviews = true
}

# Branch protection for master, expressed as a repository ruleset rather than
# classic branch protection. The distinction matters: classic protection cannot
# express allowed_merge_methods, which is the squash-only invariant above.
#
# There was no ruleset on the repository before this stack, so CLAUDE.md's
# "never push to master" was a rule with no mechanism behind it.
resource "github_repository_ruleset" "master" {
  name        = "master"
  repository  = github_repository.projected_releases.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  # Repository admin may bypass from the pull request merge box. Scoped to
  # pull_request, so direct pushes to master stay blocked even for admin: the
  # escape hatch covers a judgement call at merge time, not a way around the
  # pull request flow. actor_id 4 is the built-in admin repository role.
  bypass_actors {
    actor_id    = 4
    actor_type  = "RepositoryRole"
    bypass_mode = "pull_request"
  }

  rules {
    deletion         = true
    non_fast_forward = true

    # Solo repository, so no approvals are required; the rule exists to force
    # changes through a pull request at all, and to pin the merge method.
    #
    # required_status_checks is deliberately absent, and README.md says when to
    # add it: while the release job authenticates with the default token,
    # GitHub suppresses the workflow events for everything it pushes, so `test`
    # never reports on the release pull request. Requiring it today would leave
    # the one pull request that must merge waiting forever on a check that
    # cannot run.
    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
      allowed_merge_methods             = ["squash"]
    }
  }
}
