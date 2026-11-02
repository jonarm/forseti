@AGENTS.md

# Forseti — AI governance platform
Multi-tenant B2B SaaS AI management system.
Domain `src/lib/ams/` · tenant boundary `src/lib/ai-store.ts` · components `src/app/(app)/_ams/`.

## Commands
```bash
npm run dev           # :3000 — dev server with hot reload
npm run build         # Typecheck gate & production build (never run while dev server is live)
npx tsc --noEmit      # Fast standalone typecheck
npm run lint          # ESLint check (takes no path argument)
npm test              # Vitest offline test suite
npm run db:generate   # Drizzle schema.ts -> migration SQL
npm run db:migrate    # Apply pending migrations by hand (see Deploying & Migrations)
npm run seed          # Seed demo org (Meridian Analytics) + demo user
npm run auth:generate # Re-generate Better Auth plugin types after changing auth.ts
```

Manual UI verification flow: `/overview` → `/inventory` → system profile → `/frameworks` → `/risks` → `/trust-center`.

---

## Setup & Environment
* Copy `.env.example` to `.env.local` for local execution.
* `DATABASE_URL` and `BETTER_AUTH_SECRET` are required at boot time and throw at import if missing.
* **Always restart the dev server after editing `.env.local`** — Anthropic and DB clients cache for process life.

---

## Deploying & Migrations

* `build` and `vercel-build` compile only. They must never migrate, seed, initialize reference data or purge records.
* Database operations require an explicit operator command and verified target. Preserve applied migration files and journal ordering.
* `reference:init -- --organization <slug>` adds missing framework definitions only to an existing organisation. It never overwrites definitions or adds demo accounts/business data.
* `seed` is demo-only: require `ALLOW_DEMO_SEED=1` and operator-provided `DEMO_PASSWORD`; never log the password.
* Preview deployments need their own database/Neon branch. A different Vercel URL does not establish database isolation.
* Use the existing isolated checkout; do not create worktrees unless requested. See `docs/deployment.md` for the public workflow.

---

## Core Architectural Guardrails

### Tenancy & Authorization
* `src/lib/session.ts` is the sole tenant boundary (`requireOrgContext()` for pages, `requireOrgForApi()` for API routes).
* `src/proxy.ts` only checks session cookie existence — it is never an authorization gate.
* Every mutating route must invoke `requirePermission`; GET routes stop at org membership checks.
* Every `ai-store.ts` function accepts `organizationId` as its first parameter and filters every query with it.
* Primary keys and composite foreign keys must start with `organizationId` (including join tables).
* Pass `uiPermissions()` to clients, never raw roles; client component subtrees read `usePermissions()`.
* `can()` and `uiPermissions()` must evaluate using the tenant's active `grants` from `OrgContext`.
* Refused UI affordances are disabled and explained via `refusalNote()`; never gate unpersisted local state.
* Five immutable role definitions: `platform_admin`, `governance_lead`, `system_owner`, `reviewer`, `auditor`.
* `auditor` holds only `export` statements, one per register. It must never gain one that writes.
* Roles `reviewer` and `system_owner` are deliberately incomparable — never hierarchy-collapse them.
* Custom role grant edits (`/settings/roles`) require `role: ["update"]` held strictly by `platform_admin`.
* `POST /api/members` creates an account outright — name, email, initial password, role — and adds it to the org. Gated on `role: ["update"]`, **not** `member: ["create"]`: the plugin's own create statement is held by the governance lead too, and minting a credential is not inviting one. Never `auth.api.signUpEmail` — `nextCookies()` would hand the admin the new user's session; assemble it as `sign-up.mjs` does (`password.hash` → `internalAdapter.createUser` → `linkAccount` with `providerId: "credential"`) and finish with `auth.api.addMember`, whose `afterAddMember` hook is the membership trail row. The account creation writes its own audit entry, audit-first, keyed on the email because no user id exists yet.
* An email that already has an account is refused with 409, never adopted into the org — the alternatives are ignoring the password the admin typed or resetting somebody else's.
* There is no transaction across Better Auth's writes and ours, so a failed `addMember` deletes the account it just made. An orphan user with a working credential and no membership could sign in and create an organization nobody expected.
* The password floor lives once in `password-policy.ts`; `auth.ts`, the sign-up form and the add-user form all read it.
* Three uneditable role fences: `platform_admin` role, Better Auth membership grants, and `FORBIDDEN_GRANTS`.
* Read the `CREATOR_ROLE` constant — never hardcode string literals.
* Legal, Security, and Exec sponsors are `ai_review_assignment` rows, never custom database roles.

