# Testing Forseti

Keep this guide with the project so contributors and instance operators can
repeat validation. Test results for a specific version belong in its pull request
or release notes; this document describes the workflow, not a permanent pass count.

## Check GitHub CI

No software installation on your computer is required to inspect automated checks:

1. Open the repository's **Actions** tab.
2. Select the **CI** workflow and the run for the commit or pull request you want to verify.
3. Open the **verify** job and inspect dependency installation, lint, tests, and build results.

The workflow runs on pull requests and pushes to `main`. It uses Node.js 24,
installs locked dependencies, then runs `npm run lint`, `npm test`, and
`npm run build`. It supplies test-only configuration rather than application
credentials. See [the workflow](../.github/workflows/ci.yml).

## Run checks in a development environment

Use Codex Cloud, GitHub Codespaces, another hosted terminal, or an optional local
checkout. Use Node.js 24 from `.nvmrc` and run commands from the repository root:

```sh
npm ci --include=dev
npm run lint
npx tsc --noEmit --incremental false
npm test -- --maxWorkers=2
```

`--maxWorkers=2` limits concurrency on smaller machines; it does not select fewer
tests. For interactive development, `npm run test:watch` reruns affected tests.

## What automated tests exercise

Vitest covers tenant isolation, permissions, API route guards, audit behaviour,
record operations, imports/exports, document processing, reference initialization,
current dates, assessment oversight, and authentication URL/redirect handling.
Consult the actual suites for the assertions covered; a category is not a claim
that every possible case is tested.

Database suites use **PGlite**, PostgreSQL compiled to WASM. They apply the real
`drizzle/` migrations and write synthetic fixtures inside disposable in-memory
databases. They do not require Docker, a Neon project, or a live `DATABASE_URL`.
Never replace the test harness with a shared or application database.

## Verify the production build

Stop the development server before building. `npm run build` resolves the Next.js
route graph and typechecks it; TypeScript alone is not equivalent. Bundled fonts
do not require Google Fonts network access.

For a build check in a hosted Unix shell without application credentials, use
command-scoped placeholders:

```sh
DATABASE_URL=postgresql://ci:ci@127.0.0.1:1/ci \
BETTER_AUTH_SECRET=ci-only-placeholder-not-a-real-secret-000000000000 \
BETTER_AUTH_URL=http://localhost:3000 \
npm run build
```

These are build-only placeholders, not deployment configuration. The database pool
is lazy; a build does not need a working database connection. Both `build` and
`vercel-build` compile only: neither runs migrations, reference initialization,
demo seeding, or retention jobs.

## Validate a deployed instance

A successful build or Vercel deployment does not prove application functionality.
Use synthetic data and a separate test database for checks that create or edit
records. Verify:

- Sign-up, sign-in, sign-out, and organisation selection.
- OAuth callbacks, if a provider is configured.
- Role restrictions and isolation between two organisations.
- Supported record edits remaining correct after a refresh.
- Evidence uploads and previews within the 4 MB total batch limit.
- Reference initialization affecting only the explicitly selected organisation.
- Preview-only controls being clearly labelled and public sharing remaining unavailable.

Check scheduler/Redis configuration separately when enabled. Do not invoke the
destructive trash purge merely as a smoke test. Database migrations and demo
seeding are explicit administrative operations, not prerequisites for offline tests.
See [deployment verification](deployment.md#deployment-verification) and
[current limitations](known-limitations.md).

Anonymous HTTP smoke checks can demonstrate page rendering, redirects, and API
401 responses without testing a signed-in workflow. They do not validate live
Neon compatibility, provider callbacks, or authenticated end-to-end behaviour.

## Report validation accurately

In each pull request or release, record the commit, environment, commands,
actual pass/fail counts, and any skipped or unrun checks. Separate Codex results,
GitHub CI results, and deployed-browser checks. Do not copy old pass counts forward
as evidence for a new version or describe a successful deployment as fully tested.
