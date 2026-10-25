import {
  boolean,
  index,
  integer,
  jsonb,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth-schema";

/**
 * Forseti's schema.
 *
 * Two halves:
 *
 *   - `./auth-schema.ts` — Better Auth's tables (user, session, account,
 *     verification, organization, member, invitation, two_factor). Generated,
 *     never hand-edited, re-exported below so callers have one import.
 *   - This file — Forseti's own tables. Every one of them carries
 *     `organizationId`, which is the tenant boundary. `src/lib/ai-store.ts`
 *     filters on it in every query; nothing reads domain data without one.
 *
 * IDs are `text` throughout to match the string IDs Better Auth generates.
 */

export * from "./auth-schema";

/* ==========================================================================
 * The AI management system
 * ==========================================================================
 *
 * The product's tables — now the only ones. The `ai_` prefix is a fossil: it
 * existed to keep `risk`, `finding`, `evidence` and `assessment` apart from the
 * GDPR toolkit's tables of the same names, and those are gone. Dropping the
 * prefix is a rename of fifteen tables and every query that touches them, which
 * is its own migration and its own review, not a side effect of a deletion.
 * Until then the prefix means nothing; read past it.
 *
 * Every table carries `organizationId` and indexes it, **including the join
 * tables**, even though both sides already do. A join row is the one place a
 * cross-tenant link can be forged: pair org A's system with org B's control and
 * nothing else in the schema objects.
 *
 * **Every primary key here starts with `organizationId`, and that is load
 * bearing rather than tidy.** These ids are ours, not the database's, and the
 * demo seeds every organization from the same fixture file — so two tenants
 * genuinely hold a row called `sys-m365-copilot`. With `id` alone as the key,
 * the second organization to seed does not get its own row: its upsert matches
 * the first one and rewrites `organization_id`, and the first tenant's
 * inventory silently moves house. The join tables carry it for the same reason
 * one step further down — `ai_evidence_link` keyed on
 * `(evidence, kind, target)` alone lets one tenant's link suppress another's,
 * which reads later as evidence that simply went missing.
 */

/**
 * An AI system: the thing you procured or built.
 *
 * Deliberately **without** a coverage column. Coverage is the share of
 * applicable controls claimed against this system that carry usable evidence,
 * and it lives in `aiApplicabilitySystem` joined to `aiEvidenceLink`. Storing it
 * here would give two sources for one number, and they drift the moment a
 * document expires — which is exactly when the figure matters.
 *
 * `origin` is the load-bearing column. It selects which question set the system
 * answers at intake and which assessment sections apply, so it is indexed
 * alongside the tenant rather than treated as a display attribute.
 */
export const aiSystem = pgTable(
  "ai_system",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    vendor: text("vendor").notNull(),
    /** procured_saas | api_integration | internal_model */
    origin: text("origin").notNull(),
    /** Kept apart from `characteristics` because it is what everyone filters on. */
    isGenAi: boolean("is_gen_ai").notNull().default(false),
    businessUnit: text("business_unit").notNull(),
    ownerId: text("owner_id"),
    /** proposed | poc | pilot | production | deprecated | retired */
    lifecycleStage: text("lifecycle_stage").notNull().default("proposed"),
    /** minimal | limited | high | unacceptable */
    riskTier: text("risk_tier").notNull().default("minimal"),
    /** not_started | in_progress | submitted | endorsed | approved | overdue */
    assessmentStatus: text("assessment_status").notNull().default("not_started"),
    purpose: text("purpose").notNull().default(""),
    deploymentModel: text("deployment_model").notNull().default("vendor_multi_tenant"),
    hostingRegions: jsonb("hosting_regions").$type<string[]>().notNull().default([]),
    dataResidency: text("data_residency").notNull().default(""),
    userGroups: jsonb("user_groups").$type<string[]>().notNull().default([]),
    approxUsers: integer("approx_users").notNull().default(0),
    dataCategories: jsonb("data_categories").$type<string[]>().notNull().default([]),
    characteristics: jsonb("characteristics").$type<string[]>().notNull().default([]),
    /** Vendor detail travels as one object because it is only ever read whole. */
    vendorDetail: jsonb("vendor_detail").$type<Record<string, unknown>>(),
    registeredAt: text("registered_at").notNull(),
    nextReviewDate: text("next_review_date").notNull(),
    /** manual | import | sso_logs | expense_report — how the row arrived. */
    discoveredVia: text("discovered_via"),
    /**
     * Soft delete. **A row with `deletedAt` set is gone as far as every read is
     * concerned**, and `ai-store.ts` filters on it in every query.
     *
     * Removed rather than erased because a deletion is itself a governed act: an
     * auditor asking "you told us in March you had eleven AI systems, why do we
     * see ten?" needs the eleventh to still exist, with its trail, saying who
     * removed it and when. A hard delete answers that question with silence.
     *
     * `deletedBy` is a Better Auth user id, not an `ai_person` — the account that
     * made the request, not a name the record happened to carry.
     */
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
    /**
     * Bumped on every write. The primitive optimistic concurrency is built from:
     * a caller that read version 4 and saves against 4 is writing over what it
     * read, and one that saves against 4 when the row is at 5 is silently
     * discarding somebody else's edit.
     *
     * Deliberately **not** a snapshot of the row. `ai_activity_event` already
     * holds field-level before/after for every change, so prior states are
     * reconstructed from the trail; a version table beside it would be a second
     * source for the same facts, and the two would eventually disagree.
     */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_system_org_id_idx").on(table.organizationId, table.id),
    /* Every list read filters on `deleted_at IS NULL`, so it leads the index. */
    index("ai_system_org_live_idx").on(table.organizationId, table.deletedAt),
    index("ai_system_org_origin_idx").on(table.organizationId, table.origin),
    index("ai_system_org_risk_idx").on(table.organizationId, table.riskTier),
    index("ai_system_org_lifecycle_idx").on(table.organizationId, table.lifecycleStage),
  ],
);

/**
 * What a system is actually used for.
 *
 * Its own table rather than an array on the system, because risk lives here: one
 * licence can carry a use case that summarises your own meetings and another
 * that answers customers unsupervised, and they are not equally risky.
 * `informsDecisionsAboutPeople` is indexed because it is the question that pulls
 * a whole fairness section into an assessment and the one a regulator asks first.
 */
