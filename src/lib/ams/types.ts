/**
 * The domain model of the AI management system.
 *
 * This file is the argument. Four decisions are encoded in the *shape* of these
 * types rather than in any screen, and a convenience that flattens one of them
 * is the failure this file is written to prevent:
 *
 *   1. An AI System and an AI Use Case are separate objects, joined many to
 *      many. `AIUseCase` is its own record with its own `riskTier` and its own
 *      oversight, not a string array on the system: one tool serves many
 *      purposes, and one purpose is often served by several tools. Each is
 *      independently risky, which is the whole reason neither collapses into
 *      the other.
 *   2. `origin` selects a question set, not a screen. `QuestionSets` is keyed on
 *      it, so intake and assessment ask different things off one code path.
 *   3. Applicability is a join. `ControlApplicability` is keyed on
 *      (frameworkId, controlId) and lives in its own table — that join *is* the
 *      Statement of Applicability. The temptation, while only ISO 42001 has
 *      content, is to hang `applicability` on the control. Do not: a second
 *      framework then needs a second control.
 *   4. AI proposes, humans dispose. One `AiSuggestion` type carries the
 *      recommendation, its reasoning, the data behind it, a confidence and the
 *      human decision — used identically by intake triage, the SoA and the
 *      assessment assist, so the pattern reads as a product decision.
 *
 * And one prohibition: there is no `officialText` field anywhere, deliberately.
 * ISO copyrights its clause text and we cannot redistribute it. A control
 * carries `officialRef` (a citation, which is a fact) plus our own `shortTitle`
 * and `requirementSummary` — original prose describing what our product asks
 * you to demonstrate. A close paraphrase of the clause is still the clause.
 */

import type { AuditSubjectKind } from "@/lib/audit";

/* ------------------------------------------------------------------ people */

export interface Person {
  id: string;
  name: string;
  /** Job title, shown wherever a name alone would be ambiguous. */
  role: string;
  businessUnit: string;
}

/* -------------------------------------------------------------- ai systems */

/**
 * Where the system came from — the single field that decides which question
 * set the org has to answer about it.
 *
 * A procured SaaS tool raises vendor and configuration questions; an API
 * integration raises token handling, retention and prompt-logging questions;
 * an internal model raises training-data, evaluation and drift questions. Same
 * app, same workflow, different questions.
 */
export type SystemOrigin = "procured_saas" | "api_integration" | "internal_model";

export type LifecycleStage =
  | "proposed"
  | "poc"
  | "pilot"
  | "production"
  | "deprecated"
  | "retired";

export type RiskTier = "minimal" | "limited" | "high" | "unacceptable";

export type AssessmentStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "endorsed"
  | "approved"
  | "overdue";

/** What the system actually does, in capability terms. Drives which controls apply. */
export type AiCharacteristic =
  | "generative"
  | "predictive"
  | "vision"
  | "nlp"
  | "agentic"
  | "recommendation";

export type DataCategory =
  | "public"
  | "internal"
  | "confidential"
  | "personal"
  | "special_category"
  | "financial"
  | "health"
  | "customer_content"
  | "source_code";

export type DeploymentModel =
  | "vendor_multi_tenant"
  | "vendor_dedicated"
  | "private_cloud"
  | "on_premise"
  | "hybrid";

export interface VendorDetail {
  name: string;
  /** Sub-processors and model providers the vendor itself relies on. */
  subProcessors: string[];
  modelProvider: string | null;
  contractType: "enterprise_agreement" | "click_through" | "trial" | "internal";
  dataProcessingAgreement: boolean;
  /** The vendor's own certifications, as claimed. Claimed, not verified — the UI says so. */
  certifications: string[];
  trainsOnCustomerData: boolean;
  renewalDate: string | null;
}

