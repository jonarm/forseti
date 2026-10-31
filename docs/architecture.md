# Architecture

Tenancy, auth, the framework registry, and where a number comes from.

**Read this before changing the tenant boundary, the auth flow, or how a
framework is scoped.** `CLAUDE.md` carries the laws; this file carries the
reasons.

---

## Tenancy

### `src/lib/session.ts` — the tenant boundary

`requireOrgContext()` (pages) and `requireOrgForApi()` (routes) resolve the
caller's active organization. `src/proxy.ts` only checks that a session cookie
*exists*; it does not validate it, so it is a redirect convenience, never the
gate. Every page and every API route re-checks here.

### `src/lib/ai-store.ts`

Drizzle against Neon Postgres, and the only store there is. Every function takes
`organizationId` first and every query filters on it — that signature is the
tenant isolation, so a missing scope is a type error rather than a data leak. The
only source of that id is `session.ts`.

Reads must never throw: every page calls one during render, so an escaping error
500s the whole app; they degrade to the empty state, which the pages all handle.

The join tables carry `organizationId` too, even though both sides already do — a
join row is the one place a cross-tenant link could be forged, and every link
query filters on it.

The procedure for adding a table or accessor is the `schema-change` skill.

Two properties go further than a `WHERE` clause:

**Every primary key starts with `organizationId`, join tables included.** These
ids are ours rather than the database's, and every organization seeds from the
same fixture file — so two tenants genuinely hold a row called
`sys-m365-copilot`. With `id` alone as the key the second organization to seed
does not get its own row: its upsert matches the first one and rewrites
`organization_id`, and the first tenant's inventory silently moves house. The
foreign keys are composite for the same reason, which makes a row pointing at
another tenant's parent impossible at the database level rather than merely
unlikely. A test seeds both organizations and asserts each still derives its own
figures.

**Nothing derived is stored.** Readiness, per-system coverage, triage
recommendations and answer confidence are all computed on read, so a stored
figure can never disagree with the rows it came from. The two places a write
*does* invalidate a human judgement are handled explicitly and marked in the
file: a material assessment answer resets the sign-off chain, and re-rating a
residual voids the acceptance it was given against.

### `readWorkspace()` — one organization's whole management system

Composed from the accessors above rather than written as one joined query, so a
single table failing costs that register and not the page. Pages call it through
`amsPage()` in `src/lib/ams-page.ts`, which resolves the tenant, reads the
workspace and returns both halves: plain arrays for `WorkspaceProvider` to hand
to the client subtree, and the same data with its lookups for whatever the page
derives on the server.

Every derived function in `src/lib/ams/` takes that workspace as its **first**
argument, for exactly the reason the accessors take `organizationId` first —
it makes summarising the wrong tenant's data a type error rather than a number
that looks plausible. There is no module-scope register to fall back on.

The audit trail is the one register that grows without bound, so it is
subject-scoped and empty unless a page names the record it is about.

### `src/lib/auth.ts` — Better Auth

The `databaseHooks.session.create.before` hook is load-bearing: **the organization
plugin does not select an org on sign-in**, so without it `activeOrganizationId`
is null and a returning member is sent to onboarding to create a second
organization. It picks their oldest membership.

`src/db/auth-schema.ts` is generated — never hand-edit. Re-run
`npm run auth:generate` after changing the plugin list in `src/lib/auth.ts`.
`src/db/schema.ts` re-exports it and adds the app's own tables.

### `src/lib/permissions.ts` — who may change what

`session.ts` answers *who is this and which tenant*. This answers *may they*.
The two were separate for a long time in the worst way: `OrgContext.role` was
resolved on every request and then never read, so all thirteen mutating routes
authorised identically and any member could reword a control, delete one, or
import a framework over another.

Five roles, and they are the governance function's own org chart rather than a
generic owner/admin/member ladder:

| Role | Owns |
|---|---|
| `platform_admin` | The tenant. Everything below, plus deleting the organization. |
| `governance_lead` | The management system's *shape* — the control library, the crosswalk, the frameworks in scope — and the membership list. |
| `system_owner` | The systems they are accountable for: registers, answers, evidences, works the registers, drafts policies. |
| `reviewer` | Approvals. Assessments, policies, finding verifications. **Authors nothing.** |
| `auditor` | Reads. |

