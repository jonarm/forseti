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

Draft suggestions use templates and workspace data. AI-powered drafting is not currently enabled.

## Quick start

### Prerequisites

Install **Git**, **Node.js 24** (includes npm), and **Docker Desktop** on Windows
or macOS. On Linux, install Docker Engine with the Compose plugin. The steps below
use Docker to run PostgreSQL locally. If you use an existing PostgreSQL instance
or Neon instead, set its connection string and skip `npm run db:up`.

Suggested hardware for local development with Docker, PostgreSQL, and a browser:

| Resource | Suggested minimum | Recommended |
| --- | --- | --- |
| CPU | 64-bit processor with 2 cores | 4 or more cores |
| RAM | 8 GB system memory | 16 GB or more |
| Free disk space | 20 GB | 40 GB or more on an SSD |

These are planning estimates, not benchmarked application requirements. Builds,
tests, and other running applications can need additional resources. Docker must
also meet its platform requirements; Windows Docker Desktop needs a supported
WSL 2 or Hyper-V setup with hardware virtualization enabled. Use Linux containers.

### 1. Install dependencies

```sh
git clone https://github.com/jonarm/forseti.git
cd forseti
npm ci
```

Copy the configuration template using your shell:

**macOS / Linux / Git Bash**

```sh
cp .env.example .env.local
```

**Windows PowerShell**

```powershell
Copy-Item .env.example .env.local
```

### 2. Configure the local environment

Open `.env.local` in a text editor. On Windows, use `notepad .env.local`.
Set these values:

| Variable | Local development value |
| --- | --- |
| `DATABASE_URL` | `postgresql://forseti:forseti_local_dev@localhost:5432/forseti` for the supplied Compose service |
| `BETTER_AUTH_SECRET` | A unique random secret generated below |
| `BETTER_AUTH_URL` | `http://localhost:3000` |

Generate a secret with this command, which works in PowerShell and Unix shells:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Copy the output into `BETTER_AUTH_SECRET` and save the file. Keep the secret and
`.env.local` out of Git and shared logs.

### 3. Start Docker and the app

**Open Docker Desktop and wait until its engine is running before continuing.**
On Linux, ensure the Docker service is running. Keep Docker running while using
the local database. Check it with:

```sh
docker info
```

The output should include a Server section without a connection error.

Start the local database, apply migrations, and run the app. Run each command
separately, and continue only after it succeeds:

```sh
npm run db:up
npm run db:migrate
npm run dev
```

Wait for the database to report **Healthy** and for migrations to finish
successfully before starting the app. For a remote database, confirm the migration
target first. A login page can load even when the database is unavailable;
signing up and signing in require a working database connection.

### 4. Create your account and organisation

Open `http://localhost:3000` and click **Sign up**. Enter your name, email address,
and a new password, then create your organisation when prompted. The standard
quick start does not create a default account or password.

The organisation form generates a **slug** from the organisation name and displays
it as **Identifier**. This is a short identifier used to select the organisation;
it is separate from its display name. For example:

| Organisation name | Slug / Identifier |
| --- | --- |
| Meridian Analytics | `meridian-analytics` |

Note the exact Identifier shown in the form. Use it in the next command, rather
than the company name with spaces.

### 5. Initialize the reference framework

Leave the app running. Open a second terminal in the `forseti` folder and run:

```sh
npm run reference:init -- --organization meridian-analytics
```

Replace `meridian-analytics` with your own organisation's exact slug. The
`--organization` argument tells the initializer which existing organisation to
update. It adds the ISO 42001 framework definitions, clauses, and controls without
overwriting existing definitions. It does not create accounts, organisations, or
demo business records. Rerunning it adds only missing definitions.

See [environment configuration](docs/environment.md) for all variables and
[deployment](docs/deployment.md) for Vercel/Neon or other Node.js hosting.

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