export const aiUseCase = pgTable(
  "ai_use_case",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    businessUnit: text("business_unit").notNull().default(""),
    ownerId: text("owner_id"),
    riskTier: text("risk_tier").notNull().default("minimal"),
    /** human_in_the_loop | human_on_the_loop | human_in_command | none */
    oversightLevel: text("oversight_level").notNull().default("human_in_the_loop"),
    oversightSummary: text("oversight_summary").notNull().default(""),
    facesCustomers: boolean("faces_customers").notNull().default(false),
    informsDecisionsAboutPeople: boolean("informs_decisions_about_people")
      .notNull()
      .default(false),
    dataCategories: jsonb("data_categories").$type<string[]>().notNull().default([]),
    approxUsers: integer("approx_users").notNull().default(0),
    /** active | piloting | proposed | retired */
    status: text("status").notNull().default("proposed"),
    /**
     * Soft delete, on the same terms as every other register. See `aiRisk` for
     * the argument in full.
     *
     * A use case had no tombstone for longer than its siblings because it was
     * only ever reachable through the system that owned it, and that system's
     * deletion took it by cascade. Neither half of that holds now: the relation
     * lives in `aiUseCaseSystem`, a use case can reach several systems, and
     * deleting one of them removes a link rather than the record. So the
     * tombstone is the only thing standing between "this purpose was retired"
     * and "this purpose was never here" — and "you told us in March this tool
     * did four things and we see three" is the question it has to answer.
     */
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
    /** See `aiSystem.version`. Bumped on every write, checked by the edit route. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_use_case_org_id_idx").on(table.organizationId, table.id),
    /* Every list read filters on `deleted_at IS NULL`, so it leads the index. */
    index("ai_use_case_org_live_idx").on(table.organizationId, table.deletedAt),
    index("ai_use_case_org_decisions_idx").on(
      table.organizationId,
      table.informsDecisionsAboutPeople,
    ),
  ],
);

/**
 * Which systems implement a use case.
 *
 * A use case is a business purpose, and a purpose is rarely served by exactly
 * one tool: meeting summarisation happens in M365 Copilot, in Zoom AI and in a
 * home-grown assistant, and it is one governed purpose in all three. The
 * relation ran the other way for most of this product's life — `system_id` on
 * the use case, not null — which said the opposite: that a purpose belongs to a
 * tool. It does not. The tool implements the purpose, and several can.
 *
 * A join rather than an array on either side, for the reason `aiEvidenceLink`
 * gives: the database records the relation once, so the two screens reading it
 * from opposite ends cannot disagree about what it says.
 *
 * **The join carries overrides, not a second copy.** Risk tier and oversight
 * genuinely belong to the *pair* where they differ, so they live here as
 * nullable columns read through the workspace's `effectiveTier` and
 * `effectiveOversight`. Null means the use case's own answer stands, which is
 * the usual case. Making them required would force a value for every pairing
 * and get one by copying — two places holding the same fact, drifting.
 *
 * Both foreign keys are composite with the organisation and both cascade. A
 * join row is the one place a cross-tenant pair can be forged, and knowing two
 * ids should not be enough to claim one tenant's use case against another's
 * system. The primary key is the uniqueness constraint: a use case reaches a
 * system once or not at all.
 *
 * There is no tombstone here. A link is not a record with a history; removing
 * one is `ai_use_case_system`'s whole story, and both parents already soft
 * delete. `readWorkspace` hides a link whose parent is gone, so a restored
 * system finds its use cases waiting.
 */
export const aiUseCaseSystem = pgTable(
  "ai_use_case_system",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    useCaseId: text("use_case_id").notNull(),
    systemId: text("system_id").notNull(),
    /*
     * What is true of *this* pairing and not of the purpose in general.
     *
     * Null is the ordinary answer and means "whatever the use case says". A
     * purpose does not usually change character with the tool doing it, and a
     * column that had to be filled in for every pairing would be filled in by
     * copying — which is how a register comes to hold the same number in two
     * places and disagree with itself later.
     *
     * They exist for the pairings where it genuinely differs. Summarising
     * meetings inside an enterprise tenant that never trains on the input is
     * not the same risk as doing it in a consumer chatbot, and the oversight is
     * whatever the tool actually implements rather than a property of the job.
     * `effectiveTier` and `effectiveOversight` on the workspace resolve the
     * override against the baseline; nothing should read these columns raw.
     */
    riskTier: text("risk_tier"),
    oversightLevel: text("oversight_level"),
    oversightSummary: text("oversight_summary"),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.useCaseId],
      foreignColumns: [aiUseCase.organizationId, aiUseCase.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.systemId],
      foreignColumns: [aiSystem.organizationId, aiSystem.id],
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.organizationId, table.useCaseId, table.systemId],
    }),
    /* The reverse lookup: every system profile asks which use cases reach it. */
    index("ai_use_case_system_org_system_idx").on(
      table.organizationId,
      table.systemId,
    ),
  ],
);

/**
 * A request to use AI — its own object, never an inventory row in waiting.
 *
 * A rejected request must not appear in the inventory: the inventory answers
 * "what AI are we using", and something we refused is not something we use.
 * `createdSystemId` is the join in the only direction that makes sense — null
 * until a decision creates a row, and permanently null for anything rejected.
 *
 * The triage result is deliberately **not** stored. It is recomputed from
 * `submission` every time the request is opened, so a rule changed since the
 * decision shows up against it rather than hiding behind a frozen verdict.
 */