### Audit & Data Integrity
* Every store write accepts an `Actor` and emits an audit row via `src/lib/audit.ts` BEFORE the domain write.
* `Actor.userId` is a Better Auth user ID, never an `ai_person` record ID.
* `ai_activity_event` is strictly append-only (managed via trigger `drizzle/0013`); zero UPDATE or DELETE paths.
* All eight registers soft-delete (`ai_system`, `ai_use_case`, `ai_risk`, `ai_finding`, `ai_evidence`, `ai_assessment`, `ai_questionnaire`, `ai_intake_request`); reads filter `deleted_at IS NULL`.
* Destructive UI confirms by naming every record it will remove, never by counting them.
* The retention window lives in `ams/trash.ts`; never restate 30 days in a screen or a query.
* `requireCronRequest()` is the only non-session guard under `/api`, and only `cron/*` may use it.
* A purge is org-scoped and looped per tenant — never one global `DELETE ... WHERE deleted_at <`.
* Restoring a soft-deleted system automatically restores visibility of its dependents via `readWorkspace`.
* A null `systemId` represents an org-level reference, never an orphan record — except on a use case, which has no `systemId` at all: its systems are `ai_use_case_system` rows, and an unmatched system is refused by the create route and the importer, never widened to org-level.
* **A use case is implemented by many systems and a system implements many use cases** (`ai_use_case_system`, PK `(organizationId, useCaseId, systemId)`). `AIUseCase.systemIds` is hydrated from the join on read. `POST /api/use-cases` still refuses the relation — `EDITABLE` is scalars only; it moves through `/api/use-cases/link` and `/unlink`.
* **The last system cannot be unlinked**, and only the route enforces it — the join cannot express a minimum. A use case with no systems is orphaned by `readWorkspace` and drops out of every register with no tombstone. This is *not* the evidence rule, where an empty link set means every system.
* A use case survives while **any** of its systems does. `readWorkspace` strips the dead system from `systemIds` rather than dropping the row, exactly as it does for applicability claims and evidence links.
* **Risk tier and oversight are baseline-plus-override.** `AIUseCase.riskTier`/`oversightLevel` are the purpose's own answer; `ai_use_case_system` carries nullable columns for the pairings that genuinely differ. Null means the baseline stands, and `systemOverrides` is sparse — only pairings with something to say appear.
* Resolve through `effectiveTier(useCaseId, systemId)` / `effectiveOversight(...)` wherever a system is in scope (system profile tabs, Trust Center, assessment drafting). Read the raw field only where the question is genuinely about the purpose — the use-case register, its export, and the questionnaire answers in `answer-engine.ts`, all of which are org-wide with no system to resolve against. Each of those sites says so in a comment; the split is a decision, not an oversight.
* The overrides ride on the link rows, and `saveUseCase` replaces links wholesale — a write that does not carry `systemOverrides` through discards every pair-level judgement.
* `purgeExpiredSystems` hard-deletes only the use cases whose **last** system is purged. The old cascade did this automatically; losing it meant writing what it used to do.
* Purging a use case nulls `ai_risk.use_case_id` and `ai_assessment.use_case_id` first — neither has a foreign key into `ai_use_case`.
* Deleting a use case hides nothing else. Its risks stay on their own register; only deleting the *system* orphans dependants.
* Persisting edits must send `expectedVersion` and handle HTTP 409 responses on version mismatch.

### Database & Schema Guardrails
* Review `docs/architecture.md` and existing migrations before schema changes.
* Never hand-edit `src/db/auth-schema.ts` — it is fully generated by `npm run auth:generate`.
* `ai-store.ts` reads must degrade gracefully to empty states/arrays on error — never throw on page load.
* Drizzle migrations in `drizzle/meta/_journal.json` must strictly ascend by `when` timestamp.
* Builds never apply migrations; run migrations separately against a verified target.
* Store writes use `onConflictDoUpdate` with composite targets `(organizationId, id)` rather than delete-insert.
* Scope deletion of link/join rows by `organizationId` in addition to parent record ID.

