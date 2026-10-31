# Development and testing

Use Node.js 24 and the committed npm lockfile. A hosted shell is sufficient; a
local installation on the maintainer's computer is not required.

```sh
npm ci
npm run lint
npx tsc --noEmit --incremental false
npm test -- --maxWorkers=2
npm run build
```

`npm test` uses Vitest. Database-backed suites run PostgreSQL compiled to WASM
(PGlite) in process, applying the real `drizzle/` migrations to disposable
in-memory databases. They do not read a live Neon URL or require Docker. They
insert/delete synthetic test records inside those instances and free them afterward.
Do not substitute a shared/application database for the test harness.

Coverage includes tenant isolation, role enforcement and permission-read errors,
route guards, audit behavior, import/export, record lifecycles, document hardening,
reference-only initialization, current dates, assessment oversight defaults,
instance-specific auth origins, and sign-in return-path normalization.

## Build checks

A build resolves the whole Next.js route graph and typechecks it; TypeScript
alone is not equivalent. Stop the dev server before building. Required boot
variables must be present even for a build. CI uses dummy authentication/database
settings and a lazy PostgreSQL pool; it does not migrate or connect to a shared
service. Bundled fonts require no Google Fonts request.

For an isolated build with no application database, use disposable placeholder
values only in that command's environment, as CI does. Do not save those values
as a deployment's real configuration.

## Deployment checks

The unit/integration suite does not replace browser testing against a deployed
instance. Use a separate preview database for write tests. Check sign-in/out,
OAuth callbacks, organisation creation, role permissions, tenant boundaries,
persisted edits after refresh, file uploads, and any configured scheduler/Redis.
Follow the [deployment checklist](deployment.md#deployment-verification).

Anonymous HTTP smoke tests can check page rendering, local redirects, and API
401s without a real database. They do not demonstrate authenticated operations,
Neon access, provider callbacks, or full end-to-end functionality.

Report the exact commands, pass/fail counts, skipped/unrun checks, and environment.
A green deployment is build/startup evidence, not proof every feature is tested.
See the [validation record](validation.md).
