# Testing

```bash
npm test           # vitest, runs offline — no container needed
npm run test:watch
```

## What the suites pin, and why those things

Tests cover the things that fail silently:

- **Tenant isolation** in `ai-store.test.ts` — the security property the whole
  multi-tenant iteration rests on. Every accessor gets a positive test and a
  cross-tenant negative one, plus a forged link dropped rather than written.
- **The prompt-injection defence** in `sanitize.test.ts` — that
  `asUntrustedBlock()` defangs its own delimiter, so a paste cannot close the
  block early and be read as an instruction.
- **The rate limiter's** window and fail-open behaviour.
- **The 401-vs-403 split** in `session.test.ts`.
- **The role matrix** in `permissions.test.ts`, and that every writing route is
  actually reached by it in `route-guards.test.ts`.
- **The upload pipeline's hardening** in `evidence/hardening.test.ts` — sniffing
  by bytes rather than by name, and the zip-bomb guard.
- **Migration ordering** in `migrations.test.ts` — `_journal.json` must ascend by
  `when`, or every later migration is silently skipped.

## PGlite

Database tests run on **PGlite** — Postgres compiled to WASM, in-process —
against the real `drizzle/` migrations, so a missing `WHERE` clause fails the same
way it would in production. No container, no network, so `npm test` works offline
and in CI.

The harness is `src/test/pglite.ts`. `createTestDb()` applies the migrations from
`./drizzle` rather than building tables by hand: a fixture that redefined the
schema would drift from production the first time someone added a column, and the
tests would keep passing while the app broke. Call `close()` in `afterAll` or each
suite leaks a WASM instance.

Test files swap the singleton with `vi.mock("@/db")` **before** importing
`ai-store.ts`, since the factory runs lazily on first import.

`ai-store.test.ts` carries the cross-tenant negatives — cross-tenant read,
cross-tenant delete, a forged link dropped rather than written — plus two
properties that go further than a `WHERE` clause.

**The seeded workspace must derive what the design was approved as.** The screens
were signed off against the fixtures, the seed writes those fixtures to Postgres,
so every figure derived from a seeded organization has to equal the figure
derived from `fixtureWorkspace()` directly. Anything the round trip loses — a
dropped link row, a coerced null, a column that quietly truncates — surfaces
there as a different number rather than as a screen nobody rechecked. It has
already earned its place twice: it caught an evidence relation the fixtures
recorded twice and disagreed about, and a primary key that let the second
organization to seed take the first one's rows.

**An empty organization must derive without throwing.** The fixtures were never
empty and a fresh tenant always is, so every division, every absent framework and
every empty array meets its first zero there. A `NaN%` on a dashboard is the kind
of defect that ships.

`src/lib/ams/link-parity.test.ts` pins the one relation the fixtures still hold
twice. It goes when they stop being the seed's source.

## What is not covered

Tests don't cover the UI or the model calls. Verify those by signing in and
walking the flow: `/overview` → `/inventory` → a system profile →
`/frameworks` → `/risks` → `/trust-center`.

Nothing renders a React tree against real rows, so a component that crashes on a
shape only the database produces would pass everything here. The seeded
organization holds exactly the fixture data, which is why that gap has not bitten
yet — and exactly why an empty organization is the case to check by hand after
touching a screen.