export const aiIntakeRequest = pgTable(
  "ai_intake_request",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Human-facing reference. What people quote in an email. */
    reference: text("reference").notNull(),
    submission: jsonb("submission").$type<Record<string, unknown>>().notNull(),
    submittedById: text("submitted_by_id"),
    submittedAt: text("submitted_at").notNull(),
    /** awaiting_triage | awaiting_decision | needs_more_info | endorsed | noted | rejected */
    status: text("status").notNull().default("awaiting_decision"),
    reviewerId: text("reviewer_id"),
    /** endorsement | noting — what the reviewer settled on, null until they look. */
    reviewType: text("review_type"),
    overrideJustification: text("override_justification"),
    decision: text("decision"),
    decidedById: text("decided_by_id"),
    decidedAt: text("decided_at"),
    comments: text("comments").notNull().default(""),
    createdSystemId: text("created_system_id"),
    /**
     * Soft delete. **A row with `deletedAt` set is gone as far as every read is
     * concerned**, and `ai-store.ts` filters on it in every query.
     *
     * A request is somebody in the business asking permission, and the queue is
     * the record that they asked. Removing one has to leave that behind: "we
     * were never told about that tool" is the answer a deleted request would
     * otherwise make true, and shadow AI getting written down by whoever
     * notices it is the whole argument for having an intake queue at all.
     *
     * Note the reference stays reserved. `ai_intake_org_reference_idx` is
     * unique and does not forget a tombstoned row, which is deliberate — a
     * reference quoted in an email must not later belong to a different
     * request.
     *
     * `deletedBy` is a Better Auth user id, not an `ai_person`.
     */
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_intake_org_id_idx").on(table.organizationId, table.id),
    /* This organisation's requests that are still there. */
    index("ai_intake_org_live_idx").on(table.organizationId, table.deletedAt),
    index("ai_intake_org_status_idx").on(table.organizationId, table.status),
    uniqueIndex("ai_intake_org_reference_idx").on(table.organizationId, table.reference),
  ],
);

/**
 * What was said about a request after it was decided.
 *
 * **A separate table because it is append-only and the request is not.** The
 * decision columns on `ai_intake_request` hold exactly one decision — one
 * `comments`, one `decidedById`, one `decidedAt` — and recording a second
 * overwrites the first. That is correct for a decision, which is written once
 * and whose value is that it says what was concluded at the time. It is useless
 * for the thing people actually need afterwards: the DPA came back signed, the
 * vendor was acquired, the pilot was extended by a quarter. Those are additions
 * to the record, not revisions of it, and a column cannot hold both.
 *
 * So there is no `updatedAt` and no `deletedAt` here, and their absence is the
 * design rather than an omission. **A note is never edited and never removed.**
 * The alternative — letting somebody rewrite what they told a requester three
 * months ago — is the failure mode the whole intake record exists to prevent,
 * and it is worse here than on the submission: a submission is an account of a
 * system and can be wrong, while a note is an account of a conversation and
 * cannot be. Correcting one means adding another that says so.
 *
 * The foreign key is composite and cascades, which is what clears these when
 * `purgeExpiredIntakeRequests` finally deletes a request for real — the trash
 * retention window is the one thing that removes a note, and it removes the
 * request with it.
 *
 * `authorId` is an `ai_person`, nullable for the same reason `decidedById` is:
 * an account with no person behind it records nobody rather than a guess.
 */
export const aiIntakeNote = pgTable(
  "ai_intake_note",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    authorId: text("author_id"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.requestId],
      foreignColumns: [aiIntakeRequest.organizationId, aiIntakeRequest.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.organizationId, table.id] }),
    /* The only question ever asked of this table: what was added to this
     * request, oldest first. */
    index("ai_intake_note_org_request_idx").on(
      table.organizationId,
      table.requestId,
      table.createdAt,
    ),
  ],
);

/**
 * A standard the organization governs against.
 *
 * Rows are per organization rather than global, because an organization edits
 * its own copy — retitles a control, adds one of its own — and a shared library
 * would let one tenant's edit move another tenant's score. The seed writes the
 * ISO 42001 baseline per org for the same reason.
 */
export const aiFramework = pgTable(
  "ai_framework",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    /** Our summary of what the standard is for. Ours, not theirs. */
    description: text("description").notNull().default(""),
    version: text("version").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_framework_org_idx").on(table.organizationId),
  ],
);

/**
 * A clause or Annex A area — the tree the Statement of Applicability hangs off.
 *
 * Not in the original table list for this slice and added anyway: the approved
 * mockup navigates the SoA by clause, and a tree cannot be reconstructed from
 * the controls alone without inventing the grouping.
 */
export const aiFrameworkNode = pgTable(
  "ai_framework_node",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    frameworkId: text("framework_id").notNull(),
    /** The citation, e.g. "A.6.2.4". A reference is a fact, not copyrightable prose. */
    officialRef: text("official_ref").notNull(),
    parentId: text("parent_id"),
    /** management_clause | annex_a */
    kind: text("kind").notNull(),
    /** Ours. */
    shortTitle: text("short_title").notNull(),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_framework_node_org_fw_idx").on(table.organizationId, table.frameworkId),
  ],
);

/**
 * A control, in our words.
 *
 * There is deliberately **no `official_text` column**, and adding one is a
 * licensing problem rather than a schema preference. ISO copyrights its
 * standards and we cannot redistribute clause text. What we hold is
 * `officialRef` — a citation, which is a fact about where a requirement lives —
 * plus our own title, our own paraphrase of what has to be demonstrated, and our
 * own guidance on what would prove it. A close paraphrase of the clause is still
 * the clause.
 *
 * `developmentOnly` marks the controls that only bite on systems you build
 * yourself. It is what lets a consumption-only organisation arrive at a
 * defensible Statement of Applicability instead of justifying eighty controls
 * one at a time.
 */
export const aiControl = pgTable(
  "ai_control",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    frameworkId: text("framework_id").notNull(),
    nodeId: text("node_id").notNull(),
    officialRef: text("official_ref").notNull(),
    shortTitle: text("short_title").notNull(),
    requirementSummary: text("requirement_summary").notNull().default(""),
    evidenceGuidance: text("evidence_guidance").notNull().default(""),
    developmentOnly: boolean("development_only").notNull().default(false),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_control_org_fw_idx").on(table.organizationId, table.frameworkId),
    index("ai_control_org_node_idx").on(table.organizationId, table.nodeId),
  ],
);

/**
 * The Statement of Applicability, as a join.
 *
 * One row per (organization, framework, control). The primary key is what
 * enforces the modelling decision: applicability, justification, implementation
 * status and owner belong to the *pair*, not to the control. Add a second
 * framework tomorrow and the same control gets a second row with its own honest
 * answer — which genuinely differs, because a control out of scope for your AI
 * management system may be squarely in scope for your information security one.
 *
 * Folding these columns onto `aiControl` would force a second control record to
 * hold a second answer, and duplicated controls are how one answer diverges
 * across standards.
 */
