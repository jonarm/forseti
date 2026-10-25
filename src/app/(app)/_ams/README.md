# The AI management system

The screens of the AI governance product. They began as `/playground`, a
navigable mockup rendered from typed fixtures and shown to prospects before any
of it reached the database; that mockup was approved and became the specification
for what is here. Most of this document is still the record of what each screen
is *for* and why it is shaped the way it is — that argument did not change when
the data did.

**What changed:** every screen now reads one organisation's own rows through
`readWorkspace()` in `src/lib/ai-store.ts`. Pages resolve the tenant with
`amsPage()` and carry `export const dynamic = "force-dynamic"`; the fixtures in
`src/lib/ams/fixtures/` are now the *seed* rather than the source, so the demo
organisation still shows exactly the figures this document describes.

**What is not built yet.** Most interactions hold local state and do not write
back — the exceptions are listed at the foot of this file, and the whole
inventory is now among them. The audit pack is a preview; it writes no PDF.

**Drafting is real now.** The SoA justification writer, the assessment field
assist and the questionnaire copilot call `/api/ai/draft-*`, and the suggestion
card's decision posts to `/api/suggestions`. Those four read `usePermissions()` and render
disabled carrying the same sentence the route would return, as do the system
profile's editors and the inventory's Register and Import buttons. Everything
else stays open, because gating a control that persists nothing would be a claim
the code cannot keep.

## Running it

```bash
npm run db:migrate && npm run seed   # once
npm run dev                          # http://localhost:3000/overview
```

Sign in as the demo user — the screens are behind the tenant boundary now, so
there is nothing to see signed out.

**Do not run `npm run build` or `npx tsc` against a live dev server.** Both
rewrite files the dev watcher is watching — `.next/` and
`tsconfig.tsbuildinfo` — and the result is a fast-refresh reload roughly once a
second. Every reload resets the local state that is the entire point of these
screens, so filters snap back and buttons look dead. It presents as a broken
mockup and is nothing of the sort. Measured: with no build running, the dev
server logs nothing over ten seconds; with one running, eight React mounts in
eight seconds.

For a demo in front of someone, prefer `npm start` anyway — no watcher, no
recompile pause on first navigation.

## Routes

| Route | Status | What it demonstrates |
|---|---|---|
| `/overview` | built | The readiness dashboard. Landing screen. |
| `/inventory` | built | The register. Fifteen systems, search, four filters, sortable columns, an empty state, and the import flow below. |
| `/inventory/[systemId]` | built | Nine tabs over one record, with a fixed identity header. A row added during the session has no profile to render — it says so rather than 404ing. |
| `/use-cases/[useCaseId]` | built | A use case as its own object: own risk tier, own oversight, own assessment, own URL. |
| `/intake` | built | The governance queue — twelve requests across every state, filters, and ageing against the service level. |
| `/intake/new` | built | The requester's five-step wizard. Step 3 comes from the chosen origin. |
| `/intake/[requestId]` | built | Triage, override and decision for one request. |
| `/frameworks/[frameworkId]` | built | Clause tree beside the editable SoA, with the AI justification writer and an export preview. Serves `/frameworks/iso-42001`. |
| `/assessments` | built | The assessment register — five records, sorted by due date, showing who each is waiting on. |
| `/assessments/[assessmentId]` | built | The impact assessment, rendered entirely from a template config. |
| `/risks` | built | The risk register, ordered by residual, with who accepted the residue. |
| `/risks/[riskId]` | built | Inherent → treatment → residual, a 5×5 matrix, and the controls the treatment rests on. |
| `/findings` | built | Findings with their source, ordered by overdue then due date. |
| `/findings/[findingId]` | built | Root cause → corrective action → verification → closure, with the closure gate. |
| `/trust-center` | built | One page, two audiences, with the boundary between them stated rather than applied silently. |
| `/questionnaires` | built | Inbound questionnaires from customers, prospects and insurers. |
| `/questionnaires/[questionnaireId]` | built | The copilot: answers drafted from the registers, with provenance and the right to refuse. |
| `/audit-pack` | built | The bundle handed over at a certification audit, with a pre-flight list of what an auditor will find in it. |
| `/evidence` | built | The evidence register, sorted by expiry, with a dependants column. |
| `/evidence/[evidenceId]` | built | One document and everything resting on it — including which controls have nothing else. |

All of these are in the `(app)` group and behind `requireOrgContext()`.

## What screen 1 actually proves