**The ladder breaks at the reviewer, on purpose.** A reviewer holds *fewer*
statements than a system owner and one the system owner must never hold, because
the entire value of an approval is that the author could not grant it to
themselves. `permissions.test.ts` asserts the two are genuinely incomparable —
each holds something the other is refused — so a future change that quietly
"tidies" the reviewer into an ordinary rung fails.

Two verbs are carved out of their resource to make that separation expressible.
`policy: approve` sits apart from `create`/`update`/`delete`: writing a policy is
the working loop, declaring that a buyer may rely on it is a decision, and it is
the moment a document starts satisfying controls. `finding: verify` sits apart
from `update` for the same reason — a finding closes only with a dated
verification by somebody other than its owner, and separate statements make that
a permission check rather than an honour system. Both splits are also what make
AI drafting safe to offer: a model writes, a person adopts.

`signoff: approve|reject` is the statement that makes Reviewer/Approver a role
rather than a job title. Without it a reviewer would be indistinguishable from an
auditor, because every other approval in the vocabulary arrives as a side effect
of some authoring permission.

**Legal, Security and the exec sponsor are not roles.** They are stages a record
has to clear, and who covers a stage differs per system and changes over time. As
roles they would multiply every time the workflow gained a step and would still
not answer who reviews *this* assessment. They live in `ai_review_assignment`,
keyed `(organization, subjectKind, subjectId, stage)`. The role says "may approve
at all"; the assignment says "is the one to approve this". `assignReviewer()`
checks the assignee against the organization's own membership — a reviewer from
another tenant would render as a perfectly ordinary name on screen.

**One vocabulary, evaluated locally.** `createAccessControl` from
`better-auth/plugins/access` defines the statements, and a role's `authorize()`
is *synchronous and pure* — a check over its own statements with no I/O. That is
what makes `can()` cheap enough to call on every request, and it is why
`auth.api.hasPermission()` is deliberately unused: it is a round trip to
re-derive something `OrgContext.role` already carries.

The same `ac` and `roles` are passed to the `organization()` plugin in `auth.ts`
and to `organizationClient()` in `auth-client.ts`. Better Auth then polices its
own member and invitation endpoints from these definitions rather than a second
set, and the client's typed surface knows `contributor` and `viewer` exist.

`CREATOR_ROLE` is not cosmetic. Better Auth's last-one-out protections — you
cannot remove, demote or leave as the only holder — compare the stored string
against whatever `auth.ts` names as `creatorRole` and against nothing else, so
`auth.ts` and the UI guard in `members-table.tsx` both read the constant rather
than naming a role.

`normaliseRole()` resolves three generations of stored names: Better Auth's
`owner`/`admin`/`member`, Forseti's first four, and these five. Anything
unrecognised becomes `auditor` — a typo in the column must cost access, never
confer it, and the lookup uses `Object.hasOwn` so `constructor` and `__proto__`
resolve to read-only rather than to whatever sits at that key. Migration `0012`
makes the stored data agree, privilege-preservingly; the normaliser stays as the
safety net for a restored backup or a row an older client writes.

**Enforcement is `requirePermission()`**, built *on* `requireOrgForApi()` rather
than beside it, so a route cannot check the role and forget the tenant. Its 403
names the action — "forbidden" does not tell someone their next move is to ask an
admin. GET stays at membership level: a role that can open the app can read what
is in it, and a `control: ["read"]` statement would only ever return true.

The UI receives `uiPermissions()` — plain booleans — and **never the role**. A
client given `"admin"` has to re-derive what that means, and then there are two
matrices that can disagree: offering something the route refuses, or hiding
something it would allow. Hiding an affordance is a courtesy; the route is the
gate.

**Reaching the client.** `amsPage()` resolves `uiPermissions(role)` beside the
workspace, and `WorkspaceProvider` takes it as a **required** prop — a page that
forgets is a compile error rather than a screen that quietly offers everything to
everyone. Leaves read `usePermissions()`; it throws without a provider, because
the safe-looking fallback is an object of `false`, which renders every action
disabled and reads exactly like a permission problem somebody would spend an
afternoon on.

Permissions get their own context rather than becoming a field on `Workspace`:
they are a fact about the *caller* and everything else there is a fact about the
*organisation*. A derived function holding both would eventually use one to
compute the other, and a readiness figure that changes with who is looking at it
is a different product.

