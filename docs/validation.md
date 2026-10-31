# Public-release preparation validation

This record distinguishes Codex checks from deployment validation. It describes
the prepared branch stack, not a claim that all changes are merged into main.

## Executed in Codex

- Clean locked dependency installation; compatible security updates and production/all-dependency advisory checks.
- ESLint and TypeScript with `--noEmit --incremental false`.
- Full Vitest suite using disposable PGlite databases and synthetic fixtures.
- Production Next.js build with locally bundled fonts and disposable placeholder configuration.
- Built-server anonymous HTTP checks: sign-in page, unsafe/repeated return parameters, protected-page redirect, and anonymous POST export refusal (401).
- Reference initializer help/argument handling and database tests for tenant scoping, repeatability, preservation of existing definitions, and unknown-organisation refusal.
- Gitleaks 8.24.3 public-history and pending-change scans with redacted reporting. The downloaded scanner archive was verified against the published SHA-256 checksum before execution.

The full suite passed **880 tests across 51 files** after reference initialization
was added. The associated PR/commit report records any subsequent reruns. No application's live database was migrated, seeded, initialized or purged.
Only disposable in-memory test databases received migrations and synthetic writes.

## Not executed

There is no Vercel project or Neon database connected to the new public repository
at preparation time. Consequently, live Neon access, authenticated deployed
workflows, OAuth callbacks, Vercel upload handling, and retention scheduling were
not verified. No public/production deployment or infrastructure configuration was
created or changed. No external model call was performed.

## Interpretation

The code builds and the automated suite passes. Anonymous HTTP checks demonstrate
specific routing/auth-guard behaviour, not signed-in end-to-end functionality.
Secret scans found no matching secrets within their scanned scope; that is not a
proof that no sensitive information exists. Remaining dependency advisories and
workflow limitations are documented separately.

Status: **ready for public evaluation review with documented limitations**.
This is not a production-readiness or compliance-certification claim.