- **Import plans before it applies.** Drop a real CSV or `.xlsx` → the file is
  identified by its bytes and parsed server-side → an editable column mapping,
  pre-filled with a guess → confirm. Nothing is written until the last click,
  and nothing about the file is stored anywhere but the open dialog.
- **Validation is a function of the mapping, not a fixture.** Repoint a dropdown
  and every warning recomputes. Column-level problems ("no column is mapped to
  origin") surface once in a banner; row-level problems sit on their row.
- **Errors and warnings are different promises.** An error means we would be
  inventing the record, so the row is held back and cannot be forced in — a
  blank name, or a duplicate of a system already in the register. A warning
  states the default it would write, and you decide.
- **The register grows.** Confirming appends the rows, marks them *New*, and the
  header counts recompute. Registering a system by hand does the same through a
  Zod-validated form.
- **Origin is a first-class column and filter**, because it selects the question
  set a system answers downstream — not because it is a nice badge.
- **Two rows were found, not declared** (`discoveredVia: "sso_logs" |
  "expense_report"`), marked *Found*. The long tail of shadow AI is the reason
  the inventory exists.

## What screen 2 proves

- **A use case is an object, not a description.** M365 Copilot has four, and
  they are not equally risky: meeting summarisation is Limited, search across
  our own content is High, because search is the one with no review step between
  the model and the reader. Each has its own page.
- **Coverage is derived, never stored.** There is no `isoCoverage` field on
  `AISystem` — deliberately, and the type says why. The figure comes from
  `coverageForSystem()`, which counts applicable controls claimed against that
  system that carry evidence *for it*. A document attached to another system does
  not count, which is what makes the column vary: 78% for the Copilot estate, 29%
  for TalentScreen, 0% for the three tools found in expense reports and SSO logs.
- **The nine tabs are the order a review asks its questions in**: what is it,
  what is it used for, has it been assessed, what could go wrong, what are we
  doing about it, what proves it, what is already broken, who changed what.
- **Every change is attributable.** The Activity tab shows actor, action,
  before → after and timestamp — and where a change came from an accepted AI
  suggestion it says so *and* still names the person who accepted it.

## What screen 3 proves

- **Origin selects the question set.** Step 3 renders `QUESTION_SETS[origin]`.
  Procured SaaS asks about contract, DPA and whether the vendor trains on your
  data; API integration asks about prompt logging, retention and redaction;
  internal model asks about training data, rights and who may retrain. Same
  wizard, same route, same submission record — no branch in the component names
  a question.
- **Triage rules are data.** Each is a `Predicate` in `TRIAGE_RULES`, evaluated
  by the same `evaluate()` the assessment template uses. That is what lets the
  panel print the rules that fired in plain language instead of asserting a
  verdict. Escalating rules carry an amber marker; context-only rules are grey
  and say so.
- **The override demands a justification.** Changing the recommendation reveals a
  required field, and "Record decision" stays disabled until it holds a
  sentence. The override is the most interesting record in the system — it is
  the evidence the rules are wrong.
- **A request is its own object, not an inventory row in waiting.** A rejected
  request never becomes an `AISystem` — two of the twelve fixtures were refused
  and produced nothing. `IntakeRequest.createdSystemId` is the only link, and it
  is null unless a decision created a row.
- **The recommendation is recomputed on every view**, never stored. Open a
  request decided last year and you see what the rules say today beside what the
  reviewer chose. A frozen recommendation would hide the fact that the rules have
  since changed.
- **The example submission fires five rules** — three escalating, two context —
  and lands on Governance endorsement. Use "Fill with an example" to reach the
  triage panel in one click during a demo.

## What screen 4 proves

- **Applicability is a join, and the screen is that join filtered to one
  framework.** Add ISO 27001 and it is a second set of rows over the same
  controls with their own answers — no restructuring, which is the payoff for
  having refused to hang these fields on the control.
- **The consumption-only posture arrives already argued.** Eight development
  controls (A.6.1.2, A.6.2.2–4, A.7.2–5) are pre-marked not applicable with a
  justification that *names the exception* — the demand forecasting model built
  in house — rather than claiming the organisation builds nothing. A blanket
  exclusion is the lie an auditor finds in four minutes.
- **An exclusion demands prose, and the model will draft it.** Change an
  applicability and a suggestion appears in the same card used by intake triage
  and the assessment assist. Accepting writes the text into the field; rejecting
  leaves it exactly as you left it.
- **Changing applicability moves the implementation status with it**, in both
  directions. A control marked N/A that still claims to be "in progress", or one
  made applicable again still reading "N/A", are the two ways an SoA contradicts
  itself on the page.
- **The export preview shows the working state**, session edits included, and
  lists the not-applied controls first because those are what get sampled. It
  flags any exclusion missing a justification rather than quietly omitting it.

## What screen 5 proves

- **The renderer names no question.** It walks `IMPACT_TEMPLATE.sections`,
  evaluates `showIf` against the answer map, and hands each field to
  `FieldRenderer` to switch on its type. Check it:
  `grep -E 'informs_decisions_about_people|oversight_level|intended_use' src/app/(app)/_ams/assessment-renderer.tsx`
  returns nothing. Seeding answers from the use case *does* need field ids, so
  that lives in `seedAnswers()` in the fixture layer where naming a field is the
  job.
- **Section-level conditionals work.** Answering "does this system inform
  decisions about individual people" with yes takes the rail from 10 sections to
  11 — a whole fairness and adverse-impact section, not one extra field. The
  section states why it appeared, naming the answer that revealed it, which is
  only possible because predicates are data.
- **Conditionals nest.** Inside fairness, selecting a protected or vulnerable
  group reveals the disparity-testing question and the section's required count
  goes 3 → 4.
- **Origin-scoped sections.** Technology readiness only appears for
  `internal_model` systems, so one template serves all three workflows.
- **Completion counts only what is visible.** A hidden section's required fields
  are not outstanding work; counting them would leave every assessment
  permanently incomplete for questions nobody was asked.
- **The sticky footer carries the three-stage sign-off** — owner submits,
  governance lead endorses, approver accepts residual risk — and only the
  assignee for the current stage can move it. Everyone else sees who it is
  waiting on. The *viewing as* switcher in the header exists so a demo can show
  all three views of one document; in the real product it is just who you are.

## How sign-off actually happens

**In the platform, by the assignee.** Email and Teams notifications exist to
bring somebody to the page — the footer says who is being notified and how —
but the act of signing off happens here. Accepting residual risk in particular
cannot be done from a notification, and the bar says so: an approve button in an
inbox is a mechanism for approving without reading, and the third signature is
worth something only if the person opened the document.

Four rules follow, all of them visible:

- **Either reviewer can send it back**, with a mandatory reason. An endorser
  whose only options are "endorse" or "do nothing" picks doing nothing, and the
  assessment sits. Sending back returns it to the owner and discards every
  review given.
- **A submitted document is frozen** — for the owner too. It renders as prose
  rather than disabled inputs, because a reviewer reading a submitted assessment
  is reading a document.
- **Withdrawing reopens it without discarding reviews.** Resetting an approval
  because someone fixed a typo teaches owners not to fix typos.
- **A material change resets the reviews.** `material: true` marks fields whose
  value decides which sections exist. Change one after an endorsement and it
  resets, with a notice naming the question — because the endorser reviewed a
  document with a different set of questions in it.

Deferred and worth building later: **delegation** when an approver is away for
three weeks (recorded as a delegate, never as the approver), and **reminders
with escalation** on an ageing stage.

## What screen 6 proves

- **The headline is the strict number.** A control counts as ready only when it
  is applicable, implemented **and** carrying evidence that is verified and
  current. That gives 39%, against 56% "marked implemented" — and the panel says
  outright that 7 controls are claimed but could not be proven today. The gap is
  the most useful figure in the product; a dashboard reporting the flattering
  number is worse than none, because it gets trusted.
- **Nothing is stored.** Every figure comes from `readiness.ts`, derived from the
  same fixtures the other screens render. Expire a document and the headline
  moves without anyone editing a number.
- **The attention list is capped at 12** and states what it is not showing,
  grouped by kind. Thirty-two rows is a backlog, and a backlog gets scrolled
  past — but hiding the remainder silently would be the actual sin.
- **Breakdowns by clause and Annex A area**, plus policy, evidence and system
  posture, and the inventory summarised by origin and risk tier.
- **Every figure drills in.** A number you cannot click is a poster. The SoA and
  the inventory read their filters from the URL, so the dashboard links straight
  into the rows behind a count — and a filtered view is a link you can paste to
  a colleague.

### Drill-down URLs

| From | Lands on |
|---|---|
| "7 controls … could not be proven" | `/frameworks/iso-42001?lens=unproven` |
| A clause or Annex A row | `…?node=n-5` |
| "N of M controls excluded" | `…?lens=excluded` |
| Controls citing no policy | `…?lens=no-policy` |
| Expired evidence | `…?lens=expired-evidence` |
| Found rather than declared | `/inventory?discovered=1` |
| A risk tier or origin bar | `/inventory?risk=high`, `?origin=internal_model` |

The lens definitions live in `soa-workbench.tsx` and the counts in
`readiness.ts` call the same predicates, so the figure and the filtered list can
never disagree. A zero is never a link — a clickable zero landing on an empty
table is a small betrayal every time.

## Group two — evidence register

The first of the second group, built because three screens were already
pointing at it.

- **A document is not interesting; what rests on it is.** The record's largest
  block is the controls citing it, split by whether they have anything else.
  `evidenceDependants()` computes it, and the register carries the same figure
  as a column: `2 (2 alone)`.
- **That produces the sentence the register exists to write.** On the Microsoft
  DPA: *"Expires in 233 days. 2 controls rest on this alone and will stop being
  evidenced on that date unless it is renewed."* Nothing else in the product can
  say that, because nothing else holds the reverse links.
- **Sorted by expiry, not by name.** Everything else here degrades when somebody
  does something wrong. Evidence degrades when nobody does anything at all, so
  it needs a screen that comes looking for you.
- **Verification is a human act with a name against it.** An unverified document
  does not count toward readiness; verifying it records who and when. An expired
  one cannot be re-verified — it has to be replaced.
- **Real artefacts are attached.** Six of the fourteen records carry a file in
  `public/evidence/` — three PDFs (governance forum minutes, a data
  processing agreement, a DPIA) rendered in an inline viewer, and three text
  artefacts (a tenant config export, a routing override log, an inventory
  export) shown as a clipped preview. Static assets, not fetches: the boundary
  holds.
- **Eight records deliberately have no file**, and that state gets its own
  amber panel rather than an empty box. Somebody wrote down that proof exists
  and never attached it — the register looks complete and the audit finds
  nothing. Filter it with `?lens=no-file`.
- **Wired in from everywhere it was already referenced**: the SoA control detail,
  the system profile's Evidence tab, and the dashboard's evidence panel, whose
  three counts now link to `?lens=expired`, `?lens=expiring` and
  `?lens=unverified`.

## Group two — risk register

- **Ordered by residual, not inherent.** Inherent is what a risk would be if
  nobody did anything, which is useful exactly once — when you decide what to
  do. Residual is what you are actually carrying, and a register sorted by
  inherent puts the well-treated risks at the top.
- **Who accepted the residue is a column.** Every risk has an owner, because
  owners are easy. Four have no acceptor — matching the open internal audit
  finding in the fixtures, and the honest state of most registers: treatment
  gets done and nobody senior signs for what is left. Filter with
  `?lens=unaccepted`.
- **The treatment is checked against the controls it names.** A residual rating
  is a claim that certain controls work, so the record resolves each one: is it
  implemented, does it carry usable evidence? TalentScreen's adverse-impact risk
  rests on two controls, both *in progress* — which makes its residual an
  estimate resting on an estimate, and the record says so.
- **A treatment that has not moved the number is called out.** Two risks score
  identically before and after; that is either a treatment not working or one
  not yet done, and both are worth a sentence rather than two matching numbers.
- **The record is editable, because a read-only register is maintained
  somewhere else.** Re-rate the residual by clicking a matrix cell; change the
  treatment, status, owner and summary in place.
- **Accepting the residual is its own act, and re-rating voids it.** Treatment
  is the owner's job; accepting what remains belongs to somebody senior enough
  to carry it. Move the residual after an acceptance and the signature is
  voided with a notice naming who accepted what — the same rule as a material
  change on an assessment, for the same reason: a signature belongs to the
  number it was given against.
- **The 5×5 matrix is deliberately restrained.** The conventional risk heat map
  paints all twenty-five cells green-to-red, which introduces a second colour
  language into a product that already has one and leaves nothing standing out
  because everything is coloured. Here the cells carry a faint band tint from
  the existing `ok`/`warn`/`critical` tokens, both positions are labelled chips,
  and every cell shows its score — a monochrome print still reads correctly.

## Group two — assessment register

The sidebar used to link at one hard-coded assessment, which made five records
look like a single sample. `/assessments` is the register: sorted by
due date with overdue first, and its load-bearing column is **waiting on** —
status tells you a document is in progress, which everyone knew; the assignee
tells you why it is not moving. Completion is computed by walking the template
with the same `showIf` evaluation the renderer uses, so the register and the
form can never disagree.

## Group two — findings

- **Source is a first-class field, not a sentence in the summary.** Seven
  sources: self-identified, internal audit, incident, external audit, regulator,
  customer, supplier review. The fixtures carry a certification body's stage 1
  finding (`external_audit`), two internal audit findings, a customer due
  diligence finding, an incident reported through the speak-up channel, and
  three found by our own monitoring.
- **The mix is the point.** Seven of nine were found before anyone outside
  asked — the ratio a certification body reads as evidence the management system
  is running rather than being run at. A register where everything came from an
  external auditor is itself a nonconformity against the internal audit and
  monitoring clauses, and that can only be spotted if source is countable.
  Filter with `?source=external`.
- **Closure is gated, not a dropdown value.** `canClose()` requires a root
  cause, a corrective action, and a **dated verification by somebody other than
  the owner**. The button stays down and names which of the four is missing. Set
  the verifier to the owner and it refuses: *"Verified by the person who owns
  it. Verification has to be somebody else, or it is a self-assessment."*
- **Root cause is asked for separately from the corrective action**, with the
  prompt "why it happened, not what happened" — a corrective action written
  against a symptom fixes the symptom.

## Everything is audited

Decision 5 says every screen with state shows actor, action, before → after and
timestamp. The registers were recording *decisions* — who accepted, who verified
— but a decision is not a history: editing a residual, reassigning an owner or
rewriting a corrective action all move the record and none of them is a
decision.

`useActivityLog()` closes that. Risk, finding and evidence records each carry an
Activity panel seeded from the fixtures and appended to live, through the same
`ActivityPanel` the system profile uses.

The rule that keeps it readable: **record commits, not keystrokes.** A select
fires on change, because choosing is the commit. A textarea fires on blur,
comparing against what it held on focus, via `TrackedTextarea`. Long prose is
clipped in the before → after chips. A log with one entry per character is a log
nobody opens twice.

Worth watching: re-rating a residual writes two entries — the re-rating, and the
voiding of the acceptance attached to the old figure.

## Group two — audit evidence pack

The screen that proves the registers connect, because it is assembled from all
of them.

- **It opens by telling you what is wrong with it.** `preflight()` reads the same
  registers the pack is built from and reports what a competent auditor will
  find — split into **blockers** (an exclusion nobody argued, a system no control
  covers, a finding closed by the person who fixed it) and **weaknesses**
  (expired evidence still cited, high-risk systems unassessed, elevated residual
  risk nobody accepted). Every item links to the record that fixes it.
- **That is a deliberate inversion.** Most generators produce a document that
  looks complete, because looking complete is what a generator does — and the
  organisation meets the holes in the room, with the auditor. A pack that lists
  its own weaknesses is less impressive and changes what happens in the audit.
- **A pack is a snapshot**, dated and covering a period. Regenerating tomorrow
  legitimately produces a different pack, which is why the cover carries a date
  rather than pretending to be standing.
- **Contents are selectable, and required sections cannot be dropped.** Turning
  the policy set off takes it out of the preview and drops the estimate from ~60
  pages to ~42. A pack missing the Statement of Applicability is not a pack an
  audit can start from.

## Group two — questionnaire copilot

The pain is already in the fixtures: the Northwind finding records eleven working
days to answer an AI due diligence questionnaire against a five-day contractual
commitment, because the information existed but not in one place.

- **Provenance is the product, not the prose.** Any model writes a confident
  paragraph about AI governance. What makes an answer sendable is knowing which
  control, policy and document it came from — so every answer carries its
  citations inline, each marked sound or not, with the oldest evidence date
  beside them.
- **Confidence is derived, never authored.** `confidenceFrom()` reads the state
  of the cited records: an implemented control with current evidence raises it, a
  draft policy or an expired document lowers it. Drafting all eight Northwind
  questions produces a genuine spread — 90%, 74%, 58%, 42% — rather than eight
  identical numbers.
- **An unsound citation is shown, not dropped.** Question 4.1 cites the
  TalentScreen DPIA, which expired on 30 July, and says so in the words you would
  use handing it over: *"If they ask for proof, this is what we would hand
  over."* Quietly omitting it to make the answer look better is the failure.
- **Refusing is a legitimate output.** Two of the eight have nothing behind them.
  Asked about ISO 42001 certification, the copilot declines: stage 1 is done,
  stage 2 is blocked on an open finding, and *"drafting anything more affirmative
  than the plain fact would be a false statement in writing to a customer."* Same
  for the incident question, where the procedure is still a draft.
- **Answers are kept.** An answer sent to a customer is a commitment, and next
  year the first question is what we told them last time. 

## Group two — trust centre

One page, two readers. Internally it answers the question that otherwise arrives
as a Teams message twenty times a week — *may I use this tool, and what may I put
into it?* Externally it answers what a buyer's legal team asks before signing.

- **The audience boundary is data, not a render-time filter.** Every entry
  declares its audience. The internal view *marks* what a customer would not see
  and says why; the external view states how many items are withheld. A page that
  quietly shows less when shared is the one somebody eventually sends by mistake,
  so the switcher is the loudest control on the page.
- **The readiness percentage is internal, deliberately.** Publishing "39% ready"
  is worse than publishing nothing — a score without its definition invites
  comparison against numbers computed a different way, and ours is strict.
  Externally we publish the posture: which standard, where we are in certifying,
  and what we commit to. Checkable claims; a score is not.
- **Every published line is a claim that could be shown false.** "We take AI
  safety seriously" commits to nothing and is therefore not there. "No supplier
  trains on your data under our enterprise agreements" can be checked against a
  contract.
- **The approved list is derived from the inventory**, not maintained twice. A
  trust centre kept as its own document is wrong within a month; withdrawing a
  tool in the inventory withdraws it here.

## Shape of the types

`src/lib/ams/types.ts` is the argument; read it before the components.
Four decisions are encoded in the types rather than in any screen:

1. **`AISystem` and `AIUseCase` are separate objects**, each use case with its
   own risk tier and oversight. One system, many use cases.
2. **`origin` selects a question set**, keyed in `QuestionSets` — same workflow,
   different questions.
3. **`ControlApplicability` is a join** on (frameworkId, controlId). That join
   *is* the Statement of Applicability; the fields are not on the control.
4. **One `AiSuggestion` type and one `ActivityEvent` type**, so "AI proposes,
   humans dispose" and the audit trail read as product decisions rather than as
   three coincidences.

`Predicate` in `types.ts` and `evaluate()` in `predicate.ts` are shared by the
assessment template's conditional display and the intake triage rules. Both are
data, so both screens can *show* the rule that fired instead of asserting it.

**There is no `officialText` field, deliberately.** ISO copyrights its standards
and we cannot redistribute clause text. Controls carry `officialRef` (a citation,
which is a fact) plus our own `shortTitle`, `requirementSummary` and
`evidenceGuidance`, written as original prose. A close paraphrase of a clause is
still the clause — do not add one.

## State

Reads come from Postgres. **Three areas now persist; the rest do not.**

- **The risk record — all of it.** Title, treatment, treatment summary, status,
  owner, re-rating the residual and accepting it all go through `/api/risks`.
  Selects save on change because choosing is the commit; the summary saves on
  blur, because a save per keystroke is a version bump per keystroke and the next
  tab open would 409 against a row that moved forty times while nobody read it.
  Accepting demands a reason and names the person accepting, from a picker:
  `acting-person.ts` forbids guessing a person from an account — the crossing is
  a claim recorded in `ai_account_person`, never an inference — and an acceptance
  nobody can be held to is not an acceptance. **`accepted` is therefore disabled
  in the status dropdown**, visible so its absence does not read as a bug, with
  the acceptance block below as the way in. Re-rating voids the acceptance *in
  the store*, so the rule holds however the row arrives; moving the status away
  from accepted does not, because the number that was accepted has not changed.
  Every save sends `expectedVersion` and shows the 409 when somebody else was
  faster.
- **The system profile's Overview tab.** Every field is an editor that commits on
  its own — a select on change, a text field on blur — through
  `/api/systems/[systemId]`. No form and no Save button, because the register is
  corrected a fact at a time by somebody fixing the one thing they noticed, and a
  form would make that person responsible for the whole screen at once. `system`
  is its own statement, held by the platform admin, the governance lead and the
  system owner and deliberately not the reviewer: a reviewer says what is wrong
  with a system, not what the system is.

- **The reviewer panel** on an assessment — `/api/review-assignments`, naming who
  is accountable for each stage. Assignment and sign-off are a split rather than a
  duplicate: this records *who should* review, `signOff[]` records where the chain
  has got to. One names an account and the other an `ai_person`, and
  `ai_account_person` now maps between them — so each row shows which person the
  assigned account signs as, and says plainly when an account has no person and
  the chain therefore cannot recognise it. That is a reading, not a gate:
  advancing the chain is still local state, and gating it on identity would be a
  claim the code cannot keep.

- **The inventory**, every way a row arrives, changes or leaves:
  - `PATCH /api/systems/:id` — a correction on the profile.
  - `POST /api/systems` — the register form. The body is the eight answers the
    form collects, never an `AISystem`: lifecycle, risk tier and assessment
    status are decided server-side, so nobody can register a system that arrives
    already approved.
  - `POST /api/systems/import` — applying an import. The body is the rows and
    the mapping, and the route re-runs `planImport()` — the same function the
    preview ran — against this organisation's register as it stands *now*,
    writing what still passes and naming what it refused. There is no
    transaction: `saveAiSystem` writes and audits per row, so the response
    reports each row rather than implying an all-or-nothing the store does not
    provide.

  Both create paths mint the id server-side, because `saveAiSystem` upserts and a
  caller-chosen id is a caller who can overwrite a row by naming it. Validation
  lives in `lib/ams/import-plan.ts` and takes the known world as a parameter —
  it used to read the demo fixtures, which meant every tenant's spreadsheet was
  checked against Meridian Analytics' systems and people.

  - `POST /api/systems/import/parse` — reading the uploaded file, and the one
    route in the import that writes nothing. It gates on the same
    `system: ["create"]` the apply checks, then runs the sequence anything
    reading an upload has to: `sniff()` identifies the file by its magic bytes,
    `inspectZip()` checks an `.xlsx` for a declared bomb before exceljs sees it,
    and the parse runs under a wall-clock timeout. A file over 500 rows or 60
    columns is **refused by name and count**, never truncated — half an import
    reported as a whole one is the worst thing this feature could do. Blank
    headers are named for their column letter and repeats are numbered, because
    an `ImportRawRow` is a flat object and two "Notes" columns would otherwise
    collapse into one with nobody told. The bytes are discarded when the
    response is written.

  - `POST /api/systems/delete` — the inventory's tick boxes, and the only way
    to reach it. One route for one system and for forty, because a single row is
    a selection of one and two write paths for one operation is the second
    permission gate somebody forgets. It checks `system: ["delete"]` — its own
    statement, which a tenant can pull apart from `create` in `/settings/roles`,
    which is why `uiPermissions()` carries `deleteSystems` separately from
    `registerSystems`. The delete is soft: `deletedAt` is set and the row stays
    on disk with its trail, because "who removed this system, and when" is the
    question an auditor asks about a register that used to be longer. Its use
    cases, risks and applicability claims go out of view with it and none of
    them gets a tombstone, which is what lets registering the same system again
    bring the whole tree back.

  - `POST /api/systems/export` — the register as a CSV or a workbook. A route
    rather than a Blob in the browser for one reason: **the export is the
    auditable act**. Every row is already on the client, so building the file
    there would be faster and would leave no trace at all; instead `writeAudit`
    records the format, the row count and the column labels against
    `subjectKind: "organization"`, with `before` null because nothing changed.
    It checks `system: ["export"]`, a statement every shipped role holds —
    including `auditor`, whose one statement this is, because an auditor who
    cannot take the register away has to transcribe it. It is a statement all
    the same so a tenant can revoke it in `/settings/roles`.

    The client sends the ids it means and the route trusts none of them: "what
    is on screen" is a search, four filters and a tick selection, and
    re-deriving that server-side would duplicate the predicate in
    `inventory-table.tsx`. So the ids are intersected with the caller's own
    register, and an id belonging to another tenant simply is not in it. A
    workspace that reads back empty against a non-empty request is answered
    with a 503 rather than a spreadsheet in which every coverage figure is 0% —
    the store degrades to empty arrays rather than throwing, and a file of
    plausible zeroes is worse than an error.

    Columns live once, in `lib/ams/inventory-export.ts`: the dialog's picker
    reads the ids and labels, the CSV, XLSX and print writers read the
    resolvers. The file follows catalogue order rather than the order somebody
    ticked, so two months' exports can be diffed.

    **PDF is the browser's, not ours.** `format: "pdf"` returns a standalone
    print-styled HTML document that calls `window.print()` on its own `load`;
    the dialog writes it into a hidden same-origin iframe, so there is no popup
    to be blocked and the print dialog opens over the inventory. Generating a
    real PDF would mean a library whose font data is a known failure mode under
    a serverless bundler — a runtime failure in the environment hardest to test
    — and every reader already has a PDF writer in their browser. Because the
    document is same-origin, **every value goes through `escapeHtml`**: a
    `<script>` in a vendor name would otherwise run with our cookies, and there
    is a test for exactly that.

  - `POST /api/systems/restore` — the trash view's undo. Checks
    `role: ["update"]`, the platform admin's statement, rather than the
    `system: ["create"]` the argument alone would pick: the trash view is
    restricted while the retention window is new, and a route left on `create`
    would let a governance lead who knew an id restore through the API what the
    screen will not show them. Nothing needs restoring down the tree — clearing
    the parent's tombstone is the whole restore, which is why the delete never
    wrote tombstones downward.
  - `GET /api/cron/purge-trash` — the nightly job, and **the only handler in the
    product with no tenant behind it**. `requireCronRequest()` checks a shared
    secret instead of a session and refuses outright when `CRON_SECRET` is
    unset, so a misconfigured deployment stops emptying its trash rather than
    exposing a delete endpoint. `route-guards.test.ts` knows about exactly that
    one function and asserts nothing outside `cron/` uses it. The enumeration of
    organisations is the one deliberately cross-tenant read in the store; the
    deletes themselves are org-scoped calls in a loop, because a single global
    `DELETE ... WHERE deleted_at <` is one missing clause from emptying a tenant
    that was never in scope.

  **The trash is restricted to the platform admin for now.** `viewTrash` is
  derived from `role: ["update"]` — held by `platform_admin` alone and excluded
  from `EDITABLE_RESOURCES`, so no tenant can grant it to anybody else. The
  One flag gates the page, the Restore button and the restore route, because a
  restriction the screen enforces and the route does not is a list of ids away
  from being no restriction at all. The
  inventory hides the Trash button rather than disabling it, which is the one
  deliberate exception to this directory's "refused means disabled and
  explained" rule: a disabled button advertises that records are being destroyed
  on a schedule to exactly the roles not being shown that yet. The page calls
  `notFound()` on its own, because a hidden link has never been a permission.
  Widening it is one line in `uiPermissions()` and a test that fails first.

  `/inventory/trash` is its own page rather than a filter on the register — a
  removed system that can still be sorted and counted beside live ones is a
  register reporting the wrong number to whoever glances at it. The retention
  window and the countdown live in `lib/ams/trash.ts` beside the other
  thresholds, and `daysLeft` is derived per request from `deletedAt`, never
  stored. The purge takes what the soft delete already hid: use cases,
  applicability claims and assessments cascade at the foreign key, and risks and
  findings — which have no constraint to cascade through — are removed
  explicitly. **The audit trail is untouched and must stay that way**; it is what
  makes a permanent delete defensible here, because "who removed this, and when"
  outlives the row it was about.

  The table's selection is held as ids and the *selected systems are derived*
  from the register, so the count in the bar and the list in the confirmation
  are the same list — a bar reading "8 selected" over a dialog naming three is
  how somebody deletes five systems they never saw. Selection survives a filter
  change (the bar says so when part of it is out of view), and the tick boxes
  stay live for a caller who cannot delete: selection is unpersisted local
  state, and the refusal belongs on the write.

  The mapping the parse route returns is a *guess* (`guessMapping()`), and the
  dialog owns it from the moment it renders — a header read wrong costs a
  dropdown, not a record. The guesser is deliberately not taught the sample
  file's phrasing: "How we got it" stays unmapped, which is what gives anyone
  watching a reason to touch the dropdowns at all.

  **A sheet that arrived as one long column per row is split back out.** Real
  `.xlsx` files turn up holding a CSV — every row's text in column A, because
  Excel opened a comma file under a semicolon locale or somebody pasted it in.
  The parser was right that such a sheet has one column and being right was
  useless: the mapping screen reported no column mapped to system name while
  the headers sat in plain view. `resplitSingleColumn()` only runs when every
  row is empty past the first cell, only accepts a delimiter that splits
  essentially every row, and refuses if the split changes the row count. A
  genuine one-column list of tool names passes through untouched.

  `fixtures/import.ts` is now a *file* rather than a shortcut. `sampleCsv()`
  serialises it and the "try a sample" link uploads it through the same route,
  so the demo cannot pass while the parser is broken. Next to it,
  `inventoryTemplateCsv()` hands over a blank file in our own headers — built
  from `TARGET_FIELDS` in the browser rather than served from `/public`, so it
  cannot list a column we no longer read. It is offered *alongside* the mapping
  screen, never instead of it: a template that implied "re-type your inventory
  into our headers first" would be arguing with the whole feature.

Everything else — editing an SoA row, working a finding, the SoA workbench — is
still local React state: real on the screen and gone on refresh. That is a slice
boundary rather than a design decision.