export interface AISystem {
  id: string;
  name: string;
  vendor: string;
  origin: SystemOrigin;
  /** Kept apart from `characteristics` because it is the field everyone filters on. */
  isGenAi: boolean;
  businessUnit: string;
  ownerId: string;
  lifecycleStage: LifecycleStage;
  riskTier: RiskTier;
  assessmentStatus: AssessmentStatus;
  /*
   * There is deliberately no `isoCoverage` field.
   *
   * Coverage is the share of applicable controls claimed against this system
   * that carry evidence, and that lives in the `ControlApplicability` join.
   * Storing it here as well gives two sources for one number, and they drift
   * the moment a control loses its evidence — which is precisely when the
   * figure matters. Derive it with `coverageForSystem()`.
   */
  purpose: string;
  deploymentModel: DeploymentModel;
  /** Where it runs and where the data comes to rest — two different answers. */
  hostingRegions: string[];
  dataResidency: string;
  userGroups: string[];
  approxUsers: number;
  dataCategories: DataCategory[];
  characteristics: AiCharacteristic[];
  vendorDetail: VendorDetail;
  registeredAt: string;
  nextReviewDate: string;
  /** Set when the row arrived through discovery rather than registration. */
  discoveredVia: "manual" | "import" | "sso_logs" | "expense_report" | null;
  /**
   * Bumped by the store on every write, and the handle for optimistic
   * concurrency: read it, pass it back as `expectedVersion`, and a save that
   * would silently overwrite somebody else's edit is refused instead.
   *
   * Optional because it belongs to a stored row and the fixtures are not stored
   * rows. A record that never went through the database has no version, and
   * inventing one for it would make a fixture look like something it is not.
   */
  version?: number;
}

/**
 * A system in the trash: the record, plus when it left the register.
 *
 * The two removal fields are not on `AISystem` because a live system does not
 * have them, and an optional field is how a screen ends up rendering "removed
 * by nobody" for a row that was never removed. `deletedBy` is a Better Auth
 * user id — the account that made the request — and needs resolving to a name
 * before it is shown, exactly like an `Actor`.
 *
 * There is no `purgeDueAt` here on purpose. It is `deletedAt` plus the
 * retention window and is derived wherever it is displayed.
 */
export interface DeletedAISystem extends AISystem {
  /** ISO timestamp. Never null — a row without one is not in the trash. */
  deletedAt: string;
  deletedBy: string | null;
}

/* --------------------------------------------------------------- use cases */

export type OversightLevel =
  | "human_in_the_loop"
  | "human_on_the_loop"
  | "human_in_command"
  | "none";

/**
 * Where a use case is in its own life, which is not where its system is.
 *
 * A production system routinely carries a proposed use case, and a retired use
 * case rarely retires the tool it ran on. Named rather than inline so `labels.ts`
 * can key its vocabulary off the type instead of restating the union.
 */
export type UseCaseStatus = "active" | "piloting" | "proposed" | "retired";

/**
 * What is true of one pairing and not of the purpose in general.
 *
 * Sparse on purpose: a pairing appears here only when something about it
 * genuinely differs from the use case's own answer. An entry for every pairing
 * would be filled in by copying the baseline, and two places holding one fact
 * is how a register comes to disagree with itself.
 *
 * Read through `effectiveTier` / `effectiveOversight` on the `Workspace` rather
 * than directly — the whole point is that a caller asking "how risky is this"
 * has to say which system it means.
 */
export interface UseCaseSystemOverride {
  systemId: string;
  /** Null where this pairing does not differ from the use case's own tier. */
  riskTier: RiskTier | null;
  oversightLevel: OversightLevel | null;
  oversightSummary: string | null;
}

