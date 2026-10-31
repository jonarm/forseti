# Dependency security review

Review date: 2026-10-31. These are npm advisory matches in the lockfile, not a
claim that every advisory is exploitable through the application.

Updated Next.js to 16.4.3, Better Auth to 1.7.14, Zod to 4.6.6, Vitest to 4.1.12,
Drizzle Kit to 0.31.11, and the matching Next.js ESLint configuration. Compatible
transitive updates addressed the reported high-severity XML/parser and URI/tooling
advisories. The shadcn generator/style package is a build-time development dependency.
Geist 1.9.0 bundles the existing fonts locally.

| Audit scope | Affected-package counts after remediation |
| --- | --- |
| Original lockfile, all dependencies | 57: 3 critical, 15 high, 36 moderate, 3 low |
| Updated lockfile, all dependencies | 33: 0 critical, 0 high, 31 moderate, 2 low |
| Updated lockfile, production dependencies | 13: 0 critical, 0 high, 13 moderate, 0 low |

Counts include packages affected through transitive dependencies; they are not
counts of unique exploitable flaws. Rerun audits because advisories change.

Remaining roots include older minimatch in lint/spreadsheet-related chains,
uuid below 11.1.1 in the ExcelJS chain, old esbuild in migration tooling, and
low-severity deepmerge in build tooling. The minimatch and uuid changes suggested
by automation involve incompatible dependency ranges; some top-level automated
recommendations downgrade established packages. They were not applied blindly.

The uuid advisory concerns v3/v5/v6 supplied-buffer handling; do not infer exposure
or safety merely from the package being present. The esbuild advisory concerns
its development server. Assess actual reachable usage and keep tooling private.
The remaining moderate production matches still require operator awareness and
future upstream fixes or a separately reviewed dependency replacement.

No assertions, signature checks, TLS validation, or package checksums were disabled.
The lockfile was retained and tested. No automatic `npm audit fix --force` was used.
