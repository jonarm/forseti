# Repository maintenance

## Main branch protection

GitHub's “Your main branch isn't protected” notice means no active protection
applies to the default branch. It is a repository setting, not an application error.
Without protection, users with sufficient write access can push directly, force
push, or delete the branch.

The repository includes an importable [main ruleset](../.github/rulesets/main.json):

- Require pull requests for changes to `main`.
- Require the `verify` CI job to pass on a branch up to date with `main`.
- Require review conversations to be resolved.
- Block branch deletion and force pushes.
- Apply the rules without bypass actors.

The baseline requires zero review approvals so a solo maintainer can merge their
own pull requests after CI passes. For a team, require at least one approval,
dismiss stale approvals, and require approval of the latest push by another person.

## Apply the ruleset

An administrator can open **Settings → Rules → Rulesets → New ruleset → Import a
ruleset** and import `.github/rulesets/main.json`. Review any existing rulesets and
confirm the required check is named `verify`, as in `.github/workflows/ci.yml`.
Keep enforcement **Active** and target `main`.

Saving this JSON in Git does not activate protection. After importing, confirm
that GitHub lists the ruleset as active for `main` and a pull request requires CI
before merging. If no run has reported `verify` yet, run CI first.

## Pull requests and CI

Keep changes focused and describe their effect and validation. CI installs locked
dependencies, runs lint and tests, and builds the application. Database tests use
PGlite; CI does not migrate an application database. Deployment verification is
separate; see [testing](testing.md).

Keep secrets, local environment files, build outputs, and dependency caches out of
commits. See [contributing](../CONTRIBUTING.md) and [security](../SECURITY.md).
