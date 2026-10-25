# Forseti — AI governance platform

A company registers the AI systems it actually uses, records what each one is
used *for*, and works them through an AI management system: intake and triage,
a Statement of Applicability against ISO 42001, impact assessments with a real
sign-off chain, risk and finding registers, and an evidence register that knows
what breaks when a document expires. Everything downstream reads those same
records — a questionnaire copilot, an internal and external trust centre, and
the evidence pack handed over at a certification audit.

The problem it addresses: AI arrived inside companies through expense reports
and single sign-on, not through procurement. Most organisations cannot name
every AI system in use, let alone say who owns it, what it may be given, or
whether a person checks its output. Forseti makes that list exist, then makes
every claim downstream trace back to it — so an answer to a customer can never
say more than the register supports.

**Four decisions the product is built around:**

1. **An AI system and an AI use case are different objects.** Risk lives at the
   use case — one tool ranking job applicants and drafting meeting notes is two
   different conversations.
2. **Origin decides the questions.** Procured SaaS, an API integration and a
   model built in house raise different questions; same workflow, different
   question set.
3. **Applicability is a join, not a property of a control.** That join *is* the
   Statement of Applicability, and it is per framework.
4. **AI proposes, humans dispose — and everything is audited.** A suggestion
   changes nothing until a person accepts it, and the trail records both the
   person and the suggestion they accepted.

## One product

The `ai_` prefix on the tables is a fossil. It existed to keep `risk`, `finding`,
`evidence` and `assessment` apart from the older tables of the same names;
dropping it is a rename of fifteen tables and every query that touches them,
which is its own migration rather than a side effect of a deletion.

## Stack

Next.js 16 (App Router), React 19, Tailwind v4, shadcn/ui (`base-nova` on Base
UI), Zod v4, Drizzle on Neon Postgres, Better Auth (multi-tenant, organization
plugin). Model calls use Claude Opus 5 via the Anthropic TypeScript SDK — every
call is a judgement call, not a lookup.

## Getting started

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill it in. `DATABASE_URL` and
`BETTER_AUTH_SECRET` are required to boot at all; `ANTHROPIC_API_KEY` is required
by the upload pipeline's scanned-PDF fallback, and by any AI feature.

```bash
npm run db:up      # local Postgres via docker-compose
npm run db:migrate
npm run seed       # demo user + Meridian Analytics org, AI estate included
npm run dev        # http://localhost:3000
```

`npm run db:reset` rebuilds the local database from scratch (down -v → up →
migrate → seed).

**Restart the dev server after changing any environment variable** — the
Anthropic and database clients are cached for the life of the process.

```bash
npm run build      # production build — the real typecheck gate
npx tsc --noEmit   # typecheck alone, faster
npm run lint       # eslint flat config; takes no path argument
npm test           # vitest — runs offline, no database container required
```

## The screens

| Route | What happens |
| --- | --- |
| `/overview` | Readiness against the standard in scope: applicable, implemented and evidenced shown separately, with what needs attention. Root redirects here. |
| `/inventory` | The AI register — search, filters, sortable columns, and an import that reports what it would change before it changes it. |
| `/inventory/[id]` | One system across nine tabs: use cases, assessments, controls claimed against it, evidence, risks, findings, activity. |
| `/use-cases/[id]` | A use case as its own object — own risk tier, own oversight, own assessment. |
| `/intake` | The governance queue: what came in, what is waiting on whom, and how long it has waited. |
| `/intake/new` | The requester's wizard. The third step is chosen by the system's origin. |
| `/intake/[id]` | Triage against serialised rules, the reviewer's override, and the decision. |
| `/frameworks` | Resolves the standard in scope and hands off to its Statement of Applicability. |
| `/frameworks/[id]` | The clause tree beside the editable SoA, with lenses for what an auditor looks at first. |
| `/assessments` | The impact assessment register, ordered by who is holding each one up. |
| `/assessments/[id]` | The assessment itself, rendered from a template config, with three-stage sign-off. |
| `/risks` | The risk register, ordered by residual, naming who accepted what remains. |
| `/risks/[id]` | Inherent → treatment → residual, a 5×5 matrix, and whether the controls the treatment rests on actually hold. |
| `/findings` | Findings and where each came from — internal audit, external audit, incident, review. |
| `/findings/[id]` | Root cause → corrective action → verification → closure, with the closure gate. |
| `/evidence` | The evidence register, sorted by expiry, showing how many controls rest on each document. |
| `/evidence/[id]` | One document and everything resting on it — including the controls that have nothing else. |
| `/questionnaires` | Inbound customer, prospect and insurer questionnaires. |
| `/questionnaires/[id]` | The copilot: answers drawn from the registers, with provenance and the right to refuse. |
| `/trust-center` | One page, two audiences, with the boundary between them stated rather than silently applied. |
| `/audit-pack` | The bundle handed over at a certification audit, with a pre-flight list of what an auditor will find in it. |

Readiness is computed in code, never by the model, and nothing derived is
stored — a document expiring moves the headline without anyone editing a number.
A control counts as *ready* only when it is applicable, implemented **and**
carries evidence that is verified and current. That is stricter than the number
most tools report, and the gap between "implemented" and "ready" is the distance
between what an organisation believes about itself and what it could prove.

## Current state

Reads are real and tenant-scoped. **Most writes are not built yet** — most
interactions hold local state, so they are real on screen and gone on refresh.
The exceptions are the risk record, the system profile's Overview tab and the
reviewer panel, which persist through routes of their own. Drafting affordances
render disabled with a tooltip; nothing calls a model. The audit pack is a
preview and writes no PDF.

## Documentation

| Topic | File |
| --- | --- |
| Any AI management system screen | [`src/app/(app)/_ams/README.md`](src/app/%28app%29/_ams/README.md) |
| Tenancy, auth, framework scoping, derived figures | [`docs/architecture.md`](docs/architecture.md) |
| Upload hardening and text extraction | [`docs/evidence-pipeline.md`](docs/evidence-pipeline.md) |
| What the test suites pin, and PGlite | [`docs/testing.md`](docs/testing.md) |
| Vercel, env vars, migrations | [`docs/deployment.md`](docs/deployment.md) |

`CLAUDE.md` holds the working agreements for agents in this repo.

## Notes

The seeded company, **Meridian Analytics**, is synthetic — the systems, the
people, the findings and the assessments all exist so a demo opens on populated
UI. None of it describes a real organisation or a real security posture. The
fixtures under `src/lib/ams/fixtures/` are the seed's source, so the demo and
the design stay one artefact.

**No ISO standard text is reproduced anywhere.** Controls carry an `officialRef`
— a citation, which is a fact — plus our own short title, requirement summary
and evidence guidance, written as original prose. A close paraphrase of a clause
is still the clause; there is deliberately no field to put one in.

Forseti produces drafts and readiness signals for internal use. It is not legal
advice, and nothing it generates should go to a buyer unreviewed.
