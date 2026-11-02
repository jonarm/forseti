# Contributing

Keep changes small and preserve tenant isolation, audit integrity, and accurate
feature status. Discuss new features or architecture changes separately from
bug fixes. Use synthetic data for examples and tests.

Read `AGENTS.md`, `CLAUDE.md`, [architecture](docs/architecture.md), and
[known limitations](docs/known-limitations.md). With Next.js changes, consult the
installed `node_modules/next/dist/docs` guidance for that version.

Use Node.js 24 and `npm ci` in Codex Cloud, another hosted shell, or an optional
local environment. Work in a branch and submit a pull request with behaviour
changes, test evidence, and remaining validation requirements. Do not commit
`.env.local`, credentials, generated build output, or dependency caches.

Run:

```sh
npm run lint
npx tsc --noEmit --incremental false
npm test -- --maxWorkers=2
npm run build
```

Tests use disposable PGlite databases and synthetic fixtures. They never require
Neon credentials. Stop the dev server before building. Database schemas, migration
history, and live infrastructure changes need their own review; never run them
implicitly from a build or ordinary test against an operator's database.

Contributions must be yours to redistribute under the project MIT licence.
Preserve third-party notices and font licences. Do not reproduce ISO standard
text or introduce real customer data. Report vulnerabilities through `SECURITY.md`.

See [repository maintenance](docs/repository.md) for branch protection and CI settings.