export interface AIUseCase {
  id: string;
  /**
   * The systems that implement this purpose. At least one, often several.
   *
   * Hydrated from `ai_use_case_system` on read, the way `Evidence` hydrates its
   * own links, rather than stored on the record where the two could disagree.
   * The order is the join's — nothing reads it as a ranking, and there is no
   * "primary" system: a purpose served by three tools is served by three tools.
   */
  systemIds: string[];
  /**
   * The pairings that differ from the answers below, if any.
   *
   * Not a second copy of `systemIds` — a projection of the same join rows,
   * carrying only the ones with something to say. Most use cases have none.
   */
  systemOverrides: UseCaseSystemOverride[];
  name: string;
  description: string;
  businessUnit: string;
  ownerId: string;
  /**
   * Its own tier. A limited-risk system can carry a high-risk use case; that is
   * the point.
   *
   * **This is the baseline.** It is the tier of the *purpose*, and it stands for
   * every system implementing it unless that pairing says otherwise in
   * `systemOverrides`. Ask `effectiveTier(useCaseId, systemId)` when the answer
   * has to be about a particular tool; read this field directly only when the
   * question really is about the purpose in general.
   */
  riskTier: RiskTier;
  oversightLevel: OversightLevel;
  oversightSummary: string;
  /** The two answers that carry most of the regulatory weight. */
  facesCustomers: boolean;
  informsDecisionsAboutPeople: boolean;
  dataCategories: DataCategory[];
  approxUsers: number;
  status: UseCaseStatus;
  /**
   * The assessment covering this use case, or none.
   *
   * Derived on read — it lives on the assessment, and joining it back here
   * rather than storing it is what stops the two disagreeing about which
   * assessment covers what.
   */
  assessmentId: string | null;
  /** See `AISystem.version`. Optional for the same reason. */
  version?: number;
}

/** A use case in the trash. See `DeletedAISystem` for why these fields are here. */
export interface DeletedUseCase extends AIUseCase {
  deletedAt: string;
  deletedBy: string | null;
}

/* -------------------------------------------------------------- frameworks */

export interface Framework {
  id: string;
  name: string;
  shortName: string;
  /** Our summary of what the standard is for. Ours, not theirs. */
  description: string;
  version: string;
}

export type ClauseKind = "management_clause" | "annex_a";

export interface FrameworkNode {
  id: string;
  frameworkId: string;
  /** The citation, e.g. "A.6.2.4" or "6.1.2". A reference is a fact, not copyrightable prose. */
  officialRef: string;
  parentId: string | null;
  kind: ClauseKind;
  /** Ours. */
  shortTitle: string;
}

export interface FrameworkControl {
  id: string;
  frameworkId: string;
  nodeId: string;
  officialRef: string;
  /** Our title for the control. Never the standard's. */
  shortTitle: string;
  /** Our paraphrase of what has to be demonstrated, written as a product instruction. */
  requirementSummary: string;
  /** What we would accept as proof — our guidance, and the reason the control is actionable. */
  evidenceGuidance: string;
  /** Marks controls that only bite if you build models yourself. Drives the consumption-only posture. */
  developmentOnly: boolean;
}

/* --------------------------------------------- statement of applicability */

export type Applicability = "yes" | "no" | "na";

export type ImplementationStatus =
  | "not_started"
  | "planned"
  | "in_progress"
  | "implemented"
  | "not_applicable";

/**
 * The join that is the Statement of Applicability.
 *
 * Keyed on (frameworkId, controlId): the same control assessed against a second
 * standard is a second row with its own justification and its own owner. Fold
 * these fields onto `FrameworkControl` and the second framework has nowhere to
 * put a different answer.
 */
export interface ControlApplicability {
  frameworkId: string;
  controlId: string;
  applicability: Applicability;
  /** Mandatory in the real product whenever applicability is "no" or "na". */
  justification: string;
  implementationStatus: ImplementationStatus;
  ownerId: string | null;
  linkedPolicyId: string | null;
  linkedEvidenceIds: string[];
  /** Systems the control has been claimed against, so coverage is answerable per system. */
  appliesToSystemIds: string[];
  lastReviewedAt: string | null;
}

/* ---------------------------------------------------------------- support */

export interface Policy {
  id: string;
  title: string;
  status: "draft" | "in_review" | "approved" | "expired";
  ownerId: string;
  version: string;
  approvedAt: string | null;
  nextReviewDate: string;
  summary: string;
}

export type EvidenceType =
  | "policy"
  | "screenshot"
  | "configuration_export"
  | "meeting_minutes"
  | "contract"
  | "test_result"
  | "training_record"
  | "log_extract";

