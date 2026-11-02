# Security

This is an experimental evaluation release. Use synthetic data until you have
reviewed its limitations, deployment controls, and remaining dependency risks.

## Reporting a vulnerability

Do not post secrets, personal data, or actionable exploit details in public issues.
Use GitHub private vulnerability reporting when enabled for this repository. If
it is unavailable, open a minimal issue asking the maintainer for a private channel,
without including the vulnerability details. No private reporting channel or
response-time commitment is implied by this file.

Include the affected commit, expected/observed behaviour, impact, and a minimal
reproduction using synthetic data. Never send your database URL, auth secret,
provider tokens, session cookies, or customer records.

## Operator responsibilities

Use separate instances and databases for independent operators and isolated
preview databases for write tests. Configure HTTPS, least-privileged database
access, unique authentication secrets, backups, optional Redis limits, and
provider callbacks under your own accounts. Email verification and recovery
are incomplete; see [known limitations](docs/known-limitations.md).

Review migration SQL before applying it. Builds never migrate or seed. Demo
seeding requires opt-in and an operator-chosen password. The retention job is
refused when unconfigured and permanently deletes overdue trash when enabled.

If a credential is exposed, revoke/rotate it through its provider. Removing it
from the latest source does not remove it from Git history or invalidate it.
History rewriting and credential rotation require the operator's own coordination.

Run `npm audit` and a maintained secret scanner before releases. See the [testing guide](docs/testing.md) and [dependency review](docs/dependency-security.md).
Passing tests, a secret scan, or a successful deployment do not prove the absence
of vulnerabilities. Third-party advisories must be assessed against actual use.
