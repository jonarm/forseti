# Forseti

An experimental, independently deployable AI governance application. Register AI
systems and use cases, assess risks, map ISO/IEC 42001 controls, and track evidence
from one organisation-scoped workspace.

**Status: public evaluation release.** Several governance workflows are previews,
not completed approval processes. Use synthetic data while evaluating the app.
See [current limitations](docs/known-limitations.md) before relying on a screen.
Forseti does not certify compliance or replace the ISO standard.

## Independent deployment

Fork or clone [jonarm/forseti](https://github.com/jonarm/forseti). Each operator
supplies their own Vercel project, database, authentication secret, and optional
integration credentials. No original-owner account or domain is required.

Vercel with Neon PostgreSQL is the reference platform. Node.js hosting with
ordinary PostgreSQL is supported by the existing database driver; other hosting
platforms have not been end-to-end certified.

Follow the [deployment guide](docs/deployment.md). You can perform development
and administrative commands in Codex Cloud or another hosted terminal; installing
software on your own computer is optional.

## What works

- Organisation-scoped authentication, roles, configurable permissions, and audit trails.
- Inventory, use cases, risk records, intake submissions and decisions.
- Framework applicability, system/control claims, and evidence relationships.
- Record creation, supported imports/exports, trash and restoration.
- Readiness, risk and evidence summaries computed from the registers.
- Questionnaire drafts and suggestions assembled deterministically from stored facts.

Assessment sign-off, manual assessment answer editing, evidence verification,
finding lifecycle editing, public trust-centre sharing, and PDF audit-pack
creation are incomplete. Preview actions are labelled; public sharing is disabled.
The active drafting routes do not call an AI model.

## Stack and prerequisites

Next.js 16, React 19, TypeScript, Tailwind CSS, Better Auth, and Drizzle.
Node.js **24** is pinned in `.nvmrc`; install locked dependencies with `npm ci`.
Geist fonts are bundled from npm, so building does not download Google Fonts.

## Development quick start

In a hosted shell or, optionally, on your computer:

```sh
npm ci
cp .env.example .env.local
```

Fill in your own `DATABASE_URL`, a unique `BETTER_AUTH_SECRET`, and
`BETTER_AUTH_URL`. See [environment configuration](docs/environment.md).
Do not commit the filled-in file or paste credentials into issues or chat.

For a disposable local PostgreSQL database, `npm run db:up` starts the supplied
Docker Compose service. Use that service's documented local-only connection
string from `.env.example`. To use Neon, provide your own connection string.

Applying migrations is an explicit database-changing operation. Once you have
selected the correct database and approved its initial schema setup, run:

```sh
npm run db:migrate
npm run dev
```

Create your account and organisation through the app. Then, with the same database
configured in your administrative shell, explicitly install reference definitions:

```sh
npm run reference:init -- --organization your-organization-slug
```

This adds only the ISO 42001 framework, clause tree, and controls to the existing
organisation. It creates no accounts, policies, applicability claims, or business
records. Rerunning inserts missing definitions without overwriting existing ones.
Use cases and governance records still have the limitations listed above.

`npm run seed` is an optional synthetic demo installer, **not** the normal setup
path. It requires `ALLOW_DEMO_SEED=1` and an operator-chosen `DEMO_PASSWORD`, and
can replace existing demo records. Do not run it on a database containing work
you want to preserve. It never prints the password. See the deployment guide.

## Validation

```sh
npm run lint
npx tsc --noEmit --incremental false
npm test -- --maxWorkers=2
npm run build
```

The test suite uses disposable in-memory PostgreSQL (PGlite), not a configured
Neon database. It applies repository migrations and synthetic fixtures only inside
those disposable instances. Stop the dev server before building.

A successful build or Vercel deployment is not an end-to-end test. See the
[testing guide](docs/testing.md) for deployment checks that remain necessary.

## Documentation and contributing

- [Deployment](docs/deployment.md) and [environment variables](docs/environment.md)
- [Architecture](docs/architecture.md) and [known limitations](docs/known-limitations.md)
- [Testing](docs/testing.md) and [validation record](docs/validation.md)
- [Contributing](CONTRIBUTING.md), [security reporting](SECURITY.md), and [third-party notices](THIRD_PARTY_NOTICES.md)

## Licence

Original project code is available under the [MIT licence](LICENSE). Third-party
components and fonts retain their own licences and notices. ISO/IEC 42001 standard
text is not bundled; reference identifiers and project-written guidance are not
a substitute for obtaining the standard.