/**
 * The actual artefact behind an evidence record.
 *
 * Separate from `Evidence` and nullable, because the distinction matters: a
 * record with no file is somebody having written down that proof exists without
 * attaching it. That is the most common way an evidence register rots, and it
 * is invisible unless the model can represent it.
 *
 * `preview` carries the first lines of a text artefact so the record can show
 * what it is without a network call — the mockup renders from fixtures, and a
 * PDF gets an inline viewer off the static file instead.
 */
export interface EvidenceFileRef {
  name: string;
  /** Drives how the record previews it. */
  kind: "pdf" | "text" | "image";
  mime: string;
  sizeKb: number;
  /** Served from /public. Static asset, not an API call. */
  href: string;
  pages?: number;
  preview?: string;
}

export interface Evidence {
  id: string;
  title: string;
  type: EvidenceType;
  ownerId: string;
  source: string;
  collectedAt: string;
  expiresAt: string | null;
  verificationState: "unverified" | "verified" | "expired" | "rejected";
  linkedControlIds: string[];
  linkedSystemIds: string[];
  /** Null when somebody recorded that proof exists but never attached it. */
  file: EvidenceFileRef | null;
}

/**
 * How a finding and a risk are connected.
 *
 * Three kinds, because they are genuinely different claims and collapsing them
 * loses the useful one:
 *
 *   - `revealed` — the finding is why the risk is in the register at all.
 *     Something was found, and the register grew to name what it could lead to.
 *   - `materialised` — the risk happened. The finding is the instance, and the
 *     residual rating was optimistic by exactly one occurrence.
 *   - `undermines` — the finding says the risk's *treatment* is not holding.
 *     This is the one worth modelling: a residual rating is a claim that certain
 *     controls work, and an open finding against one of those controls is
 *     direct evidence against the number. Without this link the register keeps
 *     reporting a treated risk while the thing treating it is broken.
 */
export type FindingRiskKind = "revealed" | "materialised" | "undermines";

/**
 * The join between findings and risks.
 *
 * A join rather than an array on either record, for the same reason
 * applicability is a join: the relationship carries its own meaning. Hanging
 * `relatedRiskIds` on a finding would lose the kind, and putting it on both
 * would give two places to disagree.
 */
export interface FindingRiskLink {
  findingId: string;
  riskId: string;
  kind: FindingRiskKind;
  /** Why these two are connected, in a sentence somebody can disagree with. */
  note: string;
}

/**
 * Where a finding came from.
 *
 * A first-class field rather than a sentence in the summary, because the mix is
 * a maturity signal in its own right. A register where everything was raised by
 * an external auditor is a management system that never finds its own problems —
 * which is a finding about the management system, and one the dashboard can only
 * make if this is a field it can count.
 */
export type FindingSource =
  | "internal_audit"
  | "external_audit"
  | "self_identified"
  | "incident"
  | "regulator"
  | "customer"
  | "supplier_review";

/**
 * A finding: something that is already wrong, and the record of putting it right.
 *
 * Distinct from a risk, which is something that might happen. They close
 * differently, and that difference is the shape of this type: a risk is treated
 * and its residual accepted, while a finding needs a root cause, a corrective
 * action, and a **dated verification by somebody other than the owner** before
 * anyone may mark it closed.
 *
 * That last constraint is the one worth enforcing. A finding closed by the
 * person who fixed it is a self-assessment, and an auditor sampling closed
 * findings is looking for exactly that.
 */
export interface Finding {
  id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "corrective_action" | "verification" | "closed";
  source: FindingSource;
  /** The audit reference or the person who raised it — what you would cite. */
  raisedBy: string;
  raisedAt: string;
  dueAt: string;
  ownerId: string;
  systemId: string | null;
  controlId: string | null;
  summary: string;
  /** Why it happened, not what happened. Null until somebody has worked it out. */
  rootCause: string | null;
  correctiveAction: string | null;
  /** Verification is a separate act by a separate person. Null blocks closure. */
  verifiedById: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  closedAt: string | null;
}