### Domain Rules
* Never store derived values (readiness, coverage, residual risk, confidence); compute them dynamically on read.
* Export columns live once in `ams/inventory-export.ts`; the picker and the writers both read that array.
* Model writes narrative text only; code owns all numerical calculations, thresholds, and status colors.
* Status thresholds live in `readiness.ts`, `risk-scale.ts`, `tone.ts` — never recalculate inside components.
* Control applicability is a join (`ai_applicability` on `organization`, `framework`, `control`).
* Material assessment edits reset the sign-off chain; plain/typo edits keep signatures intact.
* Restoring a record never resets a sign-off chain — a restore is not an edit.
* Re-rating a residual risk voids its acceptance in the store automatically.
* Accepting a residual risk requires a written justification reason inside the route handler.
* Findings close only with root cause, corrective action, and independent dated verification by non-owner.
* Import pipelines plan first, validate second, and apply third — reject invalid rows, never coerce.
* A register imports by supplying an `ImportSpec` (`ams/import/*-spec.ts`); the planner and routes are shared.
* A file over the import caps is refused with its count, never truncated to fit.
* A one-column sheet is re-split only if every row splits and the row count is unchanged.
* Registers get bulk actions by mounting `RegisterActions` + `useSelection` — never a second copy of either.
* Questionnaire answers are ephemeral runtime state — never persist them to the database.
* A purge must clear rows no foreign key cascades from: questionnaire questions, assessment review assignments.

### API & AI Routes
* Review route guards, sanitization, and error handling before changing drafting routes.
* Execute `requireOrgForApi()` and `checkRateLimit()` BEFORE parsing the request body.
* Map all thrown AI route errors using `describeAiError()` from `src/lib/ai-errors.ts`.
* All untrusted input passes through `cleanText`/`cleanLine` and `asUntrustedBlock()` before prompt inclusion.
* Prompts must declare untrusted blocks as data, instructing the model to ignore inline directives.
* Request bodies carry selectors/IDs only; routes load prompt context directly from `ai-store.ts`.
* AI models are never asked to evaluate or output their own confidence score or coverage figures.
* Refusals, `max_tokens` truncation, null output, and `ZodError` exceptions must be handled explicitly.

### Evidence Pipeline & Uploads
* Evidence and inventory upload routes use Next.js Route Handlers with `request.formData()` — never Server Actions.
* `POST /api/records/evidence/upload` files documents; a scan with no text is accepted, not refused. An optional `systemId` links the batch to one system and is resolved in the caller's org before anything is stored.
* Exclude all file upload routes explicitly from `src/proxy.ts` to prevent request body buffering.
* Mandatory hardening sequence: `sniff` (magic bytes) → `zip-guard` → `extract` (timeout/cap) → `pdf`.
* Uploads extract text immediately upon ingest and discard raw byte streams.
* Uploading new evidence marks derived narrative text as stale with a visible notice; it never deletes it.

---

## Documentation

See `docs/architecture.md` for the code map, `docs/lifecycle.md` for workflows,
and `docs/known-limitations.md` for incomplete features.

## Conventions & Style Rules
* **Framework:** Next 16 conventions apply (`src/proxy.ts`, no `middleware.ts`, Server Action body ≤ 1MB).
* **Page Architecture:** Async Server Components with `export const dynamic = "force-dynamic"`.
* **Client Components:** Mutate via `fetch("/api/...")` then call `router.refresh()` to update React tree.
* **Styling:** Dark-only, zinc-based theme using semantic tokens from `globals.css` (brand/indigo for primary actions only).
* **Code documentation:** Explain non-obvious behaviour and constraints where needed.

---

### Git & Branch Safety
- Always run `git status` before beginning work on a new task or file edit.
- Pull the latest changes from the active branch before generating new code or migrations.
- Never force push (`git push -f`) or hard reset (`git reset --hard`) without explicit user permission.
- Check for unstaged changes before committing to avoid accidentally bundling untracked or temporary files.
- Never commit broken builds; run `npx tsc --noEmit` to verify type safety prior to committing.
- Commit messages must use imperative style on `main` (e.g., `"Add multi-tenant foundation"`). Avoid `Step N:` prefixes.

---
