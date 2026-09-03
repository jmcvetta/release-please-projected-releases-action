# Import blocks for the resources that already exist.
#
# Everything here was configured on the repository before this stack described
# it, so the first `tofu apply` has to adopt those resources rather than create
# them. Doing that with `tofu import` on the command line means four commands
# that have to be run in the right order, before the apply, by someone who
# knows they exist -- and the failure when they are not is `POST /user/repos:
# 422 name already exists on this account`, which is Tofu trying to create a
# repository that has been there all along.
#
# Config-driven import moves that knowledge into the configuration: `tofu plan`
# shows the adoptions, `tofu apply` performs them, and there is no order to get
# wrong. Once a resource is in state its block here is a no-op, so these stay
# rather than being deleted after the first run: they are also what makes a
# rebuild from lost state a plain apply.
#
# github_repository_ruleset.master has no block because it does not exist yet.
# It is created by the apply, which is the safe direction -- nothing to destroy
# first, so no window in which master is less protected than it was. Add its
# block, with id "release-please-projected-releases-action:<ruleset_id>", if
# state is ever lost after it has been created.

import {
  to = github_repository.projected_releases
  id = "release-please-projected-releases-action"
}

import {
  to = github_repository_vulnerability_alerts.projected_releases
  id = "release-please-projected-releases-action"
}

import {
  to = github_repository_dependabot_security_updates.projected_releases
  id = "release-please-projected-releases-action"
}

import {
  to = github_workflow_repository_permissions.projected_releases
  id = "release-please-projected-releases-action"
}