export interface Risk {
  id: string;
  title: string;
  systemId: string | null;
  useCaseId: string | null;
  controlIds: string[];
  inherentLikelihood: 1 | 2 | 3 | 4 | 5;
  inherentImpact: 1 | 2 | 3 | 4 | 5;
  treatment: "mitigate" | "accept" | "transfer" | "avoid";
  treatmentSummary: string;
  residualLikelihood: 1 | 2 | 3 | 4 | 5;
  residualImpact: 1 | 2 | 3 | 4 | 5;
  ownerId: string;
  status: "open" | "treated" | "accepted" | "closed";
  /**
   * Who accepted what remains after treatment.
   *
   * Separate from `ownerId` because they are different acts by different
   * people: the owner runs the treatment, somebody senior enough to carry the
   * consequence accepts the residue. A register where every risk is "owned"
   * and none is *accepted* is the state most organisations are actually in —
   * and it is an open finding here rather than a gap in the model.
   */
  acceptedById: string | null;
  acceptedAt: string | null;
  /** See `AISystem.version`. Optional for the same reason. */
  version?: number;
}

/**
 * A risk in the trash: the record, plus when it left the register.
 *
 * The removal fields are not on `Risk` for the reason they are not on
 * `AISystem` — a live risk does not have them, and an optional field is how a
 * screen ends up rendering "removed by nobody" for a row that was never
 * removed. `deletedBy` is a Better Auth user id and needs resolving to a name
 * before it is shown.
 */
export interface DeletedRisk extends Risk {
  /** ISO timestamp. Never null — a row without one is not in the trash. */
  deletedAt: string;
  deletedBy: string | null;
}

/** A finding in the trash. See `DeletedAISystem` for why these fields are here. */
export interface DeletedFinding extends Finding {
  deletedAt: string;
  deletedBy: string | null;
}

/** A document in the trash. See `DeletedAISystem` for why these fields are here. */
export interface DeletedEvidence extends Evidence {
  deletedAt: string;
  deletedBy: string | null;
}

/* ------------------------------------------------------ review assignments */

/**
 * Who reviews this record at this stage.
 *
 * The answer to "Legal and Security are reviewers — are those roles?". They are
 * not: a role says who *may* approve, an assignment says who *is* approving
 * this. See `ai_review_assignment` in `schema.ts`.
 */
export interface ReviewAssignment {
  subjectKind: AuditSubjectKind;
  subjectId: string;
  /** legal | security | privacy | exec_sponsor | governance, and beyond. */
  stage: string;
  /** A Better Auth user id. Approving is an act, and acts need accounts. */
  assigneeUserId: string;
  assignedBy: string | null;
  assignedAt: string;
}

/* -------------------------------------------------- accounts and people */

/**
 * The claim that a signed-in account and a named person are the same human.
 *
 * The two id spaces stay separate — see `aiPerson` in `schema.ts` for why a
 * person need not have an account — and this is the only thing that crosses
 * between them. It carries no name and no role: those live on the `Person` it
 * points at, and a second copy here would be one more thing to keep in step.
 */
export interface AccountPerson {
  /** A Better Auth user id. */
  userId: string;
  /** An `ai_person` id in the same organization. */
  personId: string;
  /** The account that made the claim, where one is recorded. */
  linkedBy: string | null;
  linkedAt: string;
}

/* ---------------------------------------------- AI proposes, humans dispose */

export type SuggestionStatus = "pending" | "accepted" | "edited" | "rejected";

/**
 * One suggestion type for every AI surface in the product.
 *
 * Three bespoke suggestion cards would make "AI proposes, humans dispose" read
 * as three coincidences instead of one product decision, so intake triage, the
 * SoA justification writer and the per-section assessment assist all render
 * this same record through the same card.
 *
 * `recommendation` is what *would* be written; nothing writes it until a person
 * accepts. `decidedById`/`decidedAt` are what turn a suggestion into a record.
 */