**A UI flag is derived from the statement its route checks**, never from one that
happens to be held by the same roles. `draftWithAi` is `ai: ["draft"]` because
that is what `/api/ai/draft-justification` demands; `runAi` stays `ai: ["assess"]`
and is deliberately not reused for it, even though today the same three roles hold
both. `permissions.test.ts` asserts every flag against `can()` for exactly this.

Gated today: the affordances that reach a route — the suggestion card's
accept/edit/reject, the three AI draft buttons, the system profile's editors
(`editInventory`, from `system: ["update"]`) and the inventory's Register and
Import buttons (`registerSystems`, from `system: ["create"]`, because that is
what `POST /api/systems` and `POST /api/systems/import` both check — importing a
spreadsheet is registering nine systems at once, and no coherent role may do one
and not the other). The profile's editors and the inventory's buttons are one
screen and two flags for the reason above: the statements are held by the same three roles today, and a flag
that agrees with its route by coincidence stops agreeing the first time a role
moves. **The register screens are deliberately untouched**, because their
interactions are local state that persists nothing (`_ams/README.md`), and a
permission gate over a mockup is a claim the code cannot keep. Each one gets
gated as its real write lands.

`route-guards.test.ts` is the part that keeps this true. It reads every route
file and fails if a handler exporting POST/PUT/PATCH/DELETE does not call
`requirePermission`, if the guard runs after the body is parsed, or if a check
carries no action phrase. The failure it exists for is silent: a new route that
stops at `requireOrgForApi()` works perfectly and quietly lets an auditor rewrite
the library.

Roles are managed at Settings → Members, reached from the sidebar's Settings
group. Before it existed, roles could only be changed by calling Better Auth's
endpoints by hand. It refuses to demote or remove the last platform admin — that
would leave an organization repairable only from the database.

**A new member starts as `auditor`, not as Better Auth's `member`.** The
plugin's own default reads as a system owner here, so taking it would mean
everyone added to an organization could immediately answer assessments and
attach evidence — a grant nobody chose. `LEAST_PRIVILEGED_ROLE` is the floor and
promotion is a deliberate act. `CREATOR_ROLE` is the other end and is load
bearing rather than cosmetic: the plugin's last-one-out protections compare
against that exact string, so `auth.ts` and the UI guard in `members-table.tsx`
both read the constant and can never name different roles.

#### Three generations of role strings

