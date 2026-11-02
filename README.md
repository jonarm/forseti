<div align="center">

# Forseti

AI governance for systems, use cases, risks, controls, and evidence.

[![CI](https://github.com/jonarm/forseti/actions/workflows/ci.yml/badge.svg)](https://github.com/jonarm/forseti/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Quick start](#quick-start) · [Documentation](docs/README.md) · [Deployment](docs/deployment.md) · [Contributing](CONTRIBUTING.md)

</div>

![Forseti overview with synthetic demo data](docs/screenshots/seeded-demo/01-overview.jpg)

Forseti gives each organisation a workspace to register AI systems, document use
cases, assess risks, map ISO/IEC 42001 controls, and track supporting evidence.
Deploy it with your own database and authentication settings.

**Status:** experimental. Some assessment, verification, and approval controls are
previews. See [current limitations](docs/known-limitations.md) before evaluating
with synthetic data. Forseti does not certify compliance or replace the ISO standard.

## Features

- Organisation-scoped workspaces, roles, permissions, and audit trails.
- AI inventory, use cases, intake submissions, and decision records.
- Risk registers, framework applicability, and system/control claims.
- Evidence uploads, links, citations, and text previews.
- Record imports and exports, trash, and restoration.
- Readiness summaries and questionnaire drafts derived from workspace records.

Draft helpers use deterministic text generation; active routes do not call an AI model.

## Quick start

Requires **Node.js 24**, npm, and PostgreSQL. Docker Compose can run the local database.

```sh
git clone https://github.com/jonarm/forseti.git
cd forseti
npm ci
cp .env.example .env.local
```

Set these values in `.env.local`:

| Variable | Local development value |
| --- | --- |
| `DATABASE_URL` | `postgresql://forseti:forseti_local_dev@localhost:5432/forseti` for the supplied Compose service |
| `BETTER_AUTH_SECRET` | A unique secret generated with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://localhost:3000` |

Start the local database, apply migrations, and run the app:

```sh
npm run db:up
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`, create an account and organisation, then install the
reference framework using its organisation slug:

```sh
npm run reference:init -- --organization your-organization-slug
```

The initializer adds missing framework definitions without overwriting existing
ones. For a remote database, confirm the migration target first. Keep credentials
out of Git. See [environment configuration](docs/environment.md) for all variables
and [deployment](docs/deployment.md) for Vercel/Neon or other Node.js hosting.

Demo data is optional. The [demo setup](docs/deployment.md#optional-synthetic-demonstration)
requires a disposable database and an operator-chosen password.

## Development

Built with Next.js 16, React 19, TypeScript, Tailwind CSS, Better Auth, Drizzle,
and PostgreSQL. Fonts are bundled locally.

```sh
npm run lint
npx tsc --noEmit --incremental false
npm test -- --maxWorkers=2
npm run build
```

Tests use disposable PGlite databases and need no external database credentials.
Stop the dev server before building. See [testing](docs/testing.md) for deployment checks.

## Documentation

- [Documentation index](docs/README.md)
- [Deployment](docs/deployment.md) and [environment variables](docs/environment.md)
- [Architecture](docs/architecture.md) and [workflow guide](docs/lifecycle.md)
- [Current limitations](docs/known-limitations.md)
- [Testing](docs/testing.md) and [dependency security](docs/dependency-security.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and pull request checks.
[Open an issue](https://github.com/jonarm/forseti/issues) for bugs or feature requests.
Report vulnerabilities through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Third-party components retain their own licences; see
[third-party notices](THIRD_PARTY_NOTICES.md). ISO/IEC 42001 standard text is not bundled.