export interface AiSuggestion {
  id: string;
  /** Where it appears — the thing the recommendation would be written into. */
  target: { kind: "field" | "control" | "triage" | "section"; id: string };
  recommendation: string;
  /** Why, in prose a compliance lead can challenge. Never a chain of thought. */
  reasoning: string;
  /** The specific records it was drawn from, each one checkable. */
  supportingData: { label: string; detail: string; href?: string }[];
  /** 0–1. Rendered as a band plus the number, never a bare percentage. */
  confidence: number;
  status: SuggestionStatus;
  decidedById: string | null;
  decidedAt: string | null;
  /** Present once someone chose Edit — what they changed it to. */
  editedText: string | null;
}

/* -------------------------------------------------------------- audit trail */

/**
 * One event type, one panel component, every screen that holds state.
 *
 * `before`/`after` are rendered strings rather than typed values: an audit trail
 * is read, not recomputed, and a union of every field type it could describe
 * would be a type that means nothing.
 */
export interface ActivityEvent {
  id: string;
  /** What kind of thing `subjectId` names — see `AuditSubjectKind`. */
  subjectKind: AuditSubjectKind;
  /** Scope key — a system id, a control id, an assessment id, a user id. */
  subjectId: string;
  actorId: string;
  /** Past tense, plain language: "changed applicability", "approved policy". */
  action: string;
  field: string | null;
  before: string | null;
  after: string | null;
  /** Why, where the act was one somebody has to be able to defend. */
  reason: string | null;
  at: string;
  /** Set when the change originated in an accepted AI suggestion. */
  viaSuggestionId: string | null;
}

/* ------------------------------------------------------------------ intake */

export interface IntakeSubmission {
  name: string;
  description: string;
  businessUnit: string;
  origin: SystemOrigin | null;
  isGenAi: boolean | null;
  vendor: string;
  dataCategories: DataCategory[];
  facesCustomers: boolean | null;
  informsDecisionsAboutPeople: boolean | null;
  /** Answers to the origin-specific question set, keyed by field id. */
  originAnswers: Record<string, unknown>;
}

export type ReviewType = "endorsement" | "noting";

export type RequestStatus =
  | "awaiting_triage"
  | "awaiting_decision"
  | "needs_more_info"
  | "endorsed"
  | "noted"
  | "rejected";

/**
 * A request to use AI — its own object, not an inventory row in waiting.
 *
 * The tempting shortcut is to treat a pending request as an `AISystem` with
 * `lifecycleStage: "proposed"` and save a type. It is wrong in three ways, and
 * each one shows up in front of an auditor:
 *
 *   - A **rejected** request must never appear in the inventory. The inventory
 *     answers "what AI are we using"; something we refused is not something we
 *     use, and a register that lists it is answering a different question.
 *   - A request returned for more information has no confirmed owner or vendor,
 *     so it would drag an unownable row into every readiness figure.
 *   - The decision record — who decided, when, against which recommendation, and
 *     why they overrode it — has to survive independently of whatever inventory
 *     row it eventually produces, or gets orphaned when it produces none.
 *
 * `createdSystemId` is the join in the one direction that makes sense: null
 * until a decision creates an inventory row, and permanently null for anything
 * rejected.
 *
 * Note what is *not* stored: the triage result. It is derived from `submission`
 * by running the rules, for the same reason coverage is derived from the
 * applicability join — a stored recommendation goes stale the moment a rule
 * changes, and then nobody can tell whether an old decision was reasonable
 * under the rules of its day or not.
 */
export interface IntakeRequest {
  id: string;
  /** Human-facing reference. What people quote in an email. */
  reference: string;
  submission: IntakeSubmission;
  submittedById: string;
  submittedAt: string;
  status: RequestStatus;
  reviewerId: string;
  /** What the reviewer settled on. Null until someone has looked. */
  reviewType: ReviewType | null;
  /** Set only when the reviewer departed from the recommendation. */
  overrideJustification: string | null;
  decision: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  comments: string;
  createdSystemId: string | null;
}

/**
 * Something added to a request after the fact.
 *
 * **Append-only, and that is the whole point of it being its own record.** The
 * decision columns hold one decision and overwrite it on the next; a note is an
 * addition to the account rather than a revision of it, so there is no field
 * here for editing one and no route that could. Correcting a note means adding
 * another that says so — which is how a conversation works, and how a record of
 * one stays trustworthy.
 */
