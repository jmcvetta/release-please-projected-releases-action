# Provider and version pins for the GitHub configuration stack.
#
# State is committed to this repository, which is public; see README.md for
# what makes that safe here and what invariant keeps it safe.
terraform {
  required_version = ">= 1.6"

  required_providers {
    github = {
      source = "integrations/github"
      # 6.13.0 is the floor rather than the ceiling: it is the release that
      # added github_workflow_repository_permissions, which main.tf uses.
      version = "~> 6.13"
    }
  }
}

# Authenticates from GITHUB_TOKEN in the environment. No credentials are
# stored in this repository.
provider "github" {
  owner = "jmcvetta"
}