`normaliseRole()` resolves all of them, and it has to: Better Auth's original
owner/admin/**member**, Forseti's first four (owner/admin/contributor/viewer),
and today's five. `drizzle/0012` rewrote the column, so in a migrated database
the aliases are dead weight — they stay for the row a migration missed, a row
written by an older client, or a restored backup. The mapping preserves what each
old role could actually *do*, so nothing silently gains a permission on the way
through; anything unrecognised falls to `auditor`, which is why that role has to
stay genuinely powerless.

#### What a role means, per tenant

Settings → Roles renders the matrix in full — until it existed, the only complete
statement of it was `permissions.test.ts` — and lets a tenant change the parts it
may. Overrides live in `ai_role_grant`, resolve onto `OrgContext.grants` in
`requireOrgContext()`, and reach every check through `can(role, request, grants)`
and `uiPermissions(role, grants)`.

**A missing row means the code default, never "holds nothing".** A stored copy of
the defaults would freeze one build's answer and withhold every statement added
later. A successful lookup with no overrides returns `{}`, which selects those
defaults. A failed lookup throws instead: silently returning `{}` would restore
permissions the tenant removed. Context resolution then fails, and API guards
return 503 before the requested operation runs.

Three fences, all enforced in the store rather than in the route, because they
must hold however the row arrives:

- **`role: ["update"]` gates the editor, and only `platform_admin` holds it.**
  The obvious choice — `member: ["update"]`, which gates the members screen next
  to it — would have handed the editor to the governance lead, who could then
  grant `signoff: ["approve"]` to `system_owner`. The author endorses their own
  assessment, and the organization looks correctly configured. The statement is
  also not itself editable: a permission that can widen who holds it is not one.
- **`organization`, `member` and `invitation` are not overridable.** The
  organization plugin polices those from the `ac` it is handed at import in
  `auth.ts`, and `members-table.tsx` calls `authClient.organization.*` directly —
  so an override would be honoured by our routes and ignored by the library.
  Divergence in the permissive direction. They render read-only with the reason.
- **`FORBIDDEN_GRANTS` is the segregation of duties**, and it is not negotiable
  per customer: a system owner endorsing their own sign-off, verifying their own
  fix or approving their own policy, and a reviewer appointing their own
  reviewer. A matrix that could switch those off would let an organization
  configure away what makes its records defensible.

`can()` keeps two implementations — the compiled role's `authorize()` where a
tenant has changed nothing, a subset check over the effective grants where it
has — so an untouched organization runs byte-for-byte what shipped.
`permissions.test.ts` asserts the two agree across the whole vocabulary; without
that, customising one resource could quietly change semantics on every other.

### Membership changes are audited at the plugin, not at a route

`src/lib/membership-audit.ts`. Every write to Forseti's own tables goes through
`ai-store.ts`, which cannot be called without an `Actor`. Membership does not:
`members-table.tsx` calls Better Auth's endpoints straight from the browser, so
promoting somebody, removing them or inviting a stranger produced no record at
all — the event an auditor asks about first.

Wrapping those calls in a route of ours would have audited only the calls that
chose to use it, and the plugin's endpoints stay reachable regardless.
`organizationHooks` fire inside the plugin however the endpoint was reached, so
no path changes a membership silently. Same move as the store's required
`Actor`: structural rather than remembered.

Two details are deliberate and easy to "fix" wrongly. These are **`after` hooks**,
inverting the store's audit-first ordering, because Better Auth owns the
transaction and has already committed by the time we are called — the row records
a fact rather than an intention, so a failed insert is logged loudly instead of
ordered around. And **`subjectId` is the affected user's id, not the member
row's**: a member row is deleted and recreated when somebody leaves and rejoins,
so only the user id keeps one person's access history together.

Settings → Members renders that history below the list, because "who gave them
that access, and when" is asked while looking at the member list. The actor
resolves to a name for anyone still in the organization and to a raw id for
anyone who has left — which is correct, since the record has to outlive the
membership it describes.

### Accounts and people are different id spaces

**An `ai_person` is deliberately not a Better Auth user.** A control owner is
frequently somebody who has never signed in — the Head of Claims owns the
fairness control and reads about it in a monthly report — and an account holder
is not automatically the owner of anything. Wiring ownership to `user.id` would
look like tidying and would in fact make every accountability record conditional
on somebody having been provisioned, which is how an inventory quietly loses its
accountability column.

The cost was the other direction: nothing could resolve *the signed-in caller* to
the person a record names, so AI decisions recorded no person and the trail
rendered raw user ids. `ai_account_person` is the one crossing between the two
spaces — primary key `(organizationId, userId)`, a unique index on
`(organizationId, personId)`, and a composite foreign key to
`ai_person(organization_id, id)` so a cross-tenant pair cannot be written at all.

**Uniqueness runs both ways and both directions are load bearing.** One person
per account, or "who is the caller" has two answers; one account per person, or
two accounts both claim `p-anders` and every "is the caller the assignee?" check
passes for both.

It is a **claim somebody recorded, never an inference**. Nothing matches on name
or email — "R. Andersen" the person and `lead@…` the account look like the same
human, and a product that assumes it eventually signs somebody else's approval
with their name. Setting it needs `member: ["update"]`, and it is audited under
the `member` subject so it lands on the same access trail as a role change.

`requireOrgContext()` resolves it onto `OrgContext.personId`, and
`acting-person.ts` holds the rule for what to do without one: **an unmatched
caller is recorded as unattributed, never as a plausible guess.** That is the
ordinary state of a new seat rather than a failure — an audit trail that
confidently names the wrong person is strictly worse than one that names nobody,
because the second invites the question and the first closes it. The *account* is
recorded correctly either way, on `Actor.userId`.

Two things follow that look like omissions and are not. **History is never
back-filled**: a decision taken before its caller was matched stays unattributed,
because that is what was true when it was taken. And **withdrawing a link is not
a retraction**: records already written keep the person they name.

A person held by an account that has left the organization is **released rather
than defended**. Nothing cascades that table when a seat goes, so without it a
departure would lock that person forever — the replacement refused as taken, by
an account no longer on the members screen for anybody to clear.

**Where the mapping is used, and where it deliberately is not.** The reviewer
panel resolves each assignment's account to a person, so a stage assigned to an
account with no person says so rather than looking complete. The activity panel
resolves the actor through it — falling back to a person-id lookup, because the
seeded fixture trail predates the mapping and stores `ai_person` ids directly.
What it does **not** do is gate the sign-off chain: advancing that chain is still
local state, and a gate over state that vanishes on refresh is a claim the code
cannot keep. When comparing a caller to the person a record names, an unmatched
caller must never match — `null === null` would make every unmatched account the
assignee of every unassigned stage, turning a missing name into an
authorisation hole.

### `src/lib/audit.ts` — the trail, and why a write cannot avoid one

`session.ts` answers *who*, `permissions.ts` answers *may they*. This answers
*what did they actually do*.

**Every store write takes an `Actor`, and the store emits the audit row itself.**
That is the same trick as `organizationId`, on a second axis: a required
parameter is a rule that cannot be forgotten, where "remember to log this" is a
rule that is eventually not followed. There is no function in `ai-store.ts` that
can change a row without leaving a trail — which is a stronger guarantee than
auditing every caller, because it also holds for the callers nobody has written
yet. The routes that exist today were made to pass an actor by the compiler, not
by review.

`Actor.userId` is a **Better Auth user id, never an `ai_person`**. The two are
deliberately different sets — a control owner frequently has no account — and an
audit trail has to name the account that made the request. A trail that names the
record's owner when somebody else changed it is worse than no trail.
Which *person* an account is, is a separate question with its own answer —
`ai_account_person`, above. That resolution is **not, and must not become, the
audit actor**: the two answer different questions, and an account nobody has
matched still writes a perfectly good audit row.

**The table is append-only, enforced in the database.** `drizzle/0013` puts a
trigger on `ai_activity_event` that raises on UPDATE and on DELETE. A trail the
application can rewrite is a trail that proves nothing; the reason an auditor
accepts it as evidence is that the code holding the connection *cannot* revise
it. The one permitted delete is a tenant leaving — `organization_id` cascades,
and the trigger detects the case by asking whether the owning organization still
exists, because Postgres runs a cascade after the parent row is gone.

**The audit row is written first.** Production runs on Neon's HTTP driver, which
has no interactive transactions, so the audit insert and the domain write cannot
be made atomic. Of the two orderings only this one fails safe: a trail that
over-reports is repairable by reading it, a trail with silent holes is not
evidence at all. When the domain write throws, a second entry records that, so
the over-report is visible rather than misleading.

Events are **field-level** — one per field that actually moved — because
"somebody saved this system" is not something an auditor can act on and "somebody
moved it from pilot to production" is. A save that changes nothing writes
nothing. `renderAuditValue()` sorts object keys before stringifying, which is
load bearing rather than tidy: `jsonb` does not preserve key order, so without it
every save of an untouched `vendorDetail` would report itself as a change and the
trail would fill with edits nobody made.

`reason` is the column that makes the trail answer *why*. It is nullable because
most edits carry no reason and inventing one would be worse than its absence;
`requireReason()` is how a caller demands one for the acts that need defending,
and it lives in `audit.ts` rather than the store because `ai-store.ts` is the
tenant boundary and deliberately not a policy layer.

### Soft delete and versions

`ai_system` and `ai_risk` — the two tables with delete functions — carry
`deletedAt`/`deletedBy` and a monotonic `version`. Every read filters
`deleted_at IS NULL`, and the upsert clears the tombstone, so registering a
removed id again revives the row rather than silently landing on an invisible
one.

Deletion is soft because a deletion is itself a governed act: an auditor asking
"you told us in March you had eleven AI systems, why do we see ten?" needs the
eleventh to still exist, with its trail. A hard delete answers that with silence.
**A deleted system takes its dependents out of view with it, and gives them back
on revival.** `readWorkspace` drops the use cases, assessments, risks and
findings that name a system no longer in the live set, and strips the dead id
from the `appliesToSystemIds` and `linkedSystemIds` arrays so a claim on a
removed system stops counting toward coverage.

It is done there, in one place, rather than in each read — every page reaches
its data through that function, and six filtered queries would be six chances to
miss one.

**Derived, never written down the tree.** The upsert clears the *system's*
tombstone, and nothing would clear a tombstone on each use case and claim: a
revived system would come back with no dependents at all, which is a worse
answer than the shallow delete this replaces. Computing visibility from the
parent is symmetric for free and needed no migration.

Two rules go with it. A **null `systemId` is org-level, not an orphan** — a rule
that dropped those would empty the risk register on the first deletion while
looking like it was working. And an **applicability row belongs to a control**,
so a deletion removes the claim, never the control's applicability decision.

`ai_risk`'s own dependents are not cascaded — that is a second question with the
same shape, and it is still open. Nothing in the product deletes anything yet:
`deleteAiSystem` and `deleteAiRisk` have no route and no UI, so this is the rule
waiting for the affordance rather than a behaviour you can reach on screen.

`version` is optimistic concurrency and **opt-in**: pass `expectedVersion` and a
save that would overwrite somebody else's edit throws
`ConcurrentModificationError`; omit it and last-write-wins, which is the right
default for the seed and for an import. It is deliberately **not** a snapshot
table — `ai_activity_event` already holds field-level before/after for every
change, so prior states are reconstructed from the trail, and a version table
beside it would be a second source for the same facts.

### `src/lib/rate-limit.ts`

Per-organization spend caps on the routes that cost money. Auth controls *who*
calls; this controls *how often*. Fails open, since a limiter that takes the app
down when Redis blips is a worse trade. Nothing calls it today; it is kept
because the guard is the cheap half and writing it after the bill is the
expensive one.

## Frameworks

### The registry is data, not a module

A framework, its clause tree and its controls are rows — `ai_framework`,
`ai_framework_node`, `ai_control` — seeded per organization and read through
`readFrameworks()`. There is no module enumerating the standards, which is the
point: adding one is a seed, not a release.

`readWorkspace({ frameworkId })` resolves the id against the organization's own
frameworks and falls back to its first. A framework the tenant does not have is
therefore never partially rendered.

### What is framework-scoped and what is not

The Statement of Applicability is per framework: `ai_applicability` is keyed on
`(organization, framework, control)`, and that is where a control's decision,
justification and owner live.

Systems, use cases, risks, findings, evidence and policies are **not** — they are
the organization's, and the same evidence answers a clause in two standards
because that is what a management system is for. Coverage is derived from the
join, never stored.

### Navigation

The sidebar is grouped Discover / Govern / Go to market / Settings.

**Groups must stay contiguous in `NAV`.** The heading is emitted whenever the
group differs from the previous row, so one entry inserted mid-list prints its
heading twice — a bug this file has already shipped once.

Frameworks get one entry rather than one per standard: `/frameworks` resolves
whichever the organization has in scope and redirects, so a second standard is a
row of data and never touches `sidebar.tsx`. An organization with none gets an
empty state rather than a redirect loop.

Every page in `(app)` resolves its own tenant and carries
`export const dynamic = "force-dynamic"`. The layout catches the common
unauthenticated case early but is not the gate, and a session-dependent page
served from the cache is one tenant's registers shown to another — which fails
silently, with a clean build.

## Where the numbers come from

### `src/lib/ams/` — derived on read, every time

`readiness.ts` computes coverage and readiness, `risk-scale.ts` the 5×5 ratings
and residual, `predicate.ts` which assessment questions apply. All of them take
the workspace as their **first** argument, for exactly the reason the accessors
take `organizationId` first: it makes summarising the wrong tenant's data a type
error rather than a number that looks plausible.

None of it is stored, so there is no invalidation to get wrong. Residual risk in
particular has no column — inherent likelihood and impact are the human
judgement, and the reduction comes from the controls actually mapped and actually
in place. A register that lets someone type "residual: low" disagrees with
reality the moment a control lapses. Mitigation caps at 75%: controls reduce
risk, they do not abolish it.

`tone.ts` owns the bands and the status colours. Never re-derive a threshold or
pick a status colour inside a component.

## Prompts and errors

No feature calls a model today. The AI management system's drafting
affordances are present but disabled — see `_ams/ai-action.tsx` for why they are shown rather
than hidden. What survives is the plumbing every one of them needed, kept because
the guard is the cheap half:

**One description of the organization, shared.** Whatever renders the org for a
prompt must be written once and reused. Two prompts describing the same tenant
differently is how a copilot ends up contradicting the register it is quoting.
The deleted `org-context.ts` was that module; its replacement builds from the
workspace, and it is one module or the problem comes back.

**Honesty over impressiveness, in the prompt itself.** The old assessment was
told to score the evidence rather than the intentions, and the copilot that
overclaiming was its one unacceptable failure.

### `src/lib/ai-errors.ts`

`describeAiError()` maps any thrown value to a status and a message a user can act
on. A missing key, an exhausted balance and a rate limit each read differently;
that is what this file is for.

`src/lib/anthropic.ts` holds the shared client, `MODEL`, `FALLBACK_BETA` and
`FILES_BETA`.