export interface IntakeNote {
  id: string;
  requestId: string;
  /** An `ai_person` id, or null for an account with nobody behind it. */
  authorId: string | null;
  body: string;
  /** ISO instant. Notes read oldest first, unlike the activity trail. */
  createdAt: string;
}

/** A request in the trash. See `DeletedAISystem` for why these fields are here. */
export interface DeletedIntakeRequest extends IntakeRequest {
  deletedAt: string;
  deletedBy: string | null;
}

/**
 * A triage rule, written so its `explain` string is what the reviewer reads.
 *
 * The rule is the product's argument for its own recommendation. A rule that
 * fires without a sentence explaining itself is a black box, which is the thing
 * this product is selling against.
 *
 * `when` is a `Predicate`, not a function — the same union the assessment
 * template uses for conditional display, evaluated by the same code. A rule
 * that is data can be listed, versioned and shown to an auditor as the reason
 * a submission was routed the way it was; a rule that is a closure can only be
 * read by opening the source.
 */
export interface TriageRule {
  id: string;
  /** Plain language, present tense: "touches special category personal data". */
  explain: string;
  /** What firing implies. Any escalating rule lifts the result to endorsement. */
  implies: ReviewType;
  when: Predicate;
}

export interface TriageResult {
  suggested: ReviewType;
  firedRuleIds: string[];
}

/* ------------------------------------------- origin-driven question sets */

export interface QuestionSetField {
  id: string;
  label: string;
  type: FieldType;
  help?: string;
  options?: FieldOption[];
  required?: boolean;
}

/** Keyed on origin — the mechanism that makes decision 2 real rather than a badge. */
export type QuestionSets = Record<
  SystemOrigin,
  { label: string; rationale: string; fields: QuestionSetField[] }
>;

/* --------------------------------------- config-driven assessment template */

export type FieldType =
  | "short_text"
  | "long_text"
  | "single_select"
  | "multi_select"
  | "boolean"
  | "number"
  | "date"
  | "person"
  | "scale"
  | "repeatable_rows";

export interface FieldOption {
  value: string;
  label: string;
  /** Shown under the option — the difference between a form and one people answer well. */
  help?: string;
}

/**
 * One predicate union, evaluated by one function, used by everything that
 * branches on an answer.
 *
 * Deliberately not a closure. Rules that are data can be stored, diffed,
 * versioned and — the point — *shown to the person they affect*: the intake
 * triage panel lists the rules that fired, and the assessment renderer can say
 * which answer revealed a section. A predicate that is a function can only be
 * read by opening the source, so neither screen could explain itself.
 *
 * `includesAny` is separate from `oneOf` because they ask different questions of
 * different shapes: `oneOf` tests one value against a list, `includesAny` tests
 * a multi-select array for overlap. Collapsing them means a multi-select rule
 * silently never fires.
 */
export type Predicate =
  | { fieldId: string; equals: unknown }
  | { fieldId: string; oneOf: unknown[] }
  | { fieldId: string; includesAny: unknown[] }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };

/** The same union, named for where it reads best. */
export type ShowIf = Predicate;

export interface TemplateField {
  id: string;
  label: string;
  type: FieldType;
  help?: string;
  placeholder?: string;
  options?: FieldOption[];
  required?: boolean;
  /** Column headings when `type` is "repeatable_rows". */
  columns?: { id: string; label: string; type: FieldType }[];
  showIf?: ShowIf;
  /** Renders the AI assist affordance against this field. */
  aiAssist?: boolean;
  /**
   * Changing this answer changes what the document asks.
   *
   * A material field is one whose value controls whether whole sections exist.
   * Changing it after somebody has reviewed the assessment means they reviewed a
   * different document, so any completed review has to reset — otherwise an
   * endorsement travels forward attached to questions the endorser never saw.
   */
  material?: boolean;
}

