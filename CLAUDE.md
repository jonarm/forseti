<!-- Master CLAUDE.md for Forseti — 200 Line Extended Architecture & Enforcement Guardrails -->

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
* **Load skill before schema work:** `.claude/skills/schema-change`.
* Never hand-edit `src/db/auth-schema.ts` — it is fully generated by `npm run auth:generate`.
* `ai-store.ts` reads must degrade gracefully to empty states/arrays on error — never throw on page load.
* Drizzle migrations in `drizzle/meta/_journal.json` must strictly ascend by `when` timestamp.
* A production Vercel deploy migrates before it builds (`vercel-build`); previews never do.
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
* **Load skill before AI work:** `.claude/skills/ai-route`.
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

## Routes & Persistence Map
* Two domains, one Vercel project: `theforseti.ai` rewrites `/` to `public/landing.html` and 308s every other path to `https://demo.theforseti.ai`, which is the application. `src/proxy.ts` owns the split, by host equality — a preview is the application. Production must set `BETTER_AUTH_URL` to the application origin explicitly, or `VERCEL_PROJECT_PRODUCTION_URL` resolves `baseURL` to the marketing host and refuses every sign-in (`docs/deployment.md`).
* `/overview` — Readiness dashboard; computes figures dynamically from `readiness.ts`.
* `/intake` & `/intake/[requestId]` — Request queue; submits via `POST /api/intake`, decides via `POST /api/intake/decision` (write-once). The submission persists field-by-field via `PATCH /api/intake/[requestId]` — a sub-path because intake inverts the convention: the bare path is already the *create* route.
* A request's submission stays editable before a decision **and after one**; the decision never does. They are separate records, and `intake-patch.ts` cannot name `status`, `reference`, `decision`, `decidedById`, `decidedAt`, `reviewType`, `overrideJustification`, `createdSystemId`, `submittedById`, `submittedAt` or `reviewerId`. Triage is recomputed, so a correction to a decided request surfaces the divergence rather than hiding it. No `expectedVersion` — `saveIntakeRequest` has no such option.
* Changing a request's `origin` clears `originAnswers`, and the patch route drops any answer the current question set does not ask for. `toValueBag` spreads that bag flat for the triage rules, so an orphaned answer would go on firing a rule nobody was asked.
* **`more_info` is the one decision that reopens.** It leaves the request `needs_more_info` (`open: true`, still counting days waiting) and settles nothing, so `isSettled()` in `ams/intake-create.ts` — not `decision !== null` — is what the decision route 409s on and what the review screen reads to decide between the decide controls and the read-only record. The two must read the same predicate. Every other decision is still write-once.
* **`reviewType` is computed server-side, never carried in.** `POST /api/intake` runs `triage()` over the cleaned submission; the wizard sends the answers and nothing else. It is the baseline a departure is measured against, so a client that could name it could have a request quietly agreed with. While the request is unsettled the patch route keeps rewriting it from `triage()` (the queue reads it); once settled it is what the reviewer chose and never moves.
* The decision route measures a departure against `triage(existing.submission)` recomputed — **not** the stored `reviewType` — because the review screen has always printed the live recommendation as *the* recommendation. The screen's working selection starts there too (`override ?? result.suggested`); only the decided panel reads the stored field, via `settledReview`.
* `POST /api/intake/[requestId]/notes` appends to the record after a decision. **Append-only by design: there is no PATCH and no DELETE, and there must not be.** `ai_intake_note` has no `updatedAt` and no `deletedAt`; `saveIntakeNote` uses a plain insert, not an upsert, so a note cannot be rewritten by resending its id. A note is an account of a conversation; the submission is an account of a system. The first cannot be revised, the second must be. Correcting a note means adding another.
* Notes cascade from the composite FK when `purgeExpiredIntakeRequests` hard-deletes — the retention window is the only thing that removes one. `readWorkspace` loads them only when a page passes `intakeNotesFor`, like `activitySubjectId`. Gated on `intake: ["update"]`, not `["create"]`.
* `saveIntakeRequest` audits the submission per sub-field and per origin answer, never as one `jsonb` blob.
* `/inventory` — System register; persists via `POST /api/systems`, `PATCH /api/systems/:id`, `POST /api/systems/import`.
* `/use-cases` & `/use-cases/[useCaseId]` — Use case register; adds via `POST /api/use-cases/create`, edits persist field-by-field via `POST /api/use-cases`; select/export/delete/import via `/api/records/useCase/*`.
* `POST /api/systems/delete` removes one or many by id (`system: ["delete"]`); soft, audited per row, never transactional.
* `POST /api/records/[kind]/export|delete|restore|import|import/parse` serve all eight registers; the kind resolves via `ams/record-kinds.ts`.
* Register descriptions live in `ams/record-kinds.ts` (client-safe); store bindings in `lib/records.ts` (server-only).
* `uiPermissions().records[kind]` carries create/update/export/delete per register — never add a per-register boolean.
* PDF is the browser printing our HTML — no PDF library. All cell values pass through `escapeHtml` first.
* `/trash` is one tabbed screen for all eight registers; `/inventory/trash` 308s to it. `viewTrash` and `role: ["update"]` gate the page, the button and the restore route together.
* `GET /api/cron/purge-trash` permanently deletes what has sat in the trash 30 days; guarded by `CRON_SECRET`, scheduled in `vercel.json`.
* `POST /api/systems/import/parse` reads the uploaded spreadsheet and stores nothing; `import-plan.ts` still owns every judgement.
* A register's create route is a `create` sub-path (`/api/{risks,findings,assessments,use-cases}/create`); the bare path stays free for that register's edit route, which is where the domain gates live.
* Create schemas live in `ams/{system,risk,finding,assessment,use-case}-create.ts` and are parsed by the dialog *and* the route — one strict schema, never a client copy.
* A create body can never carry a record past a gate: no acceptance on a risk, no closure or verification on a finding, no status, answers or signatures on an assessment, no assessment link on a use case.
* Record ids are minted server-side by `ams/record-id.ts` — every store write upserts, so a caller-chosen id is a silent overwrite.
* Registers get a create button by mounting `RegisterCreateButton` + a dialog built on `_ams/create-dialog.tsx` — never a second copy of either.
* A system profile's Use Cases, Risks, Evidence and Findings tabs mount that same button above the content whether or not the tab has rows — a system has many of each. Only the Assessment tab's sits in the empty state.
* A profile create fixes the system: the risk and finding dialogs render it as text, never a select the record could be filed away from. `EvidenceUploadDialog` is not a `create-dialog.tsx` form — it has no System field and carries `systemId` in the form body instead.
* Registers get a "Link existing" button by mounting `RegisterLinkButton` + `_ams/link-record-dialog.tsx` — never a second copy of either. It is absent, not disabled, where `features.link` is `false`: that is a property of the register, not a refusal aimed at a person.
* `features.link` in `record-kinds.ts` names the style and the statement together. `attach` (evidence) is additive and gates on `create` — the `evidence` resource has no `update` statement on any role. `file` (risk, finding) writes a scalar column and gates on `update`. `false` (assessment, system, intake, questionnaire) is a parent fixed at creation. Use cases are `attach`: their systems are a join, edited through `/api/use-cases/{link,unlink}`.
* `POST /api/records/evidence/link` attaches documents already in the register to a system. Additive and batched, and it refuses a document whose `linkedSystemIds` is empty: that is organisation-wide and already counts toward every system, so linking it to one would narrow it.
* `POST /api/{risks,findings}/file` puts an organisation-level record onto a system. A record already naming a system is refused with 409, never re-parented — filing is not transferring. Risks send `expectedVersion`; findings carry no version because `saveAiFinding` has no such option.
* `POST /api/applicability` edits one SoA row (applicability, status, owner, policy, justification) — read, merge, write, because `saveApplicability` rewrites both joins from the row it is handed. Two statements: `answer: ["update"]` is the floor, and a patch carrying `applicability` is checked against `framework: ["update"]` as well, because scope is the governance lead's and the working loop is not. It refuses an exclusion whose *merged* row carries under `MIN_JUSTIFICATION` characters of prose. The patch schema (`ams/applicability-patch.ts`) cannot name a join or `lastReviewedAt`.
* `POST /api/records/evidence/cite` puts documents in the register against a control, writing `ai_evidence_link` with `targetKind: "control"` — the join `hasUsableEvidence`, `coverageForSystem` and the audit pack all read, and which nothing wrote before it. Additive: the route unions, because `saveAiEvidence` rewrites every link row for the document, systems included. A control the SoA marks `no`/`na` is refused. `POST /api/records/evidence/uncite` is the inverse and consults no SoA — the scope rule stops evidence arriving on an excluded control, it does not trap it there.
* `POST /api/applicability/claim` claims controls against a system, writing `ai_applicability_system` — the join every coverage figure is computed from. Additive only: the route unions, because `saveApplicability` rewrites the whole set and a caller sending the desired total would silently un-claim another system's. A control the SoA marks `no`/`na` is refused. `POST /api/applicability/unclaim` is the inverse and takes the claim back.
* The Controls tab's button gates on `editSoa` (`framework: ["update"]`), which a **system owner deliberately does not hold** — scope is the governance lead's decision. It is refused visibly, not hidden.
* The Policies tab has no link button and must not grow one. A system does not own a policy; it inherits the ones its claimed controls cite through `ControlApplicability.linkedPolicyId`, and `policies` on the profile is a derived set over `coverage.rows`. There is no system-to-policy relationship to write.
* Picker rows and the partial-batch sentence live once in `_ams/pick-list.tsx`; `Gated` is exported from `register-actions.tsx` for affordances that are not a register's. Controls and policies are not `RecordKind`s — never invent registry entries so they can reuse `RegisterLinkButton`.
* Unlinking is one dialog over four kinds (`_ams/unlink-from-system-dialog.tsx`) served by `POST /api/records/evidence/unlink`, `/api/applicability/unclaim`, `/api/risks/unfile` and `/api/findings/unfile`. Nothing there deletes a record — it stays on its own register; deleting is `/api/records/[kind]/delete`.
* **The empty set means opposite things on the two joins, and this is load-bearing.** Empty `linkedSystemIds` (evidence) means *every* system; empty `appliesToSystemIds` (applicability) means *no* systems. So unlinking a document's last system widens its reach and needs a stated warning, while unclaiming a control's last system simply narrows it. Never make the two symmetrical.
* Empty `linkedControlIds` is the third case and the plain one: the document cites no control. Nothing reads it as "every control", so citing and unciting need no widening warning — never copy the evidence-to-system guard into `cite`/`uncite` on the strength of the resemblance.
* Unfiling a risk clears `useCaseId` with `systemId` — the risk was about *this system doing that job*, so the half that survives alone would be a claim nobody made. Unfiling a finding keeps `controlId`: a framework control belongs to no system.
* Evidence unlink gates on `evidence: ["delete"]` where link gates on `["create"]` — the resource has no `update`, and the thing written and removed is the link row.
* `/inventory/[systemId]` — Profile editor; Overview tab persists field-by-field via `/api/systems/[systemId]`.
* `/frameworks/[frameworkId]` — Statement of Applicability and AI justification writer. Every edit persists field-by-field via `POST /api/applicability`; there is no local edits layer, and the justification cell commits on blur. Marking a control No/N/A is *held* client-side until a justification is written and then sent as one patch — the route refuses an unexplained exclusion, and the Draft-one button only appears once a control is being excluded. A control's Evidence block cites and un-cites through `_ams/cite-evidence-dialog.tsx`, gated on `records.evidence.create`/`.delete`.
* `/assessments` & `/assessments/[assessmentId]` — Impact assessment; opens via `POST /api/assessments/create`; sign-off footer persists via `/api/review-assignments`.
* `POST /api/assessments/create` refuses a `useCaseId` the system does not implement. `ai_assessment.use_case_id` has no foreign key and the dialog's scoped picker was the only guard — a client is not a gate, and `draft/assessment-field.ts` reads the pair as though it already agreed.
* `POST /api/risks/create` takes an optional `useCaseId` and applies the same pair check. It had been hardcoded null, so `ai_risk.use_case_id` was a column only the seed ever populated — the intersection was modelled and unreachable. A use case without a system beside it is refused: a risk about a purpose is a risk about that purpose *on a tool*.
* `ai_finding` deliberately has **no** `use_case_id`. Adding one would be a column nothing writes — the same state `ai_risk.use_case_id` was in until it became fillable. Make it reachable in the same change or not at all.
* `/risks` & `/risks/[riskId]` — Risk register; adds via `POST /api/risks/create`, edits persist via `POST /api/risks`; select/export/delete via `/api/records/risk/*`.
* `/findings` & `/findings/[findingId]` — Root cause, corrective action, gated closure; raises via `POST /api/findings/create`; select/export/delete via `/api/records/finding/*`.
* `/trust-center` — Dual-audience posture view; internal/external visibility bounded by data properties.
* Trust Center publishes a use case's name only when **every** system implementing it is shareable (`shareabilityOf`). A shared purpose must not leak past a withheld system through an approved sibling — the boundary is a property of the data, not of the parent you arrived through.
* A **retired** system does not gate that disclosure — it has no entry to be inferred from, and letting one veto would hide a purpose forever with nothing on screen explaining why.
* `shareabilityOf` is the original approved-only rule written once. Widening it (to withhold an approved system carrying an open finding, say) changes what the organisation publishes and belongs in its own change.
* Trust Center aggregations over a system's purposes: **maximum** risk tier (`highestTier` — scoping attaches to intended purpose, so an average would let ordinary uses dilute a high-risk one), **count** of governed purposes, and **conjunction** for `everyUseCaseAssessed`. `highestTier` is null rather than "minimal" when nothing is recorded: unexamined is not low risk.
* Those three render **internal only**. Each would be a new external disclosure, and publishing them is a decision about what the organisation tells customers — not a side effect of the model learning to count.
* The use case record edits its systems through `_ams/use-case-systems-dialog.tsx` (one component, both directions). The last-system refusal is enforced by the route; the dialog's blocked row is a courtesy.
* The inventory's use-case column is labelled **"Use cases reaching"** in the table and the export. A shared purpose counts for every system it reaches, so the column no longer sums to the register's total — both numbers are right and answer different questions.
* The published oversight line is the **weakest** arrangement across a system's use cases, and `oversightBasis` says so beside it. An unrecognised `oversightLevel` counts as the weakest, never the strongest.