export const aiApplicability = pgTable(
  "ai_applicability",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    frameworkId: text("framework_id").notNull(),
    controlId: text("control_id").notNull(),
    /** yes | no | na */
    applicability: text("applicability").notNull().default("yes"),
    /** Mandatory in the route whenever applicability is "no" or "na". */
    justification: text("justification").notNull().default(""),
    /** not_started | planned | in_progress | implemented | not_applicable */
    implementationStatus: text("implementation_status").notNull().default("not_started"),
    ownerId: text("owner_id"),
    linkedPolicyId: text("linked_policy_id"),
    lastReviewedAt: text("last_reviewed_at"),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.frameworkId, table.controlId],
    }),
    index("ai_applicability_org_fw_idx").on(table.organizationId, table.frameworkId),
    index("ai_applicability_org_status_idx").on(
      table.organizationId,
      table.implementationStatus,
    ),
  ],
);

/**
 * Which systems a control has been claimed against.
 *
 * The join that makes per-system coverage derivable instead of invented. Carries
 * `organizationId` for the usual reason: without it, knowing two ids is enough to
 * claim one tenant's control against another tenant's system.
 */
export const aiApplicabilitySystem = pgTable(
  "ai_applicability_system",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    frameworkId: text("framework_id").notNull(),
    controlId: text("control_id").notNull(),
    systemId: text("system_id")
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.systemId],
      foreignColumns: [aiSystem.organizationId, aiSystem.id],
    }).onDelete("cascade"),
    primaryKey({
      columns: [
        table.organizationId,
        table.frameworkId,
        table.controlId,
        table.systemId,
      ],
    }),
    index("ai_applicability_system_org_system_idx").on(
      table.organizationId,
      table.systemId,
    ),
  ],
);

/**
 * An impact assessment instance.
 *
 * The sign-off chain is stored as an ordered array rather than three columns
 * because it is only ever read and written whole, and because a fourth stage is
 * a template change rather than a migration.
 *
 * `answers` are **not** here — they are rows in `aiAssessmentAnswer`, one per
 * field. A jsonb blob would make "which assessments have not answered the
 * disparity question" an application-side scan of every record.
 */
export const aiAssessment = pgTable(
  "ai_assessment",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    templateId: text("template_id").notNull(),
    systemId: text("system_id")
      .notNull(),
    useCaseId: text("use_case_id"),
    /** not_started | in_progress | submitted | endorsed | approved | overdue */
    status: text("status").notNull().default("not_started"),
    signOff: jsonb("sign_off").$type<Record<string, unknown>[]>().notNull().default([]),
    dueAt: text("due_at").notNull(),
    /**
     * Soft delete. **A row with `deletedAt` set is gone as far as every read is
     * concerned**, and `ai-store.ts` filters on it in every query.
     *
     * An impact assessment is the record a regulator asks for by name, and the
     * one whose absence is hardest to explain: it carries the answers somebody
     * gave and the signatures somebody put against them. Removing it has to
     * leave the fact of its removal behind, or "we assessed that system in
     * February" and "there is no assessment" are both true and neither is
     * checkable.
     *
     * `deletedBy` is a Better Auth user id, not an `ai_person`.
     */
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.systemId],
      foreignColumns: [aiSystem.organizationId, aiSystem.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_assessment_org_id_idx").on(table.organizationId, table.id),
    /* This organisation's assessments that are still there. */
    index("ai_assessment_org_live_idx").on(table.organizationId, table.deletedAt),
    index("ai_assessment_org_system_idx").on(table.organizationId, table.systemId),
    index("ai_assessment_org_status_idx").on(table.organizationId, table.status),
  ],
);

/**
 * One answer to one template field.
 *
 * `value` is jsonb because the template's field types are genuinely
 * heterogeneous — a boolean, a multi-select array, a table of repeatable rows —
 * and flattening them to text would mean parsing on every read.
 */
export const aiAssessmentAnswer = pgTable(
  "ai_assessment_answer",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    assessmentId: text("assessment_id")
      .notNull(),
    fieldId: text("field_id").notNull(),
    value: jsonb("value"),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.assessmentId],
      foreignColumns: [aiAssessment.organizationId, aiAssessment.id],
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.organizationId, table.assessmentId, table.fieldId],
    }),
    index("ai_assessment_answer_org_field_idx").on(
      table.organizationId,
      table.fieldId,
    ),
  ],
);

/**
 * An AI risk: 5×5, inherent through treatment to residual.
 *
 * Residual is **stored**, not derived, and that is the opposite of the choice
 * made for coverage two tables up. The difference is that coverage is arithmetic
 * over records the system holds, while a treatment's effect on likelihood is a
 * human judgement no formula can reproduce. What the schema does enforce is that
 * it is a separate judgement from the inherent one.
 *
 * `acceptedById` is separate from `ownerId` because they are different acts by
 * different people: the owner runs the treatment, somebody senior enough to
 * carry the consequence accepts the residue. A register where every risk is
 * owned and none is accepted is the state most organisations are actually in.
 */
export const aiRisk = pgTable(
  "ai_risk",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    systemId: text("system_id"),
    useCaseId: text("use_case_id"),
    inherentLikelihood: integer("inherent_likelihood").notNull(),
    inherentImpact: integer("inherent_impact").notNull(),
    /** mitigate | accept | transfer | avoid */
    treatment: text("treatment").notNull().default("mitigate"),
    treatmentSummary: text("treatment_summary").notNull().default(""),
    residualLikelihood: integer("residual_likelihood").notNull(),
    residualImpact: integer("residual_impact").notNull(),
    ownerId: text("owner_id"),
    /** open | treated | accepted | closed */
    status: text("status").notNull().default("open"),
    acceptedById: text("accepted_by_id"),
    acceptedAt: text("accepted_at"),
    /**
     * Soft delete. **A row with `deletedAt` set is gone as far as every read is
     * concerned**, and `ai-store.ts` filters on it in every query.
     *
     * Removed rather than erased because a deletion is itself a governed act: an
     * auditor asking "you told us in March you had eleven AI systems, why do we
     * see ten?" needs the eleventh to still exist, with its trail, saying who
     * removed it and when. A hard delete answers that question with silence.
     *
     * `deletedBy` is a Better Auth user id, not an `ai_person` — the account that
     * made the request, not a name the record happened to carry.
     */
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
    /**
     * Bumped on every write. The primitive optimistic concurrency is built from:
     * a caller that read version 4 and saves against 4 is writing over what it
     * read, and one that saves against 4 when the row is at 5 is silently
     * discarding somebody else's edit.
     *
     * Deliberately **not** a snapshot of the row. `ai_activity_event` already
     * holds field-level before/after for every change, so prior states are
     * reconstructed from the trail; a version table beside it would be a second
     * source for the same facts, and the two would eventually disagree.
     */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_risk_org_id_idx").on(table.organizationId, table.id),
    index("ai_risk_org_live_idx").on(table.organizationId, table.deletedAt),
    index("ai_risk_org_status_idx").on(table.organizationId, table.status),
    index("ai_risk_org_system_idx").on(table.organizationId, table.systemId),
  ],
);

/** Which controls a risk's treatment rests on. */
export const aiRiskControl = pgTable(
  "ai_risk_control",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    riskId: text("risk_id")
      .notNull(),
    controlId: text("control_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.riskId],
      foreignColumns: [aiRisk.organizationId, aiRisk.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.organizationId, table.riskId, table.controlId] }),
    index("ai_risk_control_org_control_idx").on(table.organizationId, table.controlId),
  ],
);

/**
 * A finding: something already wrong, and the record of putting it right.
 *
 * `source` is a column rather than a sentence in the summary because the mix is
 * a maturity signal in its own right — a register where everything was raised by
 * an external auditor describes a management system that never finds its own
 * problems, and that can only be noticed if source is countable.
 *
 * The columns from `rootCause` down are the closure gate. A finding may only be
 * closed with a root cause, a corrective action, and a dated verification by
 * somebody **other than the owner**; the schema holds the fields and the store's
 * caller enforces the rule. `ai-store.ts` is the tenant boundary, not a policy
 * layer — a rule about what makes a record valid belongs above it.
 */
export const aiFinding = pgTable(
  "ai_finding",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** low | medium | high | critical */
    severity: text("severity").notNull().default("medium"),
    /** open | corrective_action | verification | closed */
    status: text("status").notNull().default("open"),
    /** internal_audit | external_audit | self_identified | incident | regulator | customer | supplier_review */
    source: text("source").notNull().default("self_identified"),
    /** The audit reference or the person who raised it — what you would cite. */
    raisedBy: text("raised_by").notNull().default(""),
    raisedAt: text("raised_at").notNull(),
    dueAt: text("due_at").notNull(),
    ownerId: text("owner_id"),
    systemId: text("system_id"),
    controlId: text("control_id"),
    summary: text("summary").notNull().default(""),
    rootCause: text("root_cause"),
    correctiveAction: text("corrective_action"),
    verifiedById: text("verified_by_id"),
    verifiedAt: text("verified_at"),
    verificationNote: text("verification_note"),
    closedAt: text("closed_at"),
    /**
     * Soft delete. **A row with `deletedAt` set is gone as far as every read is
     * concerned**, and `ai-store.ts` filters on it in every query.
     *
     * Removed rather than erased for the reason `ai_system` and `ai_risk` are:
     * a deletion is itself a governed act. "Our internal audit raised nine
     * findings in March and this register shows seven" is a question the
     * seventh and eighth have to still exist to answer — with their trail,
     * saying who removed them and when. A hard delete answers it with silence,
     * and a finding is the record most worth removing to make a register look
     * better.
     *
     * `deletedBy` is a Better Auth user id, not an `ai_person` — the account
     * that made the request, not a name the record happened to carry.
     */
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_finding_org_id_idx").on(table.organizationId, table.id),
    /* The register's own read: this organisation's findings that are still
     * there. Mirrors `ai_system_org_live_idx` and `ai_risk_org_live_idx`. */
    index("ai_finding_org_live_idx").on(table.organizationId, table.deletedAt),
    index("ai_finding_org_status_idx").on(table.organizationId, table.status),
    index("ai_finding_org_source_idx").on(table.organizationId, table.source),
    index("ai_finding_org_system_idx").on(table.organizationId, table.systemId),
  ],
);

/**
 * How a finding and a risk connect.
 *
 * A join with a `kind` rather than an array on either side, because the
 * relationship carries its own meaning. `undermines` is the one worth the table:
 * a residual rating is a claim that certain controls work, and an open finding
 * against one of those controls is direct evidence against the number. Without
 * somewhere to record that, the register keeps reporting a treated risk while
 * the thing treating it is broken.
 */
export const aiFindingRisk = pgTable(
  "ai_finding_risk",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    findingId: text("finding_id")
      .notNull(),
    riskId: text("risk_id")
      .notNull(),
    /** revealed | materialised | undermines */
    kind: text("kind").notNull(),
    note: text("note").notNull().default(""),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.findingId],
      foreignColumns: [aiFinding.organizationId, aiFinding.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.riskId],
      foreignColumns: [aiRisk.organizationId, aiRisk.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.organizationId, table.findingId, table.riskId] }),
    index("ai_finding_risk_org_risk_idx").on(table.organizationId, table.riskId),
  ],
);

/**
 * A document, and the record about it.
 *
 * `file` is nullable on purpose, and the null case is the interesting one: a
 * record with no attachment is somebody having written down that proof exists
 * without attaching it. That is the most common way an evidence register rots,
 * and it is invisible unless the schema can represent it.
 *
 * `verificationState` decides whether the document counts toward readiness at
 * all, so it is indexed with the tenant — every readiness figure filters on it.
 */
export const aiEvidence = pgTable(
  "ai_evidence",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** policy | screenshot | configuration_export | meeting_minutes | contract | test_result | training_record | log_extract */
    type: text("type").notNull().default("policy"),
    ownerId: text("owner_id"),
    source: text("source").notNull().default(""),
    collectedAt: text("collected_at").notNull(),
    expiresAt: text("expires_at"),
    /** unverified | verified | expired | rejected */
    verificationState: text("verification_state").notNull().default("unverified"),
    /** Null when the record claims proof exists and nothing is attached. */
    file: jsonb("file").$type<Record<string, unknown>>(),
    /**
     * Soft delete. **A row with `deletedAt` set is gone as far as every read is
     * concerned**, and `ai-store.ts` filters on it in every query.
     *
     * Removed rather than erased, and here the reason is sharper than for its
     * siblings: a piece of evidence is what a control's coverage *rests on*.
     * Deleting one silently lowers a score the organisation has reported, and
     * "why did our ISO 42001 coverage drop four points in April" is answerable
     * only if the document that left is still there to name. The trail says who
     * removed it; the row says what it was.
     *
     * `deletedBy` is a Better Auth user id, not an `ai_person`.
     */
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_evidence_org_id_idx").on(table.organizationId, table.id),
    /* This organisation's evidence that is still there — the register's own
     * read, and the one coverage is computed from. */
    index("ai_evidence_org_live_idx").on(table.organizationId, table.deletedAt),
    index("ai_evidence_org_state_idx").on(
      table.organizationId,
      table.verificationState,
    ),
    index("ai_evidence_org_expiry_idx").on(table.organizationId, table.expiresAt),
  ],
);

/**
 * What a document is offered as proof of.
 *
 * One link table for both targets rather than two, because the question asked of
 * it is always the same shape — *what rests on this document* — and answering it
 * across two tables would mean two queries and a merge for the blast-radius view
 * that is the whole reason the evidence record exists.
 */
export const aiEvidenceLink = pgTable(
  "ai_evidence_link",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id")
      .notNull(),
    /** control | system */
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.evidenceId],
      foreignColumns: [aiEvidence.organizationId, aiEvidence.id],
    }).onDelete("cascade"),
    primaryKey({
      columns: [
        table.organizationId,
        table.evidenceId,
        table.targetKind,
        table.targetId,
      ],
    }),
    index("ai_evidence_link_org_target_idx").on(
      table.organizationId,
      table.targetKind,
      table.targetId,
    ),
  ],
);

/**
 * The audit trail, for every record that holds state.
 *
 * **Append-only, and enforced in the database rather than by convention.**
 * `drizzle/0013` puts a trigger on this table that raises on UPDATE and on
 * DELETE. A trail the application can rewrite is a trail that proves nothing —
 * the whole reason an auditor accepts it as evidence is that the code holding
 * the connection *cannot* revise it, and a rule living only in `ai-store.ts` is
 * one careless `db.delete()` away from not existing. The trigger's one exception
 * is a row whose organization has already been deleted, so removing a tenant
 * still cascades; see the migration for why that is safe and how it is detected.
 *
 * `before` and `after` are text rather than typed values because an audit trail
 * is read, not recomputed — a union of every field type an event could describe
 * would be a type that means nothing and satisfies no auditor.
 *
 * `reason` is the column that makes the trail answer *why* rather than only
 * what. It is nullable because most changes carry no reason and inventing one
 * would be worse than its absence, but the acts where somebody is accountable
 * for a judgement — accepting a risk, approving a policy, overriding a triage,
 * closing a finding — pass it, and `writeAudit()` is where that is required.
 *
 * `subjectKind` exists so "show me every membership change" is answerable.
 * `subjectId` holds ids from different spaces — a system id, a control id, a
 * user id — and without a kind alongside it the only way to select a class of
 * event is to pattern-match id prefixes, which is a guess dressed as a query.
 *
 * `viaSuggestionId` is what makes "AI proposes, humans dispose" provable rather
 * than merely visible: where a change originated in an accepted suggestion, the
 * trail records both the person who accepted it and the suggestion they
 * accepted. "The model did it" and "a person adopted what the model proposed"
 * are different answers, and only the second is defensible.
 */
export const aiActivityEvent = pgTable(
  "ai_activity_event",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * What kind of thing `subjectId` names — `system`, `risk`, `member`, … The
     * values are `AuditSubjectKind` in `src/lib/audit.ts`; kept as text here
     * because an enum would make adding a subject a migration.
     */
    subjectKind: text("subject_kind").notNull().default("record"),
    /** Scope key — a system id, a control id, a risk id, a user id. */
    subjectId: text("subject_id").notNull(),
    actorId: text("actor_id"),
    /** Past tense, plain language: "changed applicability", "approved policy". */
    action: text("action").notNull(),
    field: text("field"),
    before: text("before"),
    after: text("after"),
    /** Why, in the actor's words. Required for the acts that need defending. */
    reason: text("reason"),
    at: timestamp("at").defaultNow().notNull(),
    viaSuggestionId: text("via_suggestion_id"),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_activity_org_subject_idx").on(
      table.organizationId,
      table.subjectId,
      table.at,
    ),
    /**
     * The tenant-wide reads: "everything that happened here, newest first" and,
     * with `subjectKind` leading, "every membership change". The per-subject
     * index above cannot serve either — its first key after the organization is
     * the subject, so both would be full scans of the organization's history.
     */
    index("ai_activity_org_at_idx").on(table.organizationId, table.at),
    index("ai_activity_org_kind_at_idx").on(
      table.organizationId,
      table.subjectKind,
      table.at,
    ),
  ],
);

/**
 * Who reviews *this* record, at *this* stage.
 *
 * **The reason Legal, Security and the exec sponsor are not roles.** They are
 * stages a record has to clear, and who covers a stage differs per system, per
 * business unit and over time — the security reviewer for the claims model is
 * not the one for the recruitment tool. As roles they would multiply every time
 * the workflow gained a step and would still not answer the only question that
 * matters at review time: whose desk is this on? `permissions.ts` grants the
 * *capacity* to approve; this table names the person.
 *
 * `assigneeUserId` is a **Better Auth user, not an `ai_person`**, and that is
 * the one place this schema deliberately diverges from `ai_person`'s argument
 * that a named person need not have an account. Owning a record is a label;
 * approving one is an act, and an act needs somebody who can sign in to perform
 * it. It is also what makes the finding rule checkable — "verified by somebody
 * other than its owner" is a comparison, and it can only be made between two
 * ids from the same space.
 *
 * There is no `state` column. Whether the stage is complete lives in the
 * assessment's own sign-off chain, and a second copy here would be a derived
 * value stored — the thing this schema does not do anywhere else. This table
 * answers who, and only who.
 */
export const aiReviewAssignment = pgTable(
  "ai_review_assignment",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** What kind of thing is under review — see `AuditSubjectKind`. */
    subjectKind: text("subject_kind").notNull(),
    subjectId: text("subject_id").notNull(),
    /** legal | security | privacy | exec_sponsor | governance, and whatever a
     * customer's workflow adds. Text rather than an enum because a new stage is
     * a customer's process changing, and that must not be a migration. */
    stage: text("stage").notNull(),
    assigneeUserId: text("assignee_user_id").notNull(),
    /** The user who made the assignment. Reassignment is itself a governed act. */
    assignedBy: text("assigned_by"),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  },
  (table) => [
    /* One reviewer per stage per record. A second assignment to the same stage
     * is a reassignment, not an additional approver — two people who both think
     * the other is reviewing it is the failure mode this key prevents. */
    primaryKey({
      columns: [table.organizationId, table.subjectKind, table.subjectId, table.stage],
    }),
    /* The query that drives a reviewer's queue: everything waiting on me. */
    index("ai_review_assignment_org_assignee_idx").on(
      table.organizationId,
      table.assigneeUserId,
    ),
  ],
);

/**
 * The people a record can name, which is not the same set as the accounts.
 *
 * **An `ai_person` is deliberately not a Better Auth user.** A control owner is
 * frequently somebody who has never signed in — the Head of Claims owns the
 * fairness control and reads about it in a monthly report — and conversely an
 * account holder is not automatically an owner of anything. Wiring this to
 * `user.id` would look like tidying up and would in fact make every ownership
 * record conditional on somebody having been provisioned, which is how an
 * inventory quietly loses its accountability column.
 *
 * `businessUnit` lives here rather than in its own table on purpose: the unit
 * list is a picker's options, derived with a distinct over this column, and a
 * table would add a join to gain nothing.
 */
export const aiPerson = pgTable(
  "ai_person",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Job title — shown wherever a name alone would be ambiguous. */
    role: text("role").notNull().default(""),
    businessUnit: text("business_unit").notNull().default(""),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_person_org_unit_idx").on(table.organizationId, table.businessUnit),
  ],
);

/**
 * Which account is which person — the one join between the two id spaces.
 *
 * `ai_person` argues at length that a named person need not have an account,
 * and that argument is right and unchanged. What it left open was the other
 * direction: a signed-in caller could not be resolved to the person a record
 * names, so `/api/suggestions` recorded every AI decision as unattributed and
 * the trail rendered raw user ids. This table answers *that* question only. It
 * does not make an account a person or a person an account; it records that
 * somebody has told us these two are the same human.
 *
 * **A separate table rather than a `person_id` column on `member`.** `member`
 * is Better Auth's, generated into `auth-schema.ts` and never hand-edited, so a
 * column there could carry neither of the two constraints that make this
 * mapping trustworthy: the composite foreign key that makes a row pointing at
 * another tenant's person impossible, and the uniqueness below. A mapping whose
 * integrity rules live only in application code is a mapping that is eventually
 * wrong, and a wrong one names the wrong human on an audit record — the exact
 * failure `acting-person.ts` refused a hardcoded id to avoid.
 *
 * **Uniqueness runs both ways, and both directions are load bearing.** The
 * primary key gives one person per account: an account with two people would
 * make "who is the caller" a question with two answers. The unique index gives
 * one account per person: without it two accounts both claim `p-anders`, and
 * every "is the caller the assignee?" check passes for both — which is the
 * check this table exists to make possible.
 *
 * The mapping invalidates nothing. It is a statement of identity, not a
 * judgement about a record, so no sign-off resets and no acceptance is voided
 * when one is made or unmade. What it changes is what the *next* write records,
 * and history is left exactly as it was written — a decision taken while the
 * caller was unattributed stays unattributed, because that is what was true.
 *
 * `linkedBy` and `linkedAt` are here as well as in the trail because "who says
 * these are the same person" is a property of the current mapping and is read
 * beside it, not a search through the history.
 */
export const aiAccountPerson = pgTable(
  "ai_account_person",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** A Better Auth user id. The account half. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** An `ai_person` id, within this same organization — see the FK below. */
    personId: text("person_id").notNull(),
    /** The account that made the claim. Asserting an identity is a governed act. */
    linkedBy: text("linked_by"),
    linkedAt: timestamp("linked_at").defaultNow().notNull(),
  },
  (table) => [
    /* One person per account. */
    primaryKey({ columns: [table.organizationId, table.userId] }),
    /* …and one account per person. See the block comment: this is the half that
     * keeps an identity check from passing for two different callers. */
    uniqueIndex("ai_account_person_org_person_uidx").on(
      table.organizationId,
      table.personId,
    ),
    /* Composite, so a mapping to another tenant's person cannot be written at
     * all — the same reason every other cross-table reference here is. */
    foreignKey({
      columns: [table.organizationId, table.personId],
      foreignColumns: [aiPerson.organizationId, aiPerson.id],
      name: "ai_account_person_person_fk",
    }).onDelete("cascade"),
  ],
);

/**
 * What a role means *here*, where a tenant has changed it.
 *
 * **A row is an override, and its absence is the code default — never "nothing".**
 * `permissions.ts` ships the five roles as compiled statements, and that stays
 * the answer for every organization that has not touched them. Storing the full
 * matrix per tenant instead would mean a new statement in the vocabulary was
 * invisible to every existing customer until somebody re-saved their roles, and
 * a failed read would lock everybody out of everything rather than fall back to
 * something sensible.
 *
 * **Three resources are deliberately not storable here**, and the store refuses
 * them: `organization`, `member` and `invitation` are policed by Better Auth's
 * organization plugin from the `ac` it is handed at import in `auth.ts`, so an
 * override would be honoured by this app's routes and ignored by the library's
 * own endpoints — divergence in the permissive direction. `role` is refused for
 * a different reason: a permission that can widen who holds it is not a
 * permission. `permissions.ts` holds the list and the argument.
 *
 * **`platform_admin` is not storable either.** It is Better Auth's `creatorRole`,
 * the plugin's last-one-out protections key off it, and it is the role that holds
 * the permission to edit the others. A tenant that could edit it could lock
 * itself out of its own organization, repairable only from the database.
 *
 * Keyed by resource rather than holding one blob per role, because that is the
 * grain an edit actually has — "the reviewer no longer verifies findings" is one
 * row — and because a blob would make two people editing two different resources
 * a lost update.
 */
export const aiRoleGrant = pgTable(
  "ai_role_grant",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** A `RoleName`. Text rather than an enum: the set lives in `permissions.ts`. */
    role: text("role").notNull(),
    /** A resource from `statement` — `control`, `risk`, `signoff`, … */
    resource: text("resource").notNull(),
    /** The actions this role holds on it. Empty array means "holds none". */
    actions: jsonb("actions").$type<string[]>().notNull().default([]),
    /** The account that last set it. Rewriting the matrix is a governed act. */
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.role, table.resource] }),
    /* The read: this organization's whole matrix, on every request that resolves
     * a caller. Small by construction — five roles by a dozen resources at most,
     * and only the rows that differ from the default. */
    index("ai_role_grant_org_idx").on(table.organizationId),
  ],
);

/**
 * The policies a control can cite.
 *
 * Deliberately narrow: a title, a version, whether it is approved, and when it
 * is next due for review. It holds no body and no approval chain — the GDPR
 * toolkit's `policy` table did, and it is gone. A Statement of Applicability
 * needs to know a policy exists and is current, not to be a document store; if
 * drafting comes back it comes back as its own table. Only an approved policy
 * satisfies a control, so `status` is the field the SoA's `no-policy` lens and
 * `policyPosture()` both read — a draft is a document, not a control, however
 * complete it reads.
 */
export const aiPolicy = pgTable(
  "ai_policy",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    ownerId: text("owner_id"),
    version: text("version").notNull().default("1.0"),
    approvedAt: text("approved_at"),
    nextReviewDate: text("next_review_date").notNull(),
    summary: text("summary").notNull().default(""),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_policy_org_status_idx").on(table.organizationId, table.status),
  ],
);

/**
 * An inbound questionnaire — the request, not the reply.
 *
 * The record here is the commitment: who asked, when it is due, who owns it.
 * **The drafted answers are not stored and must not be.** An answer is only safe
 * to send
 * while the evidence behind it is current, so recomputing it on open is the
 * feature: the same question next quarter draws on the same controls, and if
 * one has lost its evidence since, an answer cached in August would still read
 * as true in November.
 */
export const aiQuestionnaire = pgTable(
  "ai_questionnaire",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    requester: text("requester").notNull(),
    requesterType: text("requester_type").notNull().default("customer"),
    receivedAt: text("received_at").notNull(),
    dueAt: text("due_at").notNull(),
    ownerId: text("owner_id"),
    status: text("status").notNull().default("not_started"),
    note: text("note").notNull().default(""),
    /**
     * Soft delete. **A row with `deletedAt` set is gone as far as every read is
     * concerned**, and `ai-store.ts` filters on it in every query.
     *
     * A questionnaire is a promise made to somebody outside the company — a
     * customer's security review, a regulator's request — with a date on it.
     * Removing one has to leave behind the fact that it arrived and was
     * dropped, because the party who sent it still believes it is being
     * answered, and "we never received that" is the one reply a register should
     * never be able to make true after the fact.
     *
     * `deletedBy` is a Better Auth user id, not an `ai_person`.
     */
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_questionnaire_org_due_idx").on(table.organizationId, table.dueAt),
    /* This organisation's questionnaires that are still there. */
    index("ai_questionnaire_org_live_idx").on(
      table.organizationId,
      table.deletedAt,
    ),
  ],
);

/**
 * One question, and where its answer would have to come from.
 *
 * The three id arrays are not an answer — they are the records a reply would
 * rest on. Holding them against the question rather than against a stored reply
 * is what makes confidence recomputable rather than remembered.
 */
export const aiQuestionnaireQuestion = pgTable(
  "ai_questionnaire_question",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    questionnaireId: text("questionnaire_id").notNull(),
    /** The requester's own numbering, which is what they will quote back. */
    number: text("number").notNull(),
    text: text("text").notNull(),
    position: integer("position").notNull().default(0),
    controlIds: jsonb("control_ids").$type<string[]>().notNull().default([]),
    policyIds: jsonb("policy_ids").$type<string[]>().notNull().default([]),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_qq_org_questionnaire_idx").on(
      table.organizationId,
      table.questionnaireId,
      table.position,
    ),
  ],
);

/**
 * What a model proposed, and what a person decided about it.
 *
 * Stored — despite no model being called in this slice — because the record of
 * a proposal and its disposal is an audit artefact rather than a cache. An
 * auditor asking "what did the AI change" needs an answer that survives the
 * session it was proposed in, and `ai_activity_event.via_suggestion_id` points
 * here for exactly that.
 *
 * `recommendation` is what *would* be written; nothing writes it until somebody
 * accepts. A pending row has therefore changed nothing, which is the whole
 * claim the suggestion card exists to make visible.
 */
export const aiSuggestion = pgTable(
  "ai_suggestion",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Where it appears — the thing the recommendation would be written into. */
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    recommendation: text("recommendation").notNull(),
    /** Why, in prose a compliance lead can challenge. Never a chain of thought. */
    reasoning: text("reasoning").notNull().default(""),
    supportingData: jsonb("supporting_data")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    /**
     * Whole percent, 0-100. The domain type is a 0-1 fraction; it is stored as
     * an integer because confidence is rendered as a band plus a rounded figure
     * and never compared for equality, so the extra precision would only invite
     * a float comparison somebody later gets wrong.
     */
    confidence: integer("confidence").notNull().default(0),
    status: text("status").notNull().default("pending"),
    decidedById: text("decided_by_id"),
    decidedAt: text("decided_at"),
    /** Present once somebody chose Edit — what they changed it to. */
    editedText: text("edited_text"),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("ai_suggestion_org_target_idx").on(
      table.organizationId,
      table.targetKind,
      table.targetId,
    ),
    index("ai_suggestion_org_status_idx").on(table.organizationId, table.status),
  ],
);