export interface TemplateSection {
  id: string;
  title: string;
  /** Why the section is asked — shown at the top, in our words. */
  intent: string;
  fields: TemplateField[];
  /**
   * Section-level conditional display. This is the one that has to work:
   * "informs decisions about people" = yes reveals the whole fairness and
   * adverse-impact section, not one extra field.
   */
  showIf?: ShowIf;
  /** Origin-scoped sections, so one template serves all three workflows. */
  origins?: SystemOrigin[];
}

export interface AssessmentTemplate {
  id: string;
  name: string;
  version: string;
  sections: TemplateSection[];
}

/** Every answer in one bag, keyed by field id. The renderer knows no field names. */
export type AnswerMap = Record<string, unknown>;

export type SignOffStage = "owner_submit" | "governance_endorse" | "approver_approve";

export interface SignOffStep {
  stage: SignOffStage;
  label: string;
  /** Who is accountable for the stage, resolved to a person in the fixtures. */
  assigneeId: string;
  state: "pending" | "current" | "complete";
  completedAt: string | null;
}

export interface AssessmentInstance {
  id: string;
  templateId: string;
  systemId: string;
  useCaseId: string | null;
  status: AssessmentStatus;
  answers: AnswerMap;
  signOff: SignOffStep[];
  updatedAt: string;
  dueAt: string;
}

/** An assessment in the trash. See `DeletedAISystem` for why these fields are here. */
export interface DeletedAssessment extends AssessmentInstance {
  deletedAt: string;
  deletedBy: string | null;
}

/* ------------------------------------------------------------------ import */

/** A row as parsed from the uploaded file — every cell a string, as a parser leaves it. */
export type ImportRawRow = Record<string, string>;

export interface ImportIssue {
  /** An error blocks the row; a warning lets it through with a default. */
  level: "error" | "warning";
  column: string;
  message: string;
}

export interface ImportRow {
  rowNumber: number;
  raw: ImportRawRow;
  issues: ImportIssue[];
  /** Cleared by the user when a row is genuinely a duplicate. */
  include: boolean;
}

/** Our field that a source column has been mapped onto. `null` means "do not import". */
export type ColumnMapping = Record<string, string | null>;

/* ------------------------------------------------------------ questionnaires */

export type RequesterType = "customer" | "prospect" | "insurer" | "regulator" | "partner";

/**
 * One question from an inbound questionnaire.
 *
 * The id arrays are not the answer — they are where the answer has to come
 * from. Keeping them on the question rather than on a stored answer is what
 * lets the copilot recompute confidence every time it is opened: the same
 * question asked next quarter draws on the same controls, and if one of them
 * has lost its evidence since, the answer that was safe to send in August is
 * not safe to send in November.
 */
export interface QuestionnaireQuestion {
  id: string;
  /** The requester's own numbering, which is what they will quote back. */
  number: string;
  text: string;
  controlIds: string[];
  policyIds: string[];
  evidenceIds: string[];
}

export interface Questionnaire {
  id: string;
  title: string;
  requester: string;
  requesterType: RequesterType;
  receivedAt: string;
  dueAt: string;
  ownerId: string;
  status: "not_started" | "in_progress" | "in_review" | "submitted";
  note: string;
  questions: QuestionnaireQuestion[];
}

/** A questionnaire in the trash. See `DeletedAISystem` for why these fields are here. */
export interface DeletedQuestionnaire extends Questionnaire {
  deletedAt: string;
  deletedBy: string | null;
}

/** A citation behind a drafted answer, resolved at the moment of drafting. */
export interface AnswerCitation {
  kind: "control" | "policy" | "evidence";
  id: string;
  label: string;
  /** What state it is in — an expired document cited as support is the problem. */
  detail: string;
  /** Whether this citation currently supports an answer or undermines it. */
  sound: boolean;
  href: string;
}

export interface DraftedAnswer {
  questionId: string;
  /** Null when the record does not support an answer and inventing one would be the failure. */
  text: string | null;
  /** Why there is no answer, when there is none. */
  refusal: string | null;
  citations: AnswerCitation[];
  confidence: number;
  /** The oldest verification date among the cited evidence. */
  lastVerified: string | null;
  /** Problems the sender should know about before this goes out. */
  caveats: string[];
}