---

## Conventions & Style Rules
* **Framework:** Next 16 conventions apply (`src/proxy.ts`, no `middleware.ts`, Server Action body ≤ 1MB).
* **Page Architecture:** Async Server Components with `export const dynamic = "force-dynamic"`.
* **Client Components:** Mutate via `fetch("/api/...")` then call `router.refresh()` to update React tree.
* **Styling:** Dark-only, zinc-based theme using semantic tokens from `globals.css` (brand/indigo for primary actions only).
* **Code Documentation:** Source files must open with a top-level block comment detailing the decision they embody.

---

### Git & Branch Safety
- Always run `git status` before beginning work on a new task or file edit.
- Pull the latest changes from the active branch before generating new code or migrations.
- Never force push (`git push -f`) or hard reset (`git reset --hard`) without explicit user permission.
- Check for unstaged changes before committing to avoid accidentally bundling untracked or temporary files.
- Never commit broken builds; run `npx tsc --noEmit` to verify type safety prior to committing.
- Commit messages must use imperative style on `main` (e.g., `"Add multi-tenant foundation"`). Avoid `Step N:` prefixes.

---

## Model Strategy
* Plan complex architectural tasks with Claude Opus; execute implementation steps with Claude Sonnet.
* Consult model advisor before modifying tenant boundaries, authorization logic, injection defenses, applied DB migrations, or after failing the same execution step twice (`docs/model-strategy.md`).

## Method
* Always ask clarifying questions if there's any during the planning stages.