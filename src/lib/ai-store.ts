import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import { db } from "@/db";
import {
  aiAccountPerson,
  aiActivityEvent,
  aiApplicability,
  aiApplicabilitySystem,
  aiAssessment,
  aiAssessmentAnswer,
  aiControl,
  aiEvidence,
  aiEvidenceLink,
  aiFinding,
  aiFindingRisk,
  aiFramework,
  aiFrameworkNode,
  aiIntakeNote,
  aiIntakeRequest,
  aiPerson,
  aiPolicy,
  aiQuestionnaire,
  aiQuestionnaireQuestion,
  aiReviewAssignment,
  aiRisk,
  aiRiskControl,
  aiRoleGrant,
  aiSuggestion,
  aiSystem,
  aiUseCase,
  aiUseCaseSystem,
  member,
  user,
} from "@/db/schema";

import {
  purgeCutoff,
  TRASH_RETENTION_DAYS as RETENTION_DAYS,
} from "./ams/trash";
import type {
  AccountPerson,
  ActivityEvent,
  AiSuggestion,
  AISystem,
  AIUseCase,
  UseCaseSystemOverride,
  AssessmentInstance,
  ControlApplicability,
  DeletedAISystem,
  DeletedAssessment,
  DeletedEvidence,
  DeletedFinding,
  DeletedIntakeRequest,
  DeletedQuestionnaire,
  DeletedRisk,
  DeletedUseCase,
  Evidence,
  Finding,
  FindingRiskLink,
  Framework,
  FrameworkControl,
  FrameworkNode,
  IntakeNote,
  IntakeRequest,
  Person,
  Policy,
  Questionnaire,
  QuestionnaireQuestion,
  ReviewAssignment,
  Risk,
  SignOffStep,
} from "./ams/types";
import type { WorkspaceData } from "./ams/workspace";
import {
  EDITABLE_RESOURCES,
  FIXED_ROLE,
  ROLE_ORDER,
  defaultGrants,
  refusedGrant,
  type OrgGrants,
  type RoleGrants,
  type RoleName,
} from "./permissions";
import {
  auditId,
  describeChanges,
  SYSTEM_ACTOR,
  type Actor,
  type AuditEntry,
  type AuditSubjectKind,
  type FieldChange,
} from "./audit";

/**
 * The tenant boundary.
 *
 * It began as a sibling of the GDPR toolkit's `store.ts`, sharing nothing with
 * it but the rule; that file is gone and the rule is what mattered —
 * **`organizationId` is always the first argument and every query filters on
 * it.** That signature is the isolation. It makes a missing scope a type error
 * rather than a data leak, and it is the reason the negative tests in
 * `ai-store.test.ts` can prove the WHERE clause is really there.
 *
 * **Reads never throw.** Every page calls one during render, so an escaping
 * error would 500 the whole app rather than showing an empty table. They log and
 * return the empty value.
 *
 * One consequence of the mockup's design is worth stating here, because it
 * removes a whole class of the invalidation problem `store.ts` wrestles with:
 * **nothing derived is stored.** Readiness, per-system coverage, triage
 * recommendations and answer confidence are all computed from these rows on
 * every read. So saving an answer or claiming a control does not invalidate a
 * cached score, because there is no cached score. The two places a write *does*
 * invalidate a human judgement — a material assessment answer resetting a
 * sign-off, and re-rating a residual voiding its acceptance — are handled
 * explicitly below and marked.
 *
 * **Every write takes an `Actor`, and writes its own audit row.** The second
 * axis of the same trick as `organizationId`: a required parameter is a rule
 * that cannot be forgotten, where "remember to log this" is a rule that is
 * eventually not followed. There is no function here that can change a row
 * without leaving a trail, which is a stronger guarantee than auditing every
 * caller, because it also holds for the callers nobody has written yet.
 * `src/lib/audit.ts` argues the ordering and the failure modes.
 *
 * This file remains the tenant boundary and **not a policy layer**. It records
 * that a change happened and who made it; whether the change was *allowed* is
 * `requirePermission`, and whether it was *valid* — a finding closing without a
 * verification, a reason missing from a risk acceptance — belongs to the caller
 * that knows what act it is performing. The seed and `ai-store.test.ts` write
 * through here directly and must keep being able to.
 */

/**
 * Somebody else changed this row since you read it.
 *
 * Optimistic concurrency, and opt-in: a caller that passes `expectedVersion` is
 * saying "I am editing what I read". Without it the last write wins, which is
 * the right default for the seed and for an import but the wrong one for two
 * people editing the same risk in two tabs — there, the loser never learns their
 * edit was discarded.
 */
export class ConcurrentModificationError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `That record was changed by somebody else while you were editing it (you had version ${expected}, it is now ${actual}). Reload and reapply your change.`,
    );
    this.name = "ConcurrentModificationError";
  }
}

/**
 * Refuse a write that would silently overwrite somebody else's.
 *
 * A no-op when the caller did not ask, and when the row is new: there is nothing
 * to conflict with, and demanding a version for a creation would make every
 * caller invent one.
 */
function checkVersion(expected: number | undefined, current: number | undefined): void {
  if (expected === undefined || current === undefined) return;
  if (expected !== current) throw new ConcurrentModificationError(expected, current);
}

/* ------------------------------------------------------------------- audit */

/**
 * Append a trail entry. The only insert into `ai_activity_event` in the app.
 *
 * The table is append-only in the database (`drizzle/0013`), so there is no
 * update or delete counterpart to this function and there cannot be one: a
 * caller that tried would get an exception from Postgres, not a silent rewrite.
 *
 * Unlike every read here, this **does** throw. A read degrading to an empty
 * state costs a screen; an audit row silently failing to land costs the property
 * the whole trail exists to provide, and a write whose record did not persist
 * must not look like a write that succeeded.
 */
export async function writeAudit(
  organizationId: string,
  actor: Actor,
  entries: AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  await db.insert(aiActivityEvent).values(
    entries.map((entry) => ({
      id: auditId(),
      organizationId,
      subjectKind: entry.subjectKind,
      subjectId: entry.subjectId,
      actorId: actor.userId || null,
      action: entry.action,
      field: entry.field ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: actor.reason?.trim() || null,
      at: new Date(),
      viaSuggestionId: actor.viaSuggestionId ?? null,
    })),
  );
}

/**
 * Record the change, then make it.
 *
 * Audit-first is deliberate and is forced by the driver: Neon's HTTP endpoint
 * has no interactive transactions (`src/db/index.ts`), so these two writes
 * cannot be made atomic. Of the two orderings, only this one fails safe — a
 * trail that over-reports can be reconciled by reading it, a trail with silent
 * holes is not evidence. When the domain write throws, a second entry records
 * that, so the over-report is visible rather than misleading.
 *
 * A write that changes nothing produces no entries and no rows. Recording
 * saves that moved no field would pad the trail with things that look like
 * activity, and a trail nobody can skim is a trail nobody reads.
 */
async function audited(
  organizationId: string,
  actor: Actor,
  entries: AuditEntry[],
  write: () => Promise<void>,
): Promise<void> {
  await writeAudit(organizationId, actor, entries);

  try {
    await write();
  } catch (err) {
    if (entries.length > 0) {
      // Best effort, and deliberately swallowed: the caller needs the original
      // failure, not a second one raised while trying to describe it.
      await writeAudit(organizationId, actor, [
        {
          subjectKind: entries[0].subjectKind,
          subjectId: entries[0].subjectId,
          action: "the change recorded above did not complete",
          after: err instanceof Error ? err.message : String(err),
        },
      ]).catch(() => {});
    }
    throw err;
  }
}

/**
 * One entry per field that actually moved.
 *
 * Field-level rather than "somebody saved this record", because the second is
 * not something an auditor can act on and "moved it from pilot to production"
 * is. It is also the shape `activity-panel.tsx` already renders, so the trail
 * and the screen stay one design rather than two.
 */
function changeEntries(
  subjectKind: AuditSubjectKind,
  subjectId: string,
  action: string,
  changes: FieldChange[],
): AuditEntry[] {
  return changes.map((change) => ({
    subjectKind,
    subjectId,
    action,
    field: change.field,
    before: change.before,
    after: change.after,
  }));
}

/**
 * The entries an upsert should leave: a creation names the record, an edit names
 * the fields.
 *
 * A creation collapses to a single entry rather than one per populated column.
 * Twenty rows saying "name was set to X, vendor was set to Y" on registration
 * bury the one event somebody is looking for, and the values are all still on
 * the record itself; what the trail has to preserve is *when it appeared and who
 * put it there*. An edit is the opposite case — the record no longer holds the
 * old value, so the trail is the only place it exists.
 */
function upsertEntries<T extends object>(
  subjectKind: AuditSubjectKind,
  subjectId: string,
  actions: { created: string; changed: string },
  before: T | null,
  after: T,
): AuditEntry[] {
  if (!before) {
    return [{ subjectKind, subjectId, action: actions.created }];
  }

  return changeEntries(
    subjectKind,
    subjectId,
    actions.changed,
    describeChanges(before, after),
  );
}

/* --------------------------------------------------------------- inventory */

function toSystem(row: typeof aiSystem.$inferSelect): AISystem {
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    origin: row.origin as AISystem["origin"],
    isGenAi: row.isGenAi,
    businessUnit: row.businessUnit,
    ownerId: row.ownerId ?? "",
    lifecycleStage: row.lifecycleStage as AISystem["lifecycleStage"],
    riskTier: row.riskTier as AISystem["riskTier"],
    assessmentStatus: row.assessmentStatus as AISystem["assessmentStatus"],
    purpose: row.purpose,
    deploymentModel: row.deploymentModel as AISystem["deploymentModel"],
    hostingRegions: row.hostingRegions ?? [],
    dataResidency: row.dataResidency,
    userGroups: row.userGroups ?? [],
    approxUsers: row.approxUsers,
    dataCategories: (row.dataCategories ?? []) as AISystem["dataCategories"],
    characteristics: (row.characteristics ?? []) as AISystem["characteristics"],
    vendorDetail: (row.vendorDetail ?? {
      name: row.vendor,
      subProcessors: [],
      modelProvider: null,
      contractType: "click_through",
      dataProcessingAgreement: false,
      certifications: [],
      trainsOnCustomerData: false,
      renewalDate: null,
    }) as unknown as AISystem["vendorDetail"],
    registeredAt: row.registeredAt,
    nextReviewDate: row.nextReviewDate,
    discoveredVia: row.discoveredVia as AISystem["discoveredVia"],
    version: row.version,
  };
}

export async function readAiSystems(organizationId: string): Promise<AISystem[]> {
  try {
    const rows = await db
      .select()
      .from(aiSystem)
      .where(and(eq(aiSystem.organizationId, organizationId), isNull(aiSystem.deletedAt)))
      .orderBy(asc(aiSystem.name));
    return rows.map(toSystem);
  } catch (err) {
    console.error("[ai-store] system read failed", err);
    return [];
  }
}

/*
 * The retention window is a domain rule and lives in `./ams/trash`, beside the
 * other thresholds. Re-exported here only because the purge below reads it, and
 * a second copy of "30" is how a screen and a cron come to disagree.
 */
export { TRASH_RETENTION_DAYS } from "./ams/trash";

/**
 * The trash: systems removed but not yet purged.
 *
 * The exact inverse of `readAiSystems`' filter, and deliberately a separate
 * function rather than a flag on it. Every caller of `readAiSystems` wants the
 * live register, and a boolean parameter is how one of them eventually gets the
 * other by accident.
 *
 * `deletedAt` comes back as an ISO string beside the system so the view can
 * count the days left. **Nothing computes or stores the deadline here** — it is
 * `deletedAt` plus the window, derived wherever it is shown, like every other
 * figure in this product.
 */
export async function readDeletedAiSystems(
  organizationId: string,
): Promise<DeletedAISystem[]> {
  try {
    const rows = await db
      .select()
      .from(aiSystem)
      .where(
        and(eq(aiSystem.organizationId, organizationId), isNotNull(aiSystem.deletedAt)),
      )
      .orderBy(desc(aiSystem.deletedAt));

    return rows.map((row) => ({
      ...toSystem(row),
      // Non-null by the filter above; the column is nullable for live rows.
      deletedAt: (row.deletedAt as Date).toISOString(),
      deletedBy: row.deletedBy,
    }));
  } catch (err) {
    console.error("[ai-store] deleted system read failed", err);
    return [];
  }
}

/**
 * Put a removed system back in the register.
 *
 * Clears the tombstone and nothing else. Deliberately **not** a call to
 * `saveAiSystem`: an upsert would need the caller to reconstruct a whole
 * `AISystem` from a row it is only restoring, and would bump `version` for a
 * change that is not an edit — every optimistic-concurrency check on a profile
 * open elsewhere would start failing because somebody undid a delete.
 *
 * Its dependents need no touching. `readWorkspace` derives their visibility
 * from the parent, so clearing this one field brings the use cases, risks,
 * assessments and applicability claims back with it.
 */
export async function restoreAiSystem(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<boolean> {
  const [row] = await db
    .select({ name: aiSystem.name, deletedAt: aiSystem.deletedAt })
    .from(aiSystem)
    .where(and(eq(aiSystem.organizationId, organizationId), eq(aiSystem.id, id)))
    .limit(1);

  // Not there, or never removed. Either way there is nothing to restore and no
  // trail entry to write claiming otherwise.
  if (!row || !row.deletedAt) return false;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "system",
        subjectId: id,
        action: "restored the system",
        field: "name",
        before: null,
        after: row.name,
      },
    ],
    async () => {
      await db
        .update(aiSystem)
        .set({ deletedAt: null, deletedBy: null })
        .where(and(eq(aiSystem.organizationId, organizationId), eq(aiSystem.id, id)));
    },
  );

  return true;
}

/**
 * Permanently remove the systems whose retention window has run out.
 *
 * **Org-scoped like every other function here**, and called once per
 * organisation by the cron rather than sweeping the whole table. A global
 * `DELETE ... WHERE deleted_at < $1` would be one missing clause away from
 * emptying a tenant that was never in scope, and this is the one operation in
 * the product where that mistake cannot be undone.
 *
 * **What goes is what the soft delete already hid.** Use cases, applicability
 * claims and assessments cascade from `ai_system` at the foreign key. Risks and
 * findings do not — they carry a nullable `systemId` with no constraint, so
 * they are removed explicitly, along with the risks stranded on a use case that
 * is about to disappear. Their link rows cascade from them in turn. Anything
 * still visible in the register is untouched by construction: the query starts
 * from systems that are already tombstoned.
 *
 * **The audit trail is not touched and must never be.** `ai_activity_event` has
 * no foreign key into any of this and is append-only by trigger, so "who
 * removed this system, and when" outlives the row itself. That is the single
 * property that makes a 30-day purge defensible in a governance product: the
 * record of the decision survives the record it was about.
 */
export async function purgeExpiredSystems(
  organizationId: string,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<{ id: string; name: string }[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const expired = await db
    .select({ id: aiSystem.id, name: aiSystem.name })
    .from(aiSystem)
    .where(
      and(
        eq(aiSystem.organizationId, organizationId),
        isNotNull(aiSystem.deletedAt),
        lt(aiSystem.deletedAt, cutoff),
      ),
    );

  if (expired.length === 0) return [];

  const ids = expired.map((row) => row.id);

  /*
   * The use cases that will be left with nothing.
   *
   * Collected before the systems go, because a risk stranded on a use case that
   * no longer names anything would name nothing at all.
   *
   * **Only the ones whose *last* system is being purged.** A use case reaching
   * three systems loses a link when one is destroyed and carries on; sweeping
   * every use case that merely touched a purged system would destroy the risks
   * of purposes still being served by the systems that remain. The cascade on
   * `ai_use_case_system` removes the links either way — this query is about
   * which use cases that leaves empty.
   */
  const linkRows = await db
    .select({
      useCaseId: aiUseCaseSystem.useCaseId,
      systemId: aiUseCaseSystem.systemId,
    })
    .from(aiUseCaseSystem)
    .where(eq(aiUseCaseSystem.organizationId, organizationId));

  const purging = new Set(ids);
  const survivors = new Map<string, boolean>();
  for (const link of linkRows) {
    const kept = survivors.get(link.useCaseId) ?? false;
    survivors.set(link.useCaseId, kept || !purging.has(link.systemId));
  }

  const useCaseIds = [...survivors.entries()]
    .filter(([, keepsOne]) => !keepsOne)
    .map(([useCaseId]) => useCaseId);

  await audited(
    organizationId,
    /* Forseti removed these, not a person — `SYSTEM_ACTOR` is what the activity
     * panel already renders as "Forseti", so the trail reads as the schedule
     * doing its job rather than as an account nobody can look up. */
    SYSTEM_ACTOR,
    expired.map((row) => ({
      subjectKind: "system" as const,
      subjectId: row.id,
      action: "permanently removed the system after its retention window",
      field: "name",
      before: row.name,
      after: null,
    })),
    async () => {
      await db
        .delete(aiRisk)
        .where(
          and(
            eq(aiRisk.organizationId, organizationId),
            useCaseIds.length > 0
              ? or(
                  inArray(aiRisk.systemId, ids),
                  inArray(aiRisk.useCaseId, useCaseIds),
                )
              : inArray(aiRisk.systemId, ids),
          ),
        );

      await db
        .delete(aiFinding)
        .where(
          and(
            eq(aiFinding.organizationId, organizationId),
            inArray(aiFinding.systemId, ids),
          ),
        );

      /*
       * The use cases left with nothing, removed explicitly.
       *
       * This used to happen by itself: `ai_use_case.system_id` carried a
       * cascading foreign key, so destroying a system destroyed its use cases.
       * The relation moved to a join table, and the cascade now takes the
       * *link* — which is right for a purpose two other systems still serve,
       * and leaves one that nothing serves as a row with no links at all.
       * `readWorkspace` hides it, so it would sit there invisible and
       * unreachable, with no tombstone and no trash entry to find it by. Losing
       * a cascade means writing what it used to do.
       */
      if (useCaseIds.length > 0) {
        await db
          .delete(aiUseCase)
          .where(
            and(
              eq(aiUseCase.organizationId, organizationId),
              inArray(aiUseCase.id, useCaseIds),
            ),
          );
      }

      // Last, so the rows above could still be found by the ids they name.
      // Assessments and applicability claims go with this one.
      await db
        .delete(aiSystem)
        .where(and(eq(aiSystem.organizationId, organizationId), inArray(aiSystem.id, ids)));
    },
  );

  return expired;
}

/**
 * Every organisation with something in its trash that is now overdue.
 *
 * **The one deliberately cross-tenant read in this module**, and it exists for
 * the nightly purge and nothing else. It returns ids and no data: the caller
 * loops and calls `purgeExpiredSystems` per organisation, so the delete itself
 * stays inside the same tenant filter as every other write here.
 */
export async function organizationIdsWithExpiredTrash(
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<string[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const rows = await db
    .selectDistinct({ organizationId: aiSystem.organizationId })
    .from(aiSystem)
    .where(and(isNotNull(aiSystem.deletedAt), lt(aiSystem.deletedAt, cutoff)));

  return rows.map((row) => row.organizationId);
}

export async function readAiSystem(
  organizationId: string,
  id: string,
): Promise<AISystem | null> {
  try {
    const [row] = await db
      .select()
      .from(aiSystem)
      .where(
        and(
          eq(aiSystem.organizationId, organizationId),
          eq(aiSystem.id, id),
          isNull(aiSystem.deletedAt),
        ),
      )
      .limit(1);
    return row ? toSystem(row) : null;
  } catch (err) {
    console.error("[ai-store] system read failed", err);
    return null;
  }
}

export async function saveAiSystem(
  organizationId: string,
  system: AISystem,
  actor: Actor,
  options: { expectedVersion?: number } = {},
): Promise<void> {
  const before = await readAiSystem(organizationId, system.id);
  checkVersion(options.expectedVersion, before?.version);
  const values = {
    id: system.id,
    organizationId,
    name: system.name,
    vendor: system.vendor,
    origin: system.origin,
    isGenAi: system.isGenAi,
    businessUnit: system.businessUnit,
    ownerId: system.ownerId || null,
    lifecycleStage: system.lifecycleStage,
    riskTier: system.riskTier,
    assessmentStatus: system.assessmentStatus,
    purpose: system.purpose,
    deploymentModel: system.deploymentModel,
    hostingRegions: system.hostingRegions,
    dataResidency: system.dataResidency,
    userGroups: system.userGroups,
    approxUsers: system.approxUsers,
    dataCategories: system.dataCategories,
    characteristics: system.characteristics,
    vendorDetail: system.vendorDetail as unknown as Record<string, unknown>,
    registeredAt: system.registeredAt,
    nextReviewDate: system.nextReviewDate,
    discoveredVia: system.discoveredVia,
    /* Saving a record is asserting it exists, so an upsert lands on top of a
     * soft-deleted row by clearing the tombstone. Without this the row stays
     * invisible and the save appears to have silently done nothing — the id is
     * still taken, so the insert becomes an update, and the update leaves
     * `deleted_at` exactly where it was. */
    deletedAt: null,
    deletedBy: null,
    // Monotonic, and derived here rather than taken from the caller — a version
    // a client could choose is a version a stale client can reset.
    version: (before?.version ?? 0) + 1,
  };

  await audited(
    organizationId,
    actor,
    upsertEntries(
      "system",
      system.id,
      { created: "registered the system", changed: "changed the system" },
      before,
      system,
    ),
    async () => {
      await db
        .insert(aiSystem)
        .values(values)
        .onConflictDoUpdate({ target: [aiSystem.organizationId, aiSystem.id], set: values });
    },
  );
}

export async function deleteAiSystem(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<void> {
  const before = await readAiSystem(organizationId, id);

  // Nothing to record when nothing was there — a delete of another tenant's id,
  // or of a row already gone, is a no-op and must not leave a trail entry
  // claiming otherwise.
  if (!before) return;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "system",
        subjectId: id,
        action: "deleted the system",
        field: "name",
        before: before.name,
        after: null,
      },
    ],
    async () => {
      /* Soft. The row stops existing for every read, and stays on disk with its
       * trail intact — see the `deletedAt` comment in `schema.ts` for why a
       * governed deletion has to remain answerable. */
      await db
        .update(aiSystem)
        .set({
          deletedAt: new Date(),
          deletedBy: actor.userId || null,
          version: before.version === undefined ? 1 : before.version + 1,
        })
        .where(and(eq(aiSystem.organizationId, organizationId), eq(aiSystem.id, id)));
    },
  );
}

/* --------------------------------------------------------------- use cases */

function toUseCase(
  row: typeof aiUseCase.$inferSelect,
  systemIds: string[],
  systemOverrides: UseCaseSystemOverride[] = [],
): AIUseCase {
  return {
    id: row.id,
    systemIds,
    systemOverrides,
    name: row.name,
    description: row.description,
    businessUnit: row.businessUnit,
    ownerId: row.ownerId ?? "",
    riskTier: row.riskTier as AIUseCase["riskTier"],
    oversightLevel: row.oversightLevel as AIUseCase["oversightLevel"],
    oversightSummary: row.oversightSummary,
    facesCustomers: row.facesCustomers,
    informsDecisionsAboutPeople: row.informsDecisionsAboutPeople,
    dataCategories: (row.dataCategories ?? []) as AIUseCase["dataCategories"],
    approxUsers: row.approxUsers,
    status: row.status as AIUseCase["status"],
    assessmentId: null,
    version: row.version,
  };
}

export async function readUseCases(
  organizationId: string,
  systemId?: string,
): Promise<AIUseCase[]> {
  try {
    /* `deleted_at IS NULL` on every read, like every other register. A removed
     * use case is gone as far as this function is concerned; the trash reads it
     * through `readDeletedUseCases` and nothing else does. */
    const rows = await db
      .select()
      .from(aiUseCase)
      .where(
        and(eq(aiUseCase.organizationId, organizationId), isNull(aiUseCase.deletedAt)),
      )
      .orderBy(asc(aiUseCase.name));

    /* The relation, read whole and bucketed in JS rather than joined in SQL —
     * the same shape `readAiEvidence` uses, and for the same reason: one table
     * failing costs that relation and not the page. */
    const links = await db
      .select()
      .from(aiUseCaseSystem)
      .where(eq(aiUseCaseSystem.organizationId, organizationId));

    const systems = new Map<string, string[]>();
    const overrides = new Map<string, UseCaseSystemOverride[]>();
    for (const link of links) {
      const list = systems.get(link.useCaseId) ?? [];
      list.push(link.systemId);
      systems.set(link.useCaseId, list);

      /* Sparse: a pairing is only listed when it actually differs. Carrying a
       * row of nulls for every link would make "has an override" a question
       * about field contents rather than about membership. */
      if (link.riskTier || link.oversightLevel || link.oversightSummary) {
        const found = overrides.get(link.useCaseId) ?? [];
        found.push({
          systemId: link.systemId,
          riskTier: (link.riskTier ?? null) as UseCaseSystemOverride["riskTier"],
          oversightLevel: (link.oversightLevel ??
            null) as UseCaseSystemOverride["oversightLevel"],
          oversightSummary: link.oversightSummary ?? null,
        });
        overrides.set(link.useCaseId, found);
      }
    }

    /* The assessment id lives on the assessment, so it is joined back here
     * rather than duplicated on the use case where the two could disagree. */
    const assessments = await db
      .select({ id: aiAssessment.id, useCaseId: aiAssessment.useCaseId })
      .from(aiAssessment)
      .where(eq(aiAssessment.organizationId, organizationId));

    const byUseCase = new Map(
      assessments.filter((a) => a.useCaseId).map((a) => [a.useCaseId as string, a.id]),
    );

    /* Filtered after hydration rather than in the query: the caller wants the
     * use cases reaching this system, and each of them still has to carry every
     * system it reaches. A `WHERE` on the join would return the rows and lie
     * about their other links. */
    const all = rows.map((row) => ({
      ...toUseCase(row, systems.get(row.id) ?? [], overrides.get(row.id) ?? []),
      assessmentId: byUseCase.get(row.id) ?? null,
    }));

    return systemId ? all.filter((u) => u.systemIds.includes(systemId)) : all;
  } catch (err) {
    console.error("[ai-store] use case read failed", err);
    return [];
  }
}

export async function readUseCase(
  organizationId: string,
  id: string,
): Promise<AIUseCase | null> {
  const all = await readUseCases(organizationId);
  return all.find((u) => u.id === id) ?? null;
}

/**
 * Write a use case.
 *
 * **This write invalidates nothing, on purpose.** The store carries exactly two
 * invalidations — a material assessment answer resets the sign-off chain, and
 * re-rating a residual voids the acceptance it was given against — and both act
 * on the record being written. A use case has a neighbour that arguably ought to
 * care: flipping `informsDecisionsAboutPeople` to true pulls a whole fairness
 * section into an assessment that may already be approved, and raising the tier
 * changes what that approval was given against.
 *
 * It deliberately does not reach over and disturb that assessment. Every
 * invalidation in this file is same-record; a cross-record one would be the
 * first, and the honest form of it is not a reset but a staleness mark with a
 * notice on the assessment screen — a mechanism that does not exist here yet and
 * is a feature rather than register parity. Recorded so the next person changing
 * this knows it was decided rather than missed.
 */
export async function saveUseCase(
  organizationId: string,
  useCase: AIUseCase,
  actor: Actor,
  options: { expectedVersion?: number } = {},
): Promise<void> {
  const before = await readUseCase(organizationId, useCase.id);
  checkVersion(options.expectedVersion, before?.version);
  const values = {
    id: useCase.id,
    organizationId,
    name: useCase.name,
    description: useCase.description,
    businessUnit: useCase.businessUnit,
    ownerId: useCase.ownerId || null,
    riskTier: useCase.riskTier,
    oversightLevel: useCase.oversightLevel,
    oversightSummary: useCase.oversightSummary,
    facesCustomers: useCase.facesCustomers,
    informsDecisionsAboutPeople: useCase.informsDecisionsAboutPeople,
    dataCategories: useCase.dataCategories,
    approxUsers: useCase.approxUsers,
    status: useCase.status,
    /* Saving a record is asserting it exists, so an upsert lands on top of a
     * soft-deleted row by clearing the tombstone. See `saveAiRisk` for why the
     * absence of these two lines is invisible rather than loud. */
    deletedAt: null,
    deletedBy: null,
    version: (before?.version ?? 0) + 1,
  };

  await audited(
    organizationId,
    actor,
    upsertEntries(
      "use_case",
      useCase.id,
      { created: "added a use case", changed: "changed the use case" },
      before,
      useCase,
    ),
    async () => {
      await db
        .insert(aiUseCase)
        .values(values)
        .onConflictDoUpdate({ target: [aiUseCase.organizationId, aiUseCase.id], set: values });

      /* Replaced, not merged: the caller sends the complete set of systems it
       * wants, the same contract every other link table in this file has. The
       * delete is scoped by organisation as well as by use case — without it,
       * knowing an id would be enough to clear another tenant's links. */
      await db
        .delete(aiUseCaseSystem)
        .where(
          and(
            eq(aiUseCaseSystem.organizationId, organizationId),
            eq(aiUseCaseSystem.useCaseId, useCase.id),
          ),
        );

      if (useCase.systemIds.length > 0) {
        /* Filtered through this organisation's own inventory so a stale or
         * forged id is dropped rather than written. Both foreign keys on the
         * join are composite with the organisation, so an id from elsewhere
         * would not merely be wrong — it would fail the whole write. */
        const owned = await db
          .select({ id: aiSystem.id })
          .from(aiSystem)
          .where(
            and(
              eq(aiSystem.organizationId, organizationId),
              inArray(aiSystem.id, useCase.systemIds),
            ),
          );

        if (owned.length > 0) {
          /* The overrides ride along with the link rows they live on. Writing
           * the membership without them would silently discard every
           * pair-level judgement on the next unrelated save — the links are
           * replaced wholesale, so anything not carried is gone. */
          const override = new Map(
            useCase.systemOverrides.map((row) => [row.systemId, row]),
          );

          await db.insert(aiUseCaseSystem).values(
            owned.map((system) => ({
              organizationId,
              useCaseId: useCase.id,
              systemId: system.id,
              riskTier: override.get(system.id)?.riskTier ?? null,
              oversightLevel: override.get(system.id)?.oversightLevel ?? null,
              oversightSummary: override.get(system.id)?.oversightSummary ?? null,
            })),
          );
        }
      }
    },
  );
}

/**
 * Take a use case off the register.
 *
 * Soft, audited, and **it does not touch the risks filed against it.** A risk
 * naming this use case stays on `/risks` with its own tombstone unset, because a
 * risk is a register row in its own right: hiding it here would make it vanish
 * from a register nobody deleted it from, with no trash entry to find it in. The
 * use case's *system* being deleted is the case that does hide dependants —
 * `readWorkspace` treats them as orphaned — and the difference is deliberate:
 * removing a system removes the thing every one of those records is about.
 *
 * The risk's link is left dangling on purpose for the retention window. That is
 * what a restore needs, and `purgeExpiredUseCases` is where the dangling ends.
 */
export async function deleteUseCase(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<void> {
  const before = await readUseCase(organizationId, id);
  if (!before) return;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "use_case",
        subjectId: id,
        action: "deleted the use case",
        field: "name",
        before: before.name,
        after: null,
      },
    ],
    async () => {
      await db
        .update(aiUseCase)
        .set({
          deletedAt: new Date(),
          deletedBy: actor.userId || null,
          version: before.version === undefined ? 1 : before.version + 1,
        })
        .where(and(eq(aiUseCase.organizationId, organizationId), eq(aiUseCase.id, id)));
    },
  );
}

/** The trash, for use cases. See `readDeletedAiRisks` for why this is concrete. */
export async function readDeletedUseCases(
  organizationId: string,
): Promise<DeletedUseCase[]> {
  try {
    const rows = await db
      .select()
      .from(aiUseCase)
      .where(
        and(eq(aiUseCase.organizationId, organizationId), isNotNull(aiUseCase.deletedAt)),
      )
      .orderBy(desc(aiUseCase.deletedAt));

    /* A soft delete does not tombstone the links, so a removed use case still
     * knows which systems it reached — which is what makes a restore put it
     * back where it was rather than nowhere. */
    const links = await db
      .select()
      .from(aiUseCaseSystem)
      .where(eq(aiUseCaseSystem.organizationId, organizationId));

    const systems = new Map<string, string[]>();
    for (const link of links) {
      const list = systems.get(link.useCaseId) ?? [];
      list.push(link.systemId);
      systems.set(link.useCaseId, list);
    }

    return rows.map((row) => ({
      ...toUseCase(row, systems.get(row.id) ?? []),
      deletedAt: (row.deletedAt as Date).toISOString(),
      deletedBy: row.deletedBy,
    }));
  } catch (err) {
    console.error("[ai-store] deleted use case read failed", err);
    return [];
  }
}

/**
 * Put a removed use case back.
 *
 * Clears the tombstone and nothing else — not a call to `saveUseCase`, for the
 * reason `restoreAiRisk` is not a call to `saveAiRisk`: a restore is not an edit,
 * so it does not bump `version` and it does not rebuild the record from a row it
 * is only making visible again. The risks that named it find it again by having
 * never stopped naming it.
 */
export async function restoreUseCase(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<boolean> {
  const [row] = await db
    .select({ name: aiUseCase.name, deletedAt: aiUseCase.deletedAt })
    .from(aiUseCase)
    .where(and(eq(aiUseCase.organizationId, organizationId), eq(aiUseCase.id, id)))
    .limit(1);

  if (!row || !row.deletedAt) return false;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "use_case",
        subjectId: id,
        action: "restored the use case",
        field: "name",
        before: null,
        after: row.name,
      },
    ],
    async () => {
      await db
        .update(aiUseCase)
        .set({ deletedAt: null, deletedBy: null })
        .where(and(eq(aiUseCase.organizationId, organizationId), eq(aiUseCase.id, id)));
    },
  );

  return true;
}

/**
 * Permanently remove the use cases whose retention window has run out.
 *
 * Org-scoped and looped by the cron, like every other purge.
 *
 * **This one clears references nothing cascades from**, which is the whole
 * reason it is more than a delete. `ai_risk.use_case_id` and
 * `ai_assessment.use_case_id` are plain text columns with no foreign key into
 * this table — deliberately, because both records outlive the use case they
 * mention. Left alone they would point at an id that no longer exists, and the
 * register would render a use case column that resolves to nothing for a row
 * whose history no longer explains why. Nulling them is the honest end state: the
 * risk is still a risk, filed against the system, and the trail says what it used
 * to name.
 *
 * The clears run *before* the delete so a failure leaves rows pointing at a use
 * case that still exists, rather than at one that does not.
 */
export async function purgeExpiredUseCases(
  organizationId: string,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<{ id: string; name: string }[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const expired = await db
    .select({ id: aiUseCase.id, name: aiUseCase.name })
    .from(aiUseCase)
    .where(
      and(
        eq(aiUseCase.organizationId, organizationId),
        isNotNull(aiUseCase.deletedAt),
        lt(aiUseCase.deletedAt, cutoff),
      ),
    );

  if (expired.length === 0) return [];

  const ids = expired.map((row) => row.id);

  await audited(
    organizationId,
    SYSTEM_ACTOR,
    expired.map((row) => ({
      subjectKind: "use_case" as const,
      subjectId: row.id,
      action: "permanently removed the use case after its retention window",
      field: "name",
      before: row.name,
      after: null,
    })),
    async () => {
      /* Scoped by organisation as well as by id, like every link clear in this
       * file: without it, knowing an id is enough to blank another tenant's
       * column. */
      await db
        .update(aiRisk)
        .set({ useCaseId: null })
        .where(
          and(eq(aiRisk.organizationId, organizationId), inArray(aiRisk.useCaseId, ids)),
        );

      await db
        .update(aiAssessment)
        .set({ useCaseId: null })
        .where(
          and(
            eq(aiAssessment.organizationId, organizationId),
            inArray(aiAssessment.useCaseId, ids),
          ),
        );

      await db
        .delete(aiUseCase)
        .where(
          and(eq(aiUseCase.organizationId, organizationId), inArray(aiUseCase.id, ids)),
        );
    },
  );

  return expired;
}

/** Which organisations have use cases past the window. See the risks twin. */
export async function organizationIdsWithExpiredUseCases(
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<string[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const rows = await db
    .selectDistinct({ organizationId: aiUseCase.organizationId })
    .from(aiUseCase)
    .where(and(isNotNull(aiUseCase.deletedAt), lt(aiUseCase.deletedAt, cutoff)));

  return rows.map((row) => row.organizationId);
}

/* ------------------------------------------------------------------ intake */

function toRequest(row: typeof aiIntakeRequest.$inferSelect): IntakeRequest {
  return {
    id: row.id,
    reference: row.reference,
    submission: row.submission as unknown as IntakeRequest["submission"],
    submittedById: row.submittedById ?? "",
    submittedAt: row.submittedAt,
    status: row.status as IntakeRequest["status"],
    reviewerId: row.reviewerId ?? "",
    reviewType: row.reviewType as IntakeRequest["reviewType"],
    overrideJustification: row.overrideJustification,
    decision: row.decision,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt,
    comments: row.comments,
    createdSystemId: row.createdSystemId,
  };
}

export async function readIntakeRequests(
  organizationId: string,
): Promise<IntakeRequest[]> {
  try {
    const rows = await db
      .select()
      .from(aiIntakeRequest)
      .where(
        and(
          eq(aiIntakeRequest.organizationId, organizationId),
          isNull(aiIntakeRequest.deletedAt),
        ),
      )
      .orderBy(desc(aiIntakeRequest.submittedAt));
    return rows.map(toRequest);
  } catch (err) {
    console.error("[ai-store] intake read failed", err);
    return [];
  }
}

export async function readIntakeRequest(
  organizationId: string,
  id: string,
): Promise<IntakeRequest | null> {
  try {
    const [row] = await db
      .select()
      .from(aiIntakeRequest)
      .where(
        and(
          eq(aiIntakeRequest.organizationId, organizationId),
          eq(aiIntakeRequest.id, id),
          // Without this a removed request is still decidable by typing its
          // URL, and the queue would be saying two things about one row.
          isNull(aiIntakeRequest.deletedAt),
        ),
      )
      .limit(1);
    return row ? toRequest(row) : null;
  } catch (err) {
    console.error("[ai-store] intake read failed", err);
    return null;
  }
}

export async function saveIntakeRequest(
  organizationId: string,
  request: IntakeRequest,
  actor: Actor,
): Promise<void> {
  const before = await readIntakeRequest(organizationId, request.id);
  const values = {
    id: request.id,
    organizationId,
    reference: request.reference,
    submission: request.submission as unknown as Record<string, unknown>,
    submittedById: request.submittedById || null,
    submittedAt: request.submittedAt,
    status: request.status,
    reviewerId: request.reviewerId || null,
    reviewType: request.reviewType,
    overrideJustification: request.overrideJustification,
    decision: request.decision,
    decidedById: request.decidedById,
    decidedAt: request.decidedAt,
    comments: request.comments,
    createdSystemId: request.createdSystemId,
  };

  await audited(
    organizationId,
    actor,
    intakeEntries(before, request),
    async () => {
      await db
        .insert(aiIntakeRequest)
        .values(values)
        .onConflictDoUpdate({
          target: [aiIntakeRequest.organizationId, aiIntakeRequest.id],
          set: values,
        });
    },
  );
}

/**
 * What changed about a request, one answer at a time.
 *
 * `submission` is a `jsonb` column holding ten fields and a bag of answers, so
 * the plain top-level diff every other register uses would record a correction
 * as one entry reading `submission: {…} → {…}`: technically a record of the
 * change and useless to the person reading it. The whole argument for an
 * editable request is that the queue can be corrected without losing what it
 * said before, and that only holds if the trail names the field.
 *
 * `originAnswers` is opened one level further for the same reason. It is where
 * "the vendor trains on our data" lives, and that is a triage rule's input —
 * seeing it move from `yes` to `no` is the entry somebody comes looking for.
 * Nothing goes deeper: the answers are scalars and short lists by schema.
 */
function intakeEntries(
  before: IntakeRequest | null,
  after: IntakeRequest,
): AuditEntry[] {
  if (!before) {
    return [
      {
        subjectKind: "intake_request",
        subjectId: after.id,
        action: "submitted an intake request",
      },
    ];
  }

  const { submission: was, ...wasRest } = before;
  const { submission: now, ...nowRest } = after;
  const { originAnswers: wasAnswers, ...wasFields } = was;
  const { originAnswers: nowAnswers, ...nowFields } = now;

  return changeEntries("intake_request", after.id, "changed the intake request", [
    ...describeChanges(wasRest, nowRest),
    ...describeChanges(wasFields, nowFields),
    /* Both bags' keys, not just the incoming ones: an origin change clears the
     * old answers, and an answer that vanished is exactly the movement the
     * trail has to hold — the record no longer says what it was. */
    ...describeChanges(wasAnswers, nowAnswers, [
      ...new Set([...Object.keys(wasAnswers), ...Object.keys(nowAnswers)]),
    ]),
  ]);
}

/**
 * Every note on one request, oldest first.
 *
 * **Oldest first, unlike every other read in this file**, and deliberately: the
 * activity trail is a log you scan from the top for the latest thing, while
 * notes are a conversation and a conversation read newest-first is one nobody
 * can follow. The index is ordered to match.
 *
 * Scoped by request rather than by organisation, because nothing wants every
 * note a tenant has ever written — the one screen that renders these is looking
 * at one request. `readWorkspace` loads them only when a page asks, the same way
 * it loads an activity trail.
 */
export async function readIntakeNotes(
  organizationId: string,
  requestId: string,
): Promise<IntakeNote[]> {
  try {
    const rows = await db
      .select()
      .from(aiIntakeNote)
      .where(
        and(
          eq(aiIntakeNote.organizationId, organizationId),
          eq(aiIntakeNote.requestId, requestId),
        ),
      )
      .orderBy(aiIntakeNote.createdAt);

    return rows.map((row) => ({
      id: row.id,
      requestId: row.requestId,
      authorId: row.authorId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[ai-store] intake note read failed", err);
    return [];
  }
}

/**
 * Add one note to a request.
 *
 * **An insert, never an upsert**, which is the one place this file departs from
 * its own rule. Everything else here upserts on `(organizationId, id)` so a
 * re-import corrects a row rather than duplicating it; a note has nothing to
 * correct, and an upsert would be a way to rewrite one by resending its id.
 * `saveIntakeNote` cannot overwrite: a repeated id is a primary key violation
 * and the caller mints a fresh one per note.
 *
 * The request is resolved inside this organisation first. The composite foreign
 * key would refuse a note aimed at another tenant's request anyway, but as a
 * constraint violation rather than an answer — and a soft-deleted request is in
 * the trash, which the key cannot see and a note must not be added to.
 */
export async function saveIntakeNote(
  organizationId: string,
  note: IntakeNote,
  actor: Actor,
): Promise<boolean> {
  const parent = await readIntakeRequest(organizationId, note.requestId);
  if (!parent) return false;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "intake_request",
        subjectId: note.requestId,
        action: "added a note to the intake request",
        field: null,
        before: null,
        after: note.body,
      },
    ],
    async () => {
      await db.insert(aiIntakeNote).values({
        id: note.id,
        organizationId,
        requestId: note.requestId,
        authorId: note.authorId,
        body: note.body,
        createdAt: new Date(note.createdAt),
      });
    },
  );

  return true;
}

/**
 * Every reference this organisation has issued, tombstoned rows included.
 *
 * Its own narrow query rather than a field on the register read, because
 * `readIntakeRequests` filters the trash out and the unique index does not.
 * A reference quoted in an email must never later belong to a different
 * request, so allocating the next one has to see the removed ones too.
 */
export async function allIntakeReferences(
  organizationId: string,
): Promise<string[]> {
  try {
    const rows = await db
      .select({ reference: aiIntakeRequest.reference })
      .from(aiIntakeRequest)
      .where(eq(aiIntakeRequest.organizationId, organizationId));

    return rows.map((row) => row.reference);
  } catch (err) {
    console.error("[ai-store] intake reference read failed", err);
    return [];
  }
}

/**
 * Remove a request from the queue.
 *
 * Soft. A request is somebody asking permission, and the queue is the record
 * that they asked — "we were never told about that tool" is the answer a hard
 * delete would make true, and shadow AI being written down by whoever notices
 * it is the whole argument for having a queue.
 */
export async function deleteIntakeRequest(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<void> {
  const before = await readIntakeRequest(organizationId, id);
  if (!before) return;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "intake_request",
        subjectId: id,
        action: "deleted the intake request",
        field: "reference",
        before: before.reference,
        after: null,
      },
    ],
    async () => {
      await db
        .update(aiIntakeRequest)
        .set({ deletedAt: new Date(), deletedBy: actor.userId || null })
        .where(
          and(
            eq(aiIntakeRequest.organizationId, organizationId),
            eq(aiIntakeRequest.id, id),
          ),
        );
    },
  );
}

/** The trash, for intake requests. */
export async function readDeletedIntakeRequests(
  organizationId: string,
): Promise<DeletedIntakeRequest[]> {
  try {
    const rows = await db
      .select()
      .from(aiIntakeRequest)
      .where(
        and(
          eq(aiIntakeRequest.organizationId, organizationId),
          isNotNull(aiIntakeRequest.deletedAt),
        ),
      )
      .orderBy(desc(aiIntakeRequest.deletedAt));

    return rows.map((row) => ({
      ...toRequest(row),
      deletedAt: (row.deletedAt as Date).toISOString(),
      deletedBy: row.deletedBy,
    }));
  } catch (err) {
    console.error("[ai-store] deleted intake read failed", err);
    return [];
  }
}

/** Clear the tombstone. The reference was never released, so it comes back its own. */
export async function restoreIntakeRequest(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<boolean> {
  const [row] = await db
    .select({
      reference: aiIntakeRequest.reference,
      deletedAt: aiIntakeRequest.deletedAt,
    })
    .from(aiIntakeRequest)
    .where(
      and(
        eq(aiIntakeRequest.organizationId, organizationId),
        eq(aiIntakeRequest.id, id),
      ),
    )
    .limit(1);

  if (!row || !row.deletedAt) return false;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "intake_request",
        subjectId: id,
        action: "restored the intake request",
        field: "reference",
        before: null,
        after: row.reference,
      },
    ],
    async () => {
      await db
        .update(aiIntakeRequest)
        .set({ deletedAt: null, deletedBy: null })
        .where(
          and(
            eq(aiIntakeRequest.organizationId, organizationId),
            eq(aiIntakeRequest.id, id),
          ),
        );
    },
  );

  return true;
}

/**
 * Permanently remove the requests whose retention window has run out.
 *
 * Nothing hangs off a request — `createdSystemId` points *outward* at an
 * inventory row, which stays: the system exists whether or not the request that
 * proposed it does. This is the one purge in the product that removes a row and
 * nothing else, and the reference it was holding is released with it.
 */
export async function purgeExpiredIntakeRequests(
  organizationId: string,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<{ id: string; reference: string }[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const expired = await db
    .select({ id: aiIntakeRequest.id, reference: aiIntakeRequest.reference })
    .from(aiIntakeRequest)
    .where(
      and(
        eq(aiIntakeRequest.organizationId, organizationId),
        isNotNull(aiIntakeRequest.deletedAt),
        lt(aiIntakeRequest.deletedAt, cutoff),
      ),
    );

  if (expired.length === 0) return [];

  const ids = expired.map((row) => row.id);

  await audited(
    organizationId,
    SYSTEM_ACTOR,
    expired.map((row) => ({
      subjectKind: "intake_request" as const,
      subjectId: row.id,
      action: "permanently removed the intake request after its retention window",
      field: "reference",
      before: row.reference,
      after: null,
    })),
    async () => {
      await db
        .delete(aiIntakeRequest)
        .where(
          and(
            eq(aiIntakeRequest.organizationId, organizationId),
            inArray(aiIntakeRequest.id, ids),
          ),
        );
    },
  );

  return expired;
}

/** Every organisation with a request overdue for purging. */
export async function organizationIdsWithExpiredIntakeRequests(
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<string[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const rows = await db
    .selectDistinct({ organizationId: aiIntakeRequest.organizationId })
    .from(aiIntakeRequest)
    .where(
      and(isNotNull(aiIntakeRequest.deletedAt), lt(aiIntakeRequest.deletedAt, cutoff)),
    );

  return rows.map((row) => row.organizationId);
}

/* --------------------------------------------------------------- framework */

export interface FrameworkBundle {
  framework: Framework | null;
  nodes: FrameworkNode[];
  controls: FrameworkControl[];
}

/**
 * A framework and its whole tree in one read.
 *
 * Returned together because every caller wants all three: the SoA renders the
 * tree beside the controls, and fetching them separately would mean three
 * round trips for one screen that is useless with any of them missing.
 */
export async function readFramework(
  organizationId: string,
  frameworkId: string,
): Promise<FrameworkBundle> {
  const empty: FrameworkBundle = { framework: null, nodes: [], controls: [] };
  try {
    const [fw] = await db
      .select()
      .from(aiFramework)
      .where(
        and(eq(aiFramework.organizationId, organizationId), eq(aiFramework.id, frameworkId)),
      )
      .limit(1);
    if (!fw) return empty;

    const nodes = await db
      .select()
      .from(aiFrameworkNode)
      .where(
        and(
          eq(aiFrameworkNode.organizationId, organizationId),
          eq(aiFrameworkNode.frameworkId, frameworkId),
        ),
      )
      .orderBy(asc(aiFrameworkNode.position));

    const controls = await db
      .select()
      .from(aiControl)
      .where(
        and(
          eq(aiControl.organizationId, organizationId),
          eq(aiControl.frameworkId, frameworkId),
        ),
      )
      .orderBy(asc(aiControl.position));

    return {
      framework: {
        id: fw.id,
        name: fw.name,
        shortName: fw.shortName,
        description: fw.description,
        version: fw.version,
      },
      nodes: nodes.map((n) => ({
        id: n.id,
        frameworkId: n.frameworkId,
        officialRef: n.officialRef,
        parentId: n.parentId,
        kind: n.kind as FrameworkNode["kind"],
        shortTitle: n.shortTitle,
      })),
      controls: controls.map((c) => ({
        id: c.id,
        frameworkId: c.frameworkId,
        nodeId: c.nodeId,
        officialRef: c.officialRef,
        shortTitle: c.shortTitle,
        requirementSummary: c.requirementSummary,
        evidenceGuidance: c.evidenceGuidance,
        developmentOnly: c.developmentOnly,
      })),
    };
  } catch (err) {
    console.error("[ai-store] framework read failed", err);
    return empty;
  }
}

/* ---------------------------------------------------------- applicability */

export async function readApplicability(
  organizationId: string,
  frameworkId: string,
): Promise<ControlApplicability[]> {
  try {
    const rows = await db
      .select()
      .from(aiApplicability)
      .where(
        and(
          eq(aiApplicability.organizationId, organizationId),
          eq(aiApplicability.frameworkId, frameworkId),
        ),
      )
      .orderBy(asc(aiApplicability.controlId));

    const systems = await db
      .select()
      .from(aiApplicabilitySystem)
      .where(
        and(
          eq(aiApplicabilitySystem.organizationId, organizationId),
          eq(aiApplicabilitySystem.frameworkId, frameworkId),
        ),
      );

    const evidence = await db
      .select()
      .from(aiEvidenceLink)
      .where(
        and(
          eq(aiEvidenceLink.organizationId, organizationId),
          eq(aiEvidenceLink.targetKind, "control"),
        ),
      );

    const bySystem = new Map<string, string[]>();
    for (const link of systems) {
      const list = bySystem.get(link.controlId) ?? [];
      list.push(link.systemId);
      bySystem.set(link.controlId, list);
    }

    const byEvidence = new Map<string, string[]>();
    for (const link of evidence) {
      const list = byEvidence.get(link.targetId) ?? [];
      list.push(link.evidenceId);
      byEvidence.set(link.targetId, list);
    }

    return rows.map((row) => ({
      frameworkId: row.frameworkId,
      controlId: row.controlId,
      applicability: row.applicability as ControlApplicability["applicability"],
      justification: row.justification,
      implementationStatus:
        row.implementationStatus as ControlApplicability["implementationStatus"],
      ownerId: row.ownerId,
      linkedPolicyId: row.linkedPolicyId,
      linkedEvidenceIds: byEvidence.get(row.controlId) ?? [],
      appliesToSystemIds: bySystem.get(row.controlId) ?? [],
      lastReviewedAt: row.lastReviewedAt,
    }));
  } catch (err) {
    console.error("[ai-store] applicability read failed", err);
    return [];
  }
}

/**
 * Write one Statement of Applicability row.
 *
 * The system claims are **replaced, not merged** — the caller sends the complete
 * set it wants, in the same convention `store.ts` uses for control links. The
 * delete is scoped by organization as well as by control, because without it,
 * knowing a control id would be enough to clear another tenant's claims.
 */
export async function saveApplicability(
  organizationId: string,
  row: ControlApplicability,
  actor: Actor,
): Promise<void> {
  /* Read through the list rather than the row: the claimed systems and linked
   * evidence live in join tables, and an audit entry that missed them would say
   * a control was unchanged on the save that widened its scope. */
  const before =
    (await readApplicability(organizationId, row.frameworkId)).find(
      (r) => r.controlId === row.controlId,
    ) ?? null;
  const values = {
    organizationId,
    frameworkId: row.frameworkId,
    controlId: row.controlId,
    applicability: row.applicability,
    justification: row.justification,
    implementationStatus: row.implementationStatus,
    ownerId: row.ownerId,
    linkedPolicyId: row.linkedPolicyId,
    lastReviewedAt: row.lastReviewedAt,
  };

  await audited(
    organizationId,
    actor,
    upsertEntries(
      "applicability",
      row.controlId,
      {
        created: "claimed the control",
        changed: "changed applicability",
      },
      before,
      row,
    ),
    async () => {
      await db
        .insert(aiApplicability)
        .values(values)
        .onConflictDoUpdate({
          target: [
            aiApplicability.organizationId,
            aiApplicability.frameworkId,
            aiApplicability.controlId,
          ],
          set: values,
        });

      await db
        .delete(aiApplicabilitySystem)
        .where(
          and(
            eq(aiApplicabilitySystem.organizationId, organizationId),
            eq(aiApplicabilitySystem.frameworkId, row.frameworkId),
            eq(aiApplicabilitySystem.controlId, row.controlId),
          ),
        );

      if (row.appliesToSystemIds.length > 0) {
        /* Filter through the org's own systems so a stale id cannot create a
         * dangling claim, and so an id from another tenant is simply dropped. */
        const owned = await db
          .select({ id: aiSystem.id })
          .from(aiSystem)
          .where(
            and(
              eq(aiSystem.organizationId, organizationId),
              inArray(aiSystem.id, row.appliesToSystemIds),
            ),
          );

        if (owned.length > 0) {
          await db.insert(aiApplicabilitySystem).values(
            owned.map((s) => ({
              organizationId,
              frameworkId: row.frameworkId,
              controlId: row.controlId,
              systemId: s.id,
            })),
          );
        }
      }
    },
  );
}

/* ------------------------------------------------------------ assessments */

function toAssessment(
  row: typeof aiAssessment.$inferSelect,
  answers: Record<string, unknown>,
): AssessmentInstance {
  return {
    id: row.id,
    templateId: row.templateId,
    systemId: row.systemId,
    useCaseId: row.useCaseId,
    status: row.status as AssessmentInstance["status"],
    answers,
    signOff: (row.signOff ?? []) as unknown as SignOffStep[],
    updatedAt: row.updatedAt.toISOString().slice(0, 10),
    dueAt: row.dueAt,
  };
}

export async function readAssessments(
  organizationId: string,
): Promise<AssessmentInstance[]> {
  try {
    const rows = await db
      .select()
      .from(aiAssessment)
      .where(
        and(
          eq(aiAssessment.organizationId, organizationId),
          isNull(aiAssessment.deletedAt),
        ),
      )
      .orderBy(asc(aiAssessment.dueAt));

    const answers = await db
      .select()
      .from(aiAssessmentAnswer)
      .where(eq(aiAssessmentAnswer.organizationId, organizationId));

    const byAssessment = new Map<string, Record<string, unknown>>();
    for (const a of answers) {
      const bag = byAssessment.get(a.assessmentId) ?? {};
      bag[a.fieldId] = a.value;
      byAssessment.set(a.assessmentId, bag);
    }

    return rows.map((row) => toAssessment(row, byAssessment.get(row.id) ?? {}));
  } catch (err) {
    console.error("[ai-store] assessment read failed", err);
    return [];
  }
}

export async function readAssessment(
  organizationId: string,
  id: string,
): Promise<AssessmentInstance | null> {
  const all = await readAssessments(organizationId);
  return all.find((a) => a.id === id) ?? null;
}

/**
 * Just the answers, for the audit diff on a partial save.
 *
 * Narrower than `readAssessment()` on purpose: `saveAssessmentAnswers()` writes
 * one field at a time and needs the stored value of *that* field to say what
 * moved. Going through the full assessment read would pull every answer in the
 * organization to compare one string.
 */
export async function readAssessmentAnswers(
  organizationId: string,
  assessmentId: string,
): Promise<Record<string, unknown>> {
  try {
    const rows = await db
      .select()
      .from(aiAssessmentAnswer)
      .where(
        and(
          eq(aiAssessmentAnswer.organizationId, organizationId),
          eq(aiAssessmentAnswer.assessmentId, assessmentId),
        ),
      );

    return Object.fromEntries(rows.map((row) => [row.fieldId, row.value]));
  } catch (err) {
    console.error("[ai-store] assessment answer read failed", err);
    return {};
  }
}

export async function saveAssessment(
  organizationId: string,
  assessment: AssessmentInstance,
  actor: Actor,
): Promise<void> {
  const before = await readAssessment(organizationId, assessment.id);
  const values = {
    id: assessment.id,
    organizationId,
    templateId: assessment.templateId,
    systemId: assessment.systemId,
    useCaseId: assessment.useCaseId,
    status: assessment.status,
    signOff: assessment.signOff as unknown as Record<string, unknown>[],
    dueAt: assessment.dueAt,
  };

  await audited(
    organizationId,
    actor,
    upsertEntries(
      "assessment",
      assessment.id,
      { created: "opened the impact assessment", changed: "changed the assessment" },
      before,
      assessment,
    ),
    async () => {
      await db
        .insert(aiAssessment)
        .values(values)
        .onConflictDoUpdate({
          target: [aiAssessment.organizationId, aiAssessment.id],
          set: values,
        });
    },
  );
}

/**
 * Write answers, and reset any review a material change invalidates.
 *
 * This is one of the two places a write invalidates a human judgement, and it is
 * the same rule the mockup enforces on screen: a reviewer endorsed a document
 * with a particular set of questions in it, and changing an answer that decides
 * *which sections exist* means they reviewed something else. Carrying the
 * endorsement forward silently is how a signature ends up attached to questions
 * nobody read.
 *
 * Non-material edits do not reset anything — resetting an approval because
 * somebody fixed a typo teaches owners not to fix typos.
 */
export async function saveAssessmentAnswers(
  organizationId: string,
  assessmentId: string,
  answers: Record<string, unknown>,
  actor: Actor,
  options: { materialChange?: boolean } = {},
): Promise<void> {
  const owned = await db
    .select({ id: aiAssessment.id, signOff: aiAssessment.signOff })
    .from(aiAssessment)
    .where(
      and(eq(aiAssessment.organizationId, organizationId), eq(aiAssessment.id, assessmentId)),
    )
    .limit(1);

  if (owned.length === 0) return;

  const entries = Object.entries(answers);

  /* Answers are audited per field, because a field is the unit a reviewer
   * endorsed. `before` comes from the stored answers rather than the caller's
   * object so a partial save — the usual case, one field at a time — does not
   * report every other answer as having been cleared. */
  const previous = await readAssessmentAnswers(organizationId, assessmentId);
  await audited(
    organizationId,
    actor,
    changeEntries(
      "assessment",
      assessmentId,
      options.materialChange ? "changed a material answer" : "changed an answer",
      describeChanges(previous, Object.fromEntries(entries), Object.keys(answers)),
    ),
    async () => {
      if (entries.length > 0) {
        for (const [fieldId, value] of entries) {
          const values = {
            organizationId,
            assessmentId,
            fieldId,
            value: value as Record<string, unknown>,
          };
          await db
            .insert(aiAssessmentAnswer)
            .values(values)
            .onConflictDoUpdate({
              target: [
                aiAssessmentAnswer.organizationId,
                aiAssessmentAnswer.assessmentId,
                aiAssessmentAnswer.fieldId,
              ],
              set: { value: values.value },
            });
        }
      }

      if (options.materialChange) {
        const steps = (owned[0].signOff ?? []) as unknown as SignOffStep[];
        const reset = steps.map((step, i) =>
          i === 0
            ? { ...step, state: "current" as const, completedAt: null }
            : { ...step, state: "pending" as const, completedAt: null },
        );
        await db
          .update(aiAssessment)
          .set({ signOff: reset as unknown as Record<string, unknown>[] })
          .where(
            and(
              eq(aiAssessment.organizationId, organizationId),
              eq(aiAssessment.id, assessmentId),
            ),
          );

        /* The reset is its own event. Somebody's endorsement was discarded here, and
         * an auditor asking why a signature disappeared has to be able to find the
         * answer without inferring it from the answer change beside it. */
        const discarded = steps.filter((step) => step.state === "complete").length;
        if (discarded > 0) {
          await writeAudit(organizationId, actor, [
            {
              subjectKind: "assessment",
              subjectId: assessmentId,
              action: "reset the sign-off chain after a material change",
              field: "signOff",
              before: `${discarded} completed`,
              after: "0 completed",
            },
          ]);
        }
      }
    },
  );
}

/**
 * Remove an impact assessment from the register.
 *
 * Soft. An assessment carries the answers somebody gave and the signatures
 * somebody put against them, and it is the record a regulator asks for by name
 * — so the fact of its removal has to survive it, or "we assessed that system
 * in February" and "there is no assessment" are both true and neither is
 * checkable.
 *
 * The answers are left alone. They cascade at the foreign key when the row is
 * finally purged, and until then they are simply unreachable — which is what
 * lets a restore bring back the assessment as it was answered rather than as an
 * empty form.
 */
export async function deleteAssessment(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<void> {
  const before = await readAssessment(organizationId, id);
  if (!before) return;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "assessment",
        subjectId: id,
        action: "deleted the assessment",
        field: "status",
        before: before.status,
        after: null,
      },
    ],
    async () => {
      await db
        .update(aiAssessment)
        .set({ deletedAt: new Date(), deletedBy: actor.userId || null })
        .where(
          and(eq(aiAssessment.organizationId, organizationId), eq(aiAssessment.id, id)),
        );
    },
  );
}

/** The trash, for assessments. Answers come along so a restore is whole. */
export async function readDeletedAssessments(
  organizationId: string,
): Promise<DeletedAssessment[]> {
  try {
    const rows = await db
      .select()
      .from(aiAssessment)
      .where(
        and(
          eq(aiAssessment.organizationId, organizationId),
          isNotNull(aiAssessment.deletedAt),
        ),
      )
      .orderBy(desc(aiAssessment.deletedAt));

    const answers = await db
      .select()
      .from(aiAssessmentAnswer)
      .where(eq(aiAssessmentAnswer.organizationId, organizationId));

    const byAssessment = new Map<string, Record<string, unknown>>();
    for (const a of answers) {
      const bag = byAssessment.get(a.assessmentId) ?? {};
      bag[a.fieldId] = a.value;
      byAssessment.set(a.assessmentId, bag);
    }

    return rows.map((row) => ({
      ...toAssessment(row, byAssessment.get(row.id) ?? {}),
      deletedAt: (row.deletedAt as Date).toISOString(),
      deletedBy: row.deletedBy,
    }));
  } catch (err) {
    console.error("[ai-store] deleted assessment read failed", err);
    return [];
  }
}

/**
 * Clear the tombstone.
 *
 * **The sign-off chain is not reset.** A restore is not an edit — nobody
 * changed an answer — so the signatures that were valid before it was removed
 * are valid after. Resetting them would be this function inventing a material
 * change, which is the one thing `saveAssessmentAnswers` is careful never to do
 * over a typo.
 */
export async function restoreAssessment(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<boolean> {
  const [row] = await db
    .select({ status: aiAssessment.status, deletedAt: aiAssessment.deletedAt })
    .from(aiAssessment)
    .where(and(eq(aiAssessment.organizationId, organizationId), eq(aiAssessment.id, id)))
    .limit(1);

  if (!row || !row.deletedAt) return false;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "assessment",
        subjectId: id,
        action: "restored the assessment",
        field: "status",
        before: null,
        after: row.status,
      },
    ],
    async () => {
      await db
        .update(aiAssessment)
        .set({ deletedAt: null, deletedBy: null })
        .where(
          and(eq(aiAssessment.organizationId, organizationId), eq(aiAssessment.id, id)),
        );
    },
  );

  return true;
}

/**
 * Permanently remove the assessments whose retention window has run out.
 *
 * Answers cascade at the foreign key. **Review assignments do not** — they are
 * keyed by `(organization, subjectKind, subjectId, stage)` with no constraint
 * into any table, which is what lets one shape serve assessments, systems and
 * policies alike. So the sign-off assignments naming a purged assessment are
 * removed explicitly; without that they would sit in the table forever, and
 * "who was assigned to approve this" would keep answering about a record
 * nothing else can find.
 */
export async function purgeExpiredAssessments(
  organizationId: string,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<{ id: string; status: string }[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const expired = await db
    .select({ id: aiAssessment.id, status: aiAssessment.status })
    .from(aiAssessment)
    .where(
      and(
        eq(aiAssessment.organizationId, organizationId),
        isNotNull(aiAssessment.deletedAt),
        lt(aiAssessment.deletedAt, cutoff),
      ),
    );

  if (expired.length === 0) return [];

  const ids = expired.map((row) => row.id);

  await audited(
    organizationId,
    SYSTEM_ACTOR,
    expired.map((row) => ({
      subjectKind: "assessment" as const,
      subjectId: row.id,
      action: "permanently removed the assessment after its retention window",
      field: "status",
      before: row.status,
      after: null,
    })),
    async () => {
      await db
        .delete(aiReviewAssignment)
        .where(
          and(
            eq(aiReviewAssignment.organizationId, organizationId),
            eq(aiReviewAssignment.subjectKind, "assessment"),
            inArray(aiReviewAssignment.subjectId, ids),
          ),
        );

      // Last, so the rows above could still be found by the ids they name.
      // The answers go with it at the foreign key.
      await db
        .delete(aiAssessment)
        .where(
          and(
            eq(aiAssessment.organizationId, organizationId),
            inArray(aiAssessment.id, ids),
          ),
        );
    },
  );

  return expired;
}

/** Every organisation with an assessment overdue for purging. */
export async function organizationIdsWithExpiredAssessments(
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<string[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const rows = await db
    .selectDistinct({ organizationId: aiAssessment.organizationId })
    .from(aiAssessment)
    .where(and(isNotNull(aiAssessment.deletedAt), lt(aiAssessment.deletedAt, cutoff)));

  return rows.map((row) => row.organizationId);
}

/* ------------------------------------------------------------------ risks */

function toRisk(row: typeof aiRisk.$inferSelect, controlIds: string[]): Risk {
  return {
    id: row.id,
    title: row.title,
    systemId: row.systemId,
    useCaseId: row.useCaseId,
    controlIds,
    inherentLikelihood: row.inherentLikelihood as Risk["inherentLikelihood"],
    inherentImpact: row.inherentImpact as Risk["inherentImpact"],
    treatment: row.treatment as Risk["treatment"],
    treatmentSummary: row.treatmentSummary,
    residualLikelihood: row.residualLikelihood as Risk["residualLikelihood"],
    residualImpact: row.residualImpact as Risk["residualImpact"],
    ownerId: row.ownerId ?? "",
    status: row.status as Risk["status"],
    acceptedById: row.acceptedById,
    acceptedAt: row.acceptedAt,
    version: row.version,
  };
}

export async function readAiRisks(organizationId: string): Promise<Risk[]> {
  try {
    const rows = await db
      .select()
      .from(aiRisk)
      .where(and(eq(aiRisk.organizationId, organizationId), isNull(aiRisk.deletedAt)))
      .orderBy(desc(aiRisk.createdAt));

    const links = await db
      .select()
      .from(aiRiskControl)
      .where(eq(aiRiskControl.organizationId, organizationId));

    const byRisk = new Map<string, string[]>();
    for (const link of links) {
      const list = byRisk.get(link.riskId) ?? [];
      list.push(link.controlId);
      byRisk.set(link.riskId, list);
    }

    return rows.map((row) => toRisk(row, byRisk.get(row.id) ?? []));
  } catch (err) {
    console.error("[ai-store] risk read failed", err);
    return [];
  }
}

export async function readAiRisk(
  organizationId: string,
  id: string,
): Promise<Risk | null> {
  const all = await readAiRisks(organizationId);
  return all.find((r) => r.id === id) ?? null;
}

/**
 * Write a risk, voiding an acceptance the new residual invalidates.
 *
 * The second of the two invalidating writes. Somebody accepted a specific
 * residual figure; move it and their signature is attached to a number they
 * never saw. The store enforces it rather than the caller, because this is the
 * one rule that must hold however the row arrives — including through a seed or
 * an import.
 */
export async function saveAiRisk(
  organizationId: string,
  risk: Risk,
  actor: Actor,
  options: { expectedVersion?: number } = {},
): Promise<void> {
  const previous = await readAiRisk(organizationId, risk.id);
  checkVersion(options.expectedVersion, previous?.version);
  const [existing] = await db
    .select()
    .from(aiRisk)
    .where(and(eq(aiRisk.organizationId, organizationId), eq(aiRisk.id, risk.id)))
    .limit(1);

  const residualMoved =
    existing !== undefined &&
    existing.residualLikelihood * existing.residualImpact !==
      risk.residualLikelihood * risk.residualImpact;

  const voided = residualMoved && Boolean(existing?.acceptedById);

  const values = {
    id: risk.id,
    organizationId,
    title: risk.title,
    systemId: risk.systemId,
    useCaseId: risk.useCaseId,
    inherentLikelihood: risk.inherentLikelihood,
    inherentImpact: risk.inherentImpact,
    treatment: risk.treatment,
    treatmentSummary: risk.treatmentSummary,
    residualLikelihood: risk.residualLikelihood,
    residualImpact: risk.residualImpact,
    ownerId: risk.ownerId || null,
    status: risk.status,
    acceptedById: voided ? null : risk.acceptedById,
    acceptedAt: voided ? null : risk.acceptedAt,
    /* Saving a record is asserting it exists, so an upsert lands on top of a
     * soft-deleted row by clearing the tombstone. Without this the row stays
     * invisible and the save appears to have silently done nothing — the id is
     * still taken, so the insert becomes an update, and the update leaves
     * `deleted_at` exactly where it was. */
    deletedAt: null,
    deletedBy: null,
    version: (previous?.version ?? 0) + 1,
  };

  await audited(
    organizationId,
    actor,
    [
    ...upsertEntries(
      "risk",
      risk.id,
      { created: "raised the risk", changed: "changed the risk" },
      previous,
      // Diff against what is actually being written, not what the caller asked
      // for: where the acceptance was voided below, `risk` still carries it and
      // the trail would claim an acceptance that no longer exists.
      { ...risk, acceptedById: values.acceptedById, acceptedAt: values.acceptedAt },
    ),
    /* The voiding is its own event, above and beyond the field changes. Somebody
     * accepted a specific residual figure, and the acceptance disappearing is
     * the part they need to be told about — inferring it from two rating fields
     * moving is not something anyone reviewing the register will do. */
    ...(voided
      ? [
          {
            subjectKind: "risk" as const,
            subjectId: risk.id,
            action: "voided the acceptance after a re-rating",
            field: "acceptedById",
            before: existing?.acceptedById ?? null,
            after: null,
          },
        ]
      : []),
  ],
    async () => {
      await db
        .insert(aiRisk)
        .values(values)
        .onConflictDoUpdate({ target: [aiRisk.organizationId, aiRisk.id], set: values });

      await db
        .delete(aiRiskControl)
        .where(
          and(eq(aiRiskControl.organizationId, organizationId), eq(aiRiskControl.riskId, risk.id)),
        );

      if (risk.controlIds.length > 0) {
        await db
          .insert(aiRiskControl)
          .values(
            risk.controlIds.map((controlId) => ({
              organizationId,
              riskId: risk.id,
              controlId,
            })),
          )
          .onConflictDoNothing();
      }
    },
  );
}

export async function deleteAiRisk(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<void> {
  const before = await readAiRisk(organizationId, id);
  if (!before) return;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "risk",
        subjectId: id,
        action: "deleted the risk",
        field: "title",
        before: before.title,
        after: null,
      },
    ],
    async () => {
      await db
        .update(aiRisk)
        .set({
          deletedAt: new Date(),
          deletedBy: actor.userId || null,
          version: before.version === undefined ? 1 : before.version + 1,
        })
        .where(and(eq(aiRisk.organizationId, organizationId), eq(aiRisk.id, id)));
    },
  );
}

/**
 * The trash, for risks.
 *
 * The same three functions systems have, and deliberately not a generalisation
 * of them. Each kind's tombstone lives on its own table with its own columns,
 * so a shared implementation would be a `switch` over table objects that reads
 * worse than the repetition and hides which tables actually have the columns.
 * `records.ts` is where the registers are made to look alike; here they stay
 * concrete.
 */
export async function readDeletedAiRisks(
  organizationId: string,
): Promise<DeletedRisk[]> {
  try {
    const rows = await db
      .select()
      .from(aiRisk)
      .where(and(eq(aiRisk.organizationId, organizationId), isNotNull(aiRisk.deletedAt)))
      .orderBy(desc(aiRisk.deletedAt));

    return rows.map((row) => ({
      ...toRisk(row, []),
      deletedAt: (row.deletedAt as Date).toISOString(),
      deletedBy: row.deletedBy,
    }));
  } catch (err) {
    console.error("[ai-store] deleted risk read failed", err);
    return [];
  }
}

/**
 * Put a removed risk back on the register.
 *
 * Clears the tombstone and nothing else — not a call to `saveAiRisk`, for the
 * reason `restoreAiSystem` is not a call to `saveAiSystem`: an upsert would
 * need the caller to rebuild a whole `Risk` from a row it is only restoring,
 * and would bump `version` for something that is not an edit.
 */
export async function restoreAiRisk(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<boolean> {
  const [row] = await db
    .select({ title: aiRisk.title, deletedAt: aiRisk.deletedAt })
    .from(aiRisk)
    .where(and(eq(aiRisk.organizationId, organizationId), eq(aiRisk.id, id)))
    .limit(1);

  if (!row || !row.deletedAt) return false;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "risk",
        subjectId: id,
        action: "restored the risk",
        field: "title",
        before: null,
        after: row.title,
      },
    ],
    async () => {
      await db
        .update(aiRisk)
        .set({ deletedAt: null, deletedBy: null })
        .where(and(eq(aiRisk.organizationId, organizationId), eq(aiRisk.id, id)));
    },
  );

  return true;
}

/**
 * Permanently remove the risks whose retention window has run out.
 *
 * Org-scoped and looped by the cron, like the systems purge and for the same
 * reason: a global `DELETE ... WHERE deleted_at <` is one missing clause from
 * emptying a tenant that was never in scope, for the one operation nothing can
 * undo.
 *
 * A risk's dependants cascade at the foreign key — `ai_risk_control` and
 * `ai_finding_risk_link` both name it — so there is nothing to remove by hand
 * here. The audit trail is untouched and must stay that way: it is what makes a
 * permanent delete defensible.
 */
export async function purgeExpiredRisks(
  organizationId: string,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<{ id: string; title: string }[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const expired = await db
    .select({ id: aiRisk.id, title: aiRisk.title })
    .from(aiRisk)
    .where(
      and(
        eq(aiRisk.organizationId, organizationId),
        isNotNull(aiRisk.deletedAt),
        lt(aiRisk.deletedAt, cutoff),
      ),
    );

  if (expired.length === 0) return [];

  const ids = expired.map((row) => row.id);

  await audited(
    organizationId,
    SYSTEM_ACTOR,
    expired.map((row) => ({
      subjectKind: "risk" as const,
      subjectId: row.id,
      action: "permanently removed the risk after its retention window",
      field: "title",
      before: row.title,
      after: null,
    })),
    async () => {
      await db
        .delete(aiRisk)
        .where(and(eq(aiRisk.organizationId, organizationId), inArray(aiRisk.id, ids)));
    },
  );

  return expired;
}

/** Every organisation with a risk overdue for purging. See the systems twin. */
export async function organizationIdsWithExpiredRisks(
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<string[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const rows = await db
    .selectDistinct({ organizationId: aiRisk.organizationId })
    .from(aiRisk)
    .where(and(isNotNull(aiRisk.deletedAt), lt(aiRisk.deletedAt, cutoff)));

  return rows.map((row) => row.organizationId);
}

/* --------------------------------------------------------------- findings */

function toFinding(row: typeof aiFinding.$inferSelect): Finding {
  return {
    id: row.id,
    title: row.title,
    severity: row.severity as Finding["severity"],
    status: row.status as Finding["status"],
    source: row.source as Finding["source"],
    raisedBy: row.raisedBy,
    raisedAt: row.raisedAt,
    dueAt: row.dueAt,
    ownerId: row.ownerId ?? "",
    systemId: row.systemId,
    controlId: row.controlId,
    summary: row.summary,
    rootCause: row.rootCause,
    correctiveAction: row.correctiveAction,
    verifiedById: row.verifiedById,
    verifiedAt: row.verifiedAt,
    verificationNote: row.verificationNote,
    closedAt: row.closedAt,
  };
}

export async function readAiFindings(organizationId: string): Promise<Finding[]> {
  try {
    const rows = await db
      .select()
      .from(aiFinding)
      .where(
        and(eq(aiFinding.organizationId, organizationId), isNull(aiFinding.deletedAt)),
      )
      .orderBy(asc(aiFinding.dueAt));
    return rows.map(toFinding);
  } catch (err) {
    console.error("[ai-store] finding read failed", err);
    return [];
  }
}

export async function readAiFinding(
  organizationId: string,
  id: string,
): Promise<Finding | null> {
  try {
    const [row] = await db
      .select()
      .from(aiFinding)
      .where(
        and(
          eq(aiFinding.organizationId, organizationId),
          eq(aiFinding.id, id),
          // Without this a removed finding is still reachable by typing its URL,
          // which is the register saying two different things about one row.
          isNull(aiFinding.deletedAt),
        ),
      )
      .limit(1);
    return row ? toFinding(row) : null;
  } catch (err) {
    console.error("[ai-store] finding read failed", err);
    return null;
  }
}

export async function saveAiFinding(
  organizationId: string,
  finding: Finding,
  actor: Actor,
): Promise<void> {
  const before = await readAiFinding(organizationId, finding.id);
  const values = {
    id: finding.id,
    organizationId,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    source: finding.source,
    raisedBy: finding.raisedBy,
    raisedAt: finding.raisedAt,
    dueAt: finding.dueAt,
    ownerId: finding.ownerId || null,
    systemId: finding.systemId,
    controlId: finding.controlId,
    summary: finding.summary,
    rootCause: finding.rootCause,
    correctiveAction: finding.correctiveAction,
    verifiedById: finding.verifiedById,
    verifiedAt: finding.verifiedAt,
    verificationNote: finding.verificationNote,
    closedAt: finding.closedAt,
  };

  await audited(
    organizationId,
    actor,
    upsertEntries(
      "finding",
      finding.id,
      { created: "raised a finding", changed: "changed the finding" },
      before,
      finding,
    ),
    async () => {
      await db
        .insert(aiFinding)
        .values(values)
        .onConflictDoUpdate({
          target: [aiFinding.organizationId, aiFinding.id],
          set: values,
        });
    },
  );
}

export async function readFindingRiskLinks(
  organizationId: string,
): Promise<FindingRiskLink[]> {
  try {
    const rows = await db
      .select()
      .from(aiFindingRisk)
      .where(eq(aiFindingRisk.organizationId, organizationId));
    return rows.map((row) => ({
      findingId: row.findingId,
      riskId: row.riskId,
      kind: row.kind as FindingRiskLink["kind"],
      note: row.note,
    }));
  } catch (err) {
    console.error("[ai-store] finding/risk link read failed", err);
    return [];
  }
}

export async function saveFindingRiskLink(
  organizationId: string,
  link: FindingRiskLink,
  actor: Actor,
): Promise<void> {
  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "finding",
        subjectId: link.findingId,
        action: "linked the finding to a risk",
        field: "riskId",
        before: null,
        after: link.riskId,
      },
    ],
    async () => {
      await db
        .insert(aiFindingRisk)
        .values({ organizationId, ...link })
        .onConflictDoUpdate({
          target: [
            aiFindingRisk.organizationId,
            aiFindingRisk.findingId,
            aiFindingRisk.riskId,
          ],
          set: { kind: link.kind, note: link.note },
        });
    },
  );
}

/**
 * Remove a finding from the register.
 *
 * Soft, like a system and a risk. A finding is the record most worth deleting to
 * make a register look better, which is precisely why the row and its trail stay
 * on disk: "you raised nine and I can see seven" has to be answerable.
 *
 * Its risk links cascade at the foreign key when the row is finally purged;
 * until then they are simply invisible, because `readWorkspace` filters the
 * findings first and the links follow what survives.
 */
export async function deleteAiFinding(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<void> {
  const before = await readAiFinding(organizationId, id);
  if (!before) return;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "finding",
        subjectId: id,
        action: "deleted the finding",
        field: "title",
        before: before.title,
        after: null,
      },
    ],
    async () => {
      await db
        .update(aiFinding)
        .set({ deletedAt: new Date(), deletedBy: actor.userId || null })
        .where(and(eq(aiFinding.organizationId, organizationId), eq(aiFinding.id, id)));
    },
  );
}

/** The trash, for findings. See the risk twin for why these stay concrete. */
export async function readDeletedAiFindings(
  organizationId: string,
): Promise<DeletedFinding[]> {
  try {
    const rows = await db
      .select()
      .from(aiFinding)
      .where(
        and(
          eq(aiFinding.organizationId, organizationId),
          isNotNull(aiFinding.deletedAt),
        ),
      )
      .orderBy(desc(aiFinding.deletedAt));

    return rows.map((row) => ({
      ...toFinding(row),
      deletedAt: (row.deletedAt as Date).toISOString(),
      deletedBy: row.deletedBy,
    }));
  } catch (err) {
    console.error("[ai-store] deleted finding read failed", err);
    return [];
  }
}

/** Clear the tombstone and nothing else. */
export async function restoreAiFinding(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<boolean> {
  const [row] = await db
    .select({ title: aiFinding.title, deletedAt: aiFinding.deletedAt })
    .from(aiFinding)
    .where(and(eq(aiFinding.organizationId, organizationId), eq(aiFinding.id, id)))
    .limit(1);

  if (!row || !row.deletedAt) return false;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "finding",
        subjectId: id,
        action: "restored the finding",
        field: "title",
        before: null,
        after: row.title,
      },
    ],
    async () => {
      await db
        .update(aiFinding)
        .set({ deletedAt: null, deletedBy: null })
        .where(and(eq(aiFinding.organizationId, organizationId), eq(aiFinding.id, id)));
    },
  );

  return true;
}

/**
 * Permanently remove the findings whose retention window has run out.
 *
 * Org-scoped and looped by the cron. `ai_finding_risk_link` cascades from the
 * finding, so a purged finding takes its links to risks with it and leaves no
 * dangling half-join behind. The audit trail is untouched and must stay that
 * way.
 */
export async function purgeExpiredFindings(
  organizationId: string,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<{ id: string; title: string }[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const expired = await db
    .select({ id: aiFinding.id, title: aiFinding.title })
    .from(aiFinding)
    .where(
      and(
        eq(aiFinding.organizationId, organizationId),
        isNotNull(aiFinding.deletedAt),
        lt(aiFinding.deletedAt, cutoff),
      ),
    );

  if (expired.length === 0) return [];

  const ids = expired.map((row) => row.id);

  await audited(
    organizationId,
    SYSTEM_ACTOR,
    expired.map((row) => ({
      subjectKind: "finding" as const,
      subjectId: row.id,
      action: "permanently removed the finding after its retention window",
      field: "title",
      before: row.title,
      after: null,
    })),
    async () => {
      await db
        .delete(aiFinding)
        .where(
          and(eq(aiFinding.organizationId, organizationId), inArray(aiFinding.id, ids)),
        );
    },
  );

  return expired;
}

/** Every organisation with a finding overdue for purging. */
export async function organizationIdsWithExpiredFindings(
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<string[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const rows = await db
    .selectDistinct({ organizationId: aiFinding.organizationId })
    .from(aiFinding)
    .where(and(isNotNull(aiFinding.deletedAt), lt(aiFinding.deletedAt, cutoff)));

  return rows.map((row) => row.organizationId);
}

/* --------------------------------------------------------------- evidence */

function toEvidence(
  row: typeof aiEvidence.$inferSelect,
  controlIds: string[],
  systemIds: string[],
): Evidence {
  return {
    id: row.id,
    title: row.title,
    type: row.type as Evidence["type"],
    ownerId: row.ownerId ?? "",
    source: row.source,
    collectedAt: row.collectedAt,
    expiresAt: row.expiresAt,
    verificationState: row.verificationState as Evidence["verificationState"],
    linkedControlIds: controlIds,
    linkedSystemIds: systemIds,
    file: (row.file ?? null) as Evidence["file"],
  };
}

export async function readAiEvidence(organizationId: string): Promise<Evidence[]> {
  try {
    const rows = await db
      .select()
      .from(aiEvidence)
      .where(
        and(eq(aiEvidence.organizationId, organizationId), isNull(aiEvidence.deletedAt)),
      )
      .orderBy(asc(aiEvidence.expiresAt));

    const links = await db
      .select()
      .from(aiEvidenceLink)
      .where(eq(aiEvidenceLink.organizationId, organizationId));

    const controls = new Map<string, string[]>();
    const systems = new Map<string, string[]>();
    for (const link of links) {
      const map = link.targetKind === "control" ? controls : systems;
      const list = map.get(link.evidenceId) ?? [];
      list.push(link.targetId);
      map.set(link.evidenceId, list);
    }

    return rows.map((row) =>
      toEvidence(row, controls.get(row.id) ?? [], systems.get(row.id) ?? []),
    );
  } catch (err) {
    console.error("[ai-store] evidence read failed", err);
    return [];
  }
}

export async function readAiEvidenceItem(
  organizationId: string,
  id: string,
): Promise<Evidence | null> {
  const all = await readAiEvidence(organizationId);
  return all.find((e) => e.id === id) ?? null;
}

export async function saveAiEvidence(
  organizationId: string,
  evidence: Evidence,
  actor: Actor,
): Promise<void> {
  const before = await readAiEvidenceItem(organizationId, evidence.id);
  const values = {
    id: evidence.id,
    organizationId,
    title: evidence.title,
    type: evidence.type,
    ownerId: evidence.ownerId || null,
    source: evidence.source,
    collectedAt: evidence.collectedAt,
    expiresAt: evidence.expiresAt,
    verificationState: evidence.verificationState,
    file: (evidence.file ?? null) as Record<string, unknown> | null,
  };

  await audited(
    organizationId,
    actor,
    upsertEntries(
      "evidence",
      evidence.id,
      { created: "attached evidence", changed: "changed the evidence record" },
      before,
      evidence,
    ),
    async () => {
      await db
        .insert(aiEvidence)
        .values(values)
        .onConflictDoUpdate({ target: [aiEvidence.organizationId, aiEvidence.id], set: values });

      await db
        .delete(aiEvidenceLink)
        .where(
          and(
            eq(aiEvidenceLink.organizationId, organizationId),
            eq(aiEvidenceLink.evidenceId, evidence.id),
          ),
        );

      const rows = [
        ...evidence.linkedControlIds.map((targetId) => ({
          organizationId,
          evidenceId: evidence.id,
          targetKind: "control",
          targetId,
        })),
        ...evidence.linkedSystemIds.map((targetId) => ({
          organizationId,
          evidenceId: evidence.id,
          targetKind: "system",
          targetId,
        })),
      ];

      if (rows.length > 0) {
        await db.insert(aiEvidenceLink).values(rows).onConflictDoNothing();
      }
    },
  );
}

/**
 * Remove a document from the evidence register.
 *
 * Soft, and the reason bites harder here than elsewhere: coverage is computed
 * from what evidence a control carries, so removing a document lowers a figure
 * the organisation has already reported. The row stays on disk so "why did our
 * coverage drop four points in April" has an answer with a name in it.
 *
 * The links to controls and systems are left alone. `readWorkspace` drops a
 * link whose document is gone, so they are invisible immediately and correct
 * again the moment the document is restored — the same reason a deleted system
 * never tombstones its use cases.
 */
export async function deleteAiEvidence(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<void> {
  const before = await readAiEvidenceItem(organizationId, id);
  if (!before) return;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "evidence",
        subjectId: id,
        action: "deleted the evidence",
        field: "title",
        before: before.title,
        after: null,
      },
    ],
    async () => {
      await db
        .update(aiEvidence)
        .set({ deletedAt: new Date(), deletedBy: actor.userId || null })
        .where(
          and(eq(aiEvidence.organizationId, organizationId), eq(aiEvidence.id, id)),
        );
    },
  );
}

/** The trash, for evidence. Links come along so a restored document is whole. */
export async function readDeletedAiEvidence(
  organizationId: string,
): Promise<DeletedEvidence[]> {
  try {
    const rows = await db
      .select()
      .from(aiEvidence)
      .where(
        and(
          eq(aiEvidence.organizationId, organizationId),
          isNotNull(aiEvidence.deletedAt),
        ),
      )
      .orderBy(desc(aiEvidence.deletedAt));

    const links = await db
      .select()
      .from(aiEvidenceLink)
      .where(eq(aiEvidenceLink.organizationId, organizationId));

    const controls = new Map<string, string[]>();
    const systems = new Map<string, string[]>();
    for (const link of links) {
      const map = link.targetKind === "control" ? controls : systems;
      const list = map.get(link.evidenceId) ?? [];
      list.push(link.targetId);
      map.set(link.evidenceId, list);
    }

    return rows.map((row) => ({
      ...toEvidence(row, controls.get(row.id) ?? [], systems.get(row.id) ?? []),
      deletedAt: (row.deletedAt as Date).toISOString(),
      deletedBy: row.deletedBy,
    }));
  } catch (err) {
    console.error("[ai-store] deleted evidence read failed", err);
    return [];
  }
}

/** Clear the tombstone. The document's links were never touched, so it returns whole. */
export async function restoreAiEvidence(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<boolean> {
  const [row] = await db
    .select({ title: aiEvidence.title, deletedAt: aiEvidence.deletedAt })
    .from(aiEvidence)
    .where(and(eq(aiEvidence.organizationId, organizationId), eq(aiEvidence.id, id)))
    .limit(1);

  if (!row || !row.deletedAt) return false;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "evidence",
        subjectId: id,
        action: "restored the evidence",
        field: "title",
        before: null,
        after: row.title,
      },
    ],
    async () => {
      await db
        .update(aiEvidence)
        .set({ deletedAt: null, deletedBy: null })
        .where(
          and(eq(aiEvidence.organizationId, organizationId), eq(aiEvidence.id, id)),
        );
    },
  );

  return true;
}

/**
 * Permanently remove the evidence whose retention window has run out.
 *
 * `ai_evidence_link` cascades from the document, so a purge takes its claims on
 * controls and systems with it and leaves no dangling half-join. What it does
 * not take is the trail: after this, the only record that the document ever
 * backed a control is the audit entry, which is exactly why that table has no
 * foreign key into any of this.
 */
export async function purgeExpiredEvidence(
  organizationId: string,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<{ id: string; title: string }[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const expired = await db
    .select({ id: aiEvidence.id, title: aiEvidence.title })
    .from(aiEvidence)
    .where(
      and(
        eq(aiEvidence.organizationId, organizationId),
        isNotNull(aiEvidence.deletedAt),
        lt(aiEvidence.deletedAt, cutoff),
      ),
    );

  if (expired.length === 0) return [];

  const ids = expired.map((row) => row.id);

  await audited(
    organizationId,
    SYSTEM_ACTOR,
    expired.map((row) => ({
      subjectKind: "evidence" as const,
      subjectId: row.id,
      action: "permanently removed the evidence after its retention window",
      field: "title",
      before: row.title,
      after: null,
    })),
    async () => {
      await db
        .delete(aiEvidence)
        .where(
          and(eq(aiEvidence.organizationId, organizationId), inArray(aiEvidence.id, ids)),
        );
    },
  );

  return expired;
}

/** Every organisation with a document overdue for purging. */
export async function organizationIdsWithExpiredEvidence(
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<string[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const rows = await db
    .selectDistinct({ organizationId: aiEvidence.organizationId })
    .from(aiEvidence)
    .where(and(isNotNull(aiEvidence.deletedAt), lt(aiEvidence.deletedAt, cutoff)));

  return rows.map((row) => row.organizationId);
}

/* --------------------------------------------------------------- activity */

function toActivityEvent(row: typeof aiActivityEvent.$inferSelect): ActivityEvent {
  return {
    id: row.id,
    subjectKind: row.subjectKind as ActivityEvent["subjectKind"],
    subjectId: row.subjectId,
    actorId: row.actorId ?? "",
    action: row.action,
    field: row.field,
    before: row.before,
    after: row.after,
    reason: row.reason,
    at: row.at.toISOString(),
    viaSuggestionId: row.viaSuggestionId,
  };
}

export async function readActivity(
  organizationId: string,
  subjectId: string,
): Promise<ActivityEvent[]> {
  try {
    const rows = await db
      .select()
      .from(aiActivityEvent)
      .where(
        and(
          eq(aiActivityEvent.organizationId, organizationId),
          eq(aiActivityEvent.subjectId, subjectId),
        ),
      )
      .orderBy(desc(aiActivityEvent.at));

    return rows.map(toActivityEvent);
  } catch (err) {
    console.error("[ai-store] activity read failed", err);
    return [];
  }
}

/**
 * Append an event verbatim, id and timestamp included.
 *
 * **Not the path an application write takes** — those go through `writeAudit()`,
 * which generates the id and stamps the time itself, so a caller cannot choose
 * when something appears to have happened. This exists for the two callers that
 * legitimately carry their own: the demo seed, which loads a history that is
 * meant to look months old, and any future import of a trail from a system being
 * replaced.
 *
 * Kept deliberately narrow rather than folded into `writeAudit()`. The ability
 * to set `at` is the ability to write a plausible past, and that has to be a
 * function somebody chose to call, not a parameter that happened to be optional.
 */
/**
 * Every event of one kind, newest first — "show me every membership change".
 *
 * The read `ai_activity_org_kind_at_idx` exists for. Without a kind column this
 * question could only be answered by pattern-matching id prefixes, which is a
 * guess dressed up as a query; without this function the column would be a
 * filter that nothing filters on.
 */
export async function readActivityByKind(
  organizationId: string,
  subjectKind: AuditSubjectKind,
  limit = 100,
): Promise<ActivityEvent[]> {
  try {
    const rows = await db
      .select()
      .from(aiActivityEvent)
      .where(
        and(
          eq(aiActivityEvent.organizationId, organizationId),
          eq(aiActivityEvent.subjectKind, subjectKind),
        ),
      )
      .orderBy(desc(aiActivityEvent.at))
      .limit(limit);

    return rows.map(toActivityEvent);
  } catch (err) {
    console.error("[ai-store] activity read failed", err);
    return [];
  }
}

export async function recordActivity(
  organizationId: string,
  event: Omit<ActivityEvent, "at"> & { at?: string },
): Promise<void> {
  await db.insert(aiActivityEvent).values({
    id: event.id,
    organizationId,
    subjectKind: event.subjectKind,
    subjectId: event.subjectId,
    actorId: event.actorId || null,
    action: event.action,
    field: event.field,
    before: event.before,
    after: event.after,
    reason: event.reason,
    at: event.at ? new Date(event.at) : new Date(),
    viaSuggestionId: event.viaSuggestionId,
  });
}

/* --------------------------------------------------- review assignments */

/**
 * Who is reviewing what.
 *
 * Filterable by subject because the two callers want opposite slices: a record's
 * own screen wants every stage on that record, and a reviewer's queue wants
 * every record on that reviewer. Both come from here rather than from two
 * queries that could disagree about what "assigned" means.
 */
export async function readReviewAssignments(
  organizationId: string,
  subject?: { kind: AuditSubjectKind; id: string },
): Promise<ReviewAssignment[]> {
  try {
    const rows = await db
      .select()
      .from(aiReviewAssignment)
      .where(
        subject
          ? and(
              eq(aiReviewAssignment.organizationId, organizationId),
              eq(aiReviewAssignment.subjectKind, subject.kind),
              eq(aiReviewAssignment.subjectId, subject.id),
            )
          : eq(aiReviewAssignment.organizationId, organizationId),
      )
      .orderBy(asc(aiReviewAssignment.stage));

    return rows.map((row) => ({
      subjectKind: row.subjectKind as AuditSubjectKind,
      subjectId: row.subjectId,
      stage: row.stage,
      assigneeUserId: row.assigneeUserId,
      assignedBy: row.assignedBy,
      assignedAt: row.assignedAt.toISOString(),
    }));
  } catch (err) {
    console.error("[ai-store] review assignment read failed", err);
    return [];
  }
}

/**
 * Put a stage on somebody's desk.
 *
 * **The assignee is checked against this organization's own membership**, the
 * same way `saveApplicability` filters claimed systems. Without it, knowing a
 * user id would be enough to attach somebody from another tenant to your review
 * — and because they are a real account, the resulting row would look entirely
 * legitimate on screen.
 *
 * Returns whether the assignment landed, rather than throwing, so a caller can
 * say "that person is not in this organization" instead of a 500. A stale id in
 * a form is an ordinary mistake, not an exceptional one.
 */
export async function assignReviewer(
  organizationId: string,
  assignment: Omit<ReviewAssignment, "assignedBy" | "assignedAt">,
  actor: Actor,
): Promise<boolean> {
  const [membership] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.userId, assignment.assigneeUserId),
      ),
    )
    .limit(1);

  if (!membership) return false;

  const previous = (
    await readReviewAssignments(organizationId, {
      kind: assignment.subjectKind,
      id: assignment.subjectId,
    })
  ).find((row) => row.stage === assignment.stage);

  const values = {
    organizationId,
    subjectKind: assignment.subjectKind,
    subjectId: assignment.subjectId,
    stage: assignment.stage,
    assigneeUserId: assignment.assigneeUserId,
    assignedBy: actor.userId || null,
    assignedAt: new Date(),
  };

  await audited(
    organizationId,
    actor,
    previous?.assigneeUserId === assignment.assigneeUserId
      ? []
      : [
          {
            subjectKind: assignment.subjectKind,
            subjectId: assignment.subjectId,
            /* Named by stage rather than "assigned a reviewer", because which
             * stage moved is the whole content of the event — "reassigned
             * security" and "reassigned legal" are different facts. */
            action: `assigned the ${assignment.stage} review`,
            field: assignment.stage,
            before: previous?.assigneeUserId ?? null,
            after: assignment.assigneeUserId,
          },
        ],
    async () => {
      await db
        .insert(aiReviewAssignment)
        .values(values)
        .onConflictDoUpdate({
          target: [
            aiReviewAssignment.organizationId,
            aiReviewAssignment.subjectKind,
            aiReviewAssignment.subjectId,
            aiReviewAssignment.stage,
          ],
          set: {
            assigneeUserId: values.assigneeUserId,
            assignedBy: values.assignedBy,
            assignedAt: values.assignedAt,
          },
        });
    },
  );

  return true;
}

/**
 * Take a stage off somebody's desk.
 *
 * A hard delete, and deliberately not a soft one: the assignment is not a
 * governed record, it is a pointer to whoever currently holds a stage. What has
 * to survive is the *history* of who held it, and that is in the trail — a
 * tombstoned pointer would add nothing and would have to be filtered out of the
 * one query this table exists to serve.
 */
export async function unassignReviewer(
  organizationId: string,
  subject: { kind: AuditSubjectKind; id: string; stage: string },
  actor: Actor,
): Promise<void> {
  const previous = (
    await readReviewAssignments(organizationId, { kind: subject.kind, id: subject.id })
  ).find((row) => row.stage === subject.stage);

  if (!previous) return;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: subject.kind,
        subjectId: subject.id,
        action: `cleared the ${subject.stage} review`,
        field: subject.stage,
        before: previous.assigneeUserId,
        after: null,
      },
    ],
    async () => {
      await db
        .delete(aiReviewAssignment)
        .where(
          and(
            eq(aiReviewAssignment.organizationId, organizationId),
            eq(aiReviewAssignment.subjectKind, subject.kind),
            eq(aiReviewAssignment.subjectId, subject.id),
            eq(aiReviewAssignment.stage, subject.stage),
          ),
        );
    },
  );
}

/* ---------------------------------------------------------------- people */

/**
 * The people a record can name.
 *
 * Not Better Auth users, and the distinction is load bearing — see the block
 * comment on `aiPerson` in `schema.ts`. Ordered by name because every caller
 * renders this into a picker.
 */
export async function readPeople(organizationId: string): Promise<Person[]> {
  try {
    const rows = await db
      .select()
      .from(aiPerson)
      .where(eq(aiPerson.organizationId, organizationId))
      .orderBy(asc(aiPerson.name));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      businessUnit: row.businessUnit,
    }));
  } catch (err) {
    console.error("[ai-store] person read failed", err);
    return [];
  }
}

export async function savePerson(
  organizationId: string,
  person: Person,
  actor: Actor,
): Promise<void> {
  const before = (await readPeople(organizationId)).find((p) => p.id === person.id) ?? null;
  const values = {
    id: person.id,
    organizationId,
    name: person.name,
    role: person.role,
    businessUnit: person.businessUnit,
  };
  await audited(
    organizationId,
    actor,
    upsertEntries(
      "person",
      person.id,
      { created: "added a person", changed: "changed the person record" },
      before,
      person,
    ),
    async () => {
      await db
        .insert(aiPerson)
        .values(values)
        .onConflictDoUpdate({ target: [aiPerson.organizationId, aiPerson.id], set: values });
    },
  );
}

/* ------------------------------------------------------------ role grants */

/**
 * What the roles mean in this organization.
 *
 * **The one read in this file whose empty state is wrong.** Every other accessor
 * degrades to `[]`, because a missing register costs a screen. An empty *grants*
 * map would mean every role holds nothing — the governance lead locked out of
 * the control library because Postgres blipped — so this degrades to the shipped
 * matrix instead, by returning no overrides at all. `can()` reads an absent
 * override as "use the code default", so a failed read lands exactly where an
 * untouched organization already is.
 *
 * Rows naming a role or resource this build does not recognise are dropped
 * rather than trusted. A row written by an older client, or by hand, must not be
 * able to grant something the vocabulary no longer defines.
 */
export async function readRoleGrants(organizationId: string): Promise<OrgGrants> {
  try {
    const rows = await db
      .select()
      .from(aiRoleGrant)
      .where(eq(aiRoleGrant.organizationId, organizationId));

    const grants: OrgGrants = {};
    for (const row of rows) {
      const role = row.role as RoleName;
      if (!ROLE_ORDER.includes(role) || role === FIXED_ROLE) continue;
      if (!EDITABLE_RESOURCES.includes(row.resource)) continue;
      grants[role] = { ...(grants[role] ?? {}), [row.resource]: row.actions };
    }
    return grants;
  } catch (err) {
    console.error("[ai-store] role grant read failed", err);
    // Deliberately not `{}`-with-empty-roles: see the comment above.
    return {};
  }
}

/**
 * Rewrite what one role means, or put it back to the default.
 *
 * The whole matrix for that role arrives at once — the caller sends the complete
 * set it wants, the same contract the link tables use — because a partial write
 * would make "the reviewer no longer verifies findings" indistinguishable from
 * "the reviewer's finding row was not sent".
 *
 * **Every refusal in `refusedGrant()` is enforced here, not only in the route.**
 * The rules it encodes are the product's segregation of duties: an author who
 * can endorse their own answers, an owner who can verify their own fix, a
 * reviewer who can appoint their own reviewer. Those must hold however the row
 * arrives — a seed, an import, a future API client — which is the same argument
 * that puts residual-voiding in `saveAiRisk` rather than in `/api/risks`.
 *
 * `actingRole` is refused its own role outright. Nothing can reach this with a
 * role that is editable *and* their own — `role: ["update"]` is held only by the
 * fixed role — but the check is here rather than assumed, because the day a
 * second role gains the statement is the day the assumption stops holding and
 * nothing would say so.
 */
export async function saveRoleGrants(
  organizationId: string,
  role: RoleName,
  grants: RoleGrants,
  actor: Actor,
  actingRole?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (actingRole && (actingRole as RoleName) === role) {
    return {
      ok: false,
      error: "You cannot change what your own role means. Ask another administrator.",
    };
  }

  const refusal = refusedGrant(role, grants);
  if (refusal) return { ok: false, error: refusal };

  const before = (await readRoleGrants(organizationId))[role] ?? defaultGrants(role);

  /* One entry per resource that actually moved, so the trail reads as the edits
   * somebody made rather than as "saved the roles" — which is not a fact an
   * auditor can act on. */
  const entries: AuditEntry[] = [];
  for (const resource of EDITABLE_RESOURCES) {
    const was = [...(before[resource] ?? [])].sort();
    const now = [...(grants[resource] ?? [])].sort();
    if (was.join(",") === now.join(",")) continue;
    entries.push({
      subjectKind: "organization",
      subjectId: role,
      action: `changed what ${role} may do`,
      field: resource,
      before: was.join(", ") || "nothing",
      after: now.join(", ") || "nothing",
    });
  }

  if (entries.length === 0) return { ok: true };

  await audited(organizationId, actor, entries, async () => {
    for (const resource of EDITABLE_RESOURCES) {
      const values = {
        organizationId,
        role,
        resource,
        actions: [...(grants[resource] ?? [])],
        updatedBy: actor.userId || null,
        updatedAt: new Date(),
      };
      await db
        .insert(aiRoleGrant)
        .values(values)
        .onConflictDoUpdate({
          target: [aiRoleGrant.organizationId, aiRoleGrant.role, aiRoleGrant.resource],
          set: {
            actions: values.actions,
            updatedBy: values.updatedBy,
            updatedAt: values.updatedAt,
          },
        });
    }
  });

  return { ok: true };
}

/**
 * Put a role back to what the product ships.
 *
 * A delete rather than a write of the defaults, so the row's *absence* keeps
 * meaning "the code default" — a stored copy would freeze this build's answer
 * and quietly withhold every statement added afterwards.
 */
export async function resetRoleGrants(
  organizationId: string,
  role: RoleName,
  actor: Actor,
): Promise<void> {
  const current = (await readRoleGrants(organizationId))[role];
  if (!current) return;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "organization",
        subjectId: role,
        action: `put ${role} back to the default permissions`,
        field: "role",
        before: "customised",
        after: "default",
      },
    ],
    async () => {
      await db
        .delete(aiRoleGrant)
        .where(
          and(
            eq(aiRoleGrant.organizationId, organizationId),
            eq(aiRoleGrant.role, role),
          ),
        );
    },
  );
}

/* --------------------------------------------------- accounts and people */

/**
 * Every account in this organization that has been matched to a person.
 *
 * Read as a whole rather than one at a time because both callers want the whole
 * map: the trail resolves an actor per row, and the members screen shows every
 * seat at once. It is one row per member at most, so the list is small by
 * construction.
 */
export async function readAccountPeople(organizationId: string): Promise<AccountPerson[]> {
  try {
    const rows = await db
      .select()
      .from(aiAccountPerson)
      .where(eq(aiAccountPerson.organizationId, organizationId));
    return rows.map((row) => ({
      userId: row.userId,
      personId: row.personId,
      linkedBy: row.linkedBy ?? null,
      linkedAt: row.linkedAt.toISOString(),
    }));
  } catch (err) {
    console.error("[ai-store] account-person read failed", err);
    return [];
  }
}

/**
 * The person this account *is*, or null.
 *
 * Its own query rather than a filter over `readAccountPeople` because
 * `requireOrgContext()` calls it on every request, and reading an organization's
 * whole mapping to answer one question is work the tenant boundary should not do.
 *
 * Null covers three cases that are deliberately not distinguished here: nobody
 * has matched this account yet, the read failed, or there is no such account.
 * All three mean the same thing to a caller — record no person rather than a
 * guess — and `acting-person.ts` is where that rule is stated.
 */
export async function readActingPersonId(
  organizationId: string,
  userId: string,
): Promise<string | null> {
  try {
    const [row] = await db
      .select({ personId: aiAccountPerson.personId })
      .from(aiAccountPerson)
      .where(
        and(
          eq(aiAccountPerson.organizationId, organizationId),
          eq(aiAccountPerson.userId, userId),
        ),
      )
      .limit(1);
    return row?.personId ?? null;
  } catch (err) {
    console.error("[ai-store] acting person read failed", err);
    return null;
  }
}

/**
 * Why a link was refused. The caller turns this into something a human can act on.
 *
 * A union rather than `false`, because the three refusals have three different
 * fixes — invite them, pick a person who exists, or unlink whoever holds that
 * person — and a bare false makes the screen guess which.
 */
export type LinkRefusal = "not_a_member" | "unknown_person" | "person_taken";

export type LinkOutcome = { ok: true } | { ok: false; reason: LinkRefusal };

/**
 * Record that an account and a person are the same human.
 *
 * Every id is checked against this organization's own rows before anything is
 * written, the same way `saveApplicability` filters claimed systems and
 * `assignReviewer` filters assignees. The database would refuse a cross-tenant
 * pair anyway — the foreign key is composite — but a checked refusal is a
 * message and an uncaught constraint violation is a 500.
 *
 * `person_taken` is checked here rather than left to the unique index for the
 * same reason, and it is the refusal that matters most: two accounts claiming
 * one person is exactly what would make an identity check pass for the wrong
 * caller. Re-linking the same pair is not a conflict — it is a no-op that
 * writes nothing and audits nothing.
 *
 * This invalidates no human judgement. A decision recorded while the caller was
 * unattributed stays unattributed: that is what was true when it was made, and
 * back-filling it would be inventing a signature.
 */
export async function linkAccountToPerson(
  organizationId: string,
  link: { userId: string; personId: string },
  actor: Actor,
): Promise<LinkOutcome> {
  /* The account's own label comes back with the membership check, because the
   * trail this lands in names people rather than printing ids — see
   * `membership-audit.ts`, whose rows sit directly above these on the same
   * screen. One join, not a second query. */
  const [membership] = await db
    .select({ userId: member.userId, email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, link.userId)),
    )
    .limit(1);

  if (!membership) return { ok: false, reason: "not_a_member" };

  const existing = await readAccountPeople(organizationId);
  const heldBy = existing.find((row) => row.personId === link.personId);

  if (heldBy && heldBy.userId !== link.userId) {
    /*
     * **A person held by an account that has left is released, not defended.**
     * Nothing cascades this table when a seat goes — the row's foreign keys are
     * to the organization, the user and the person, and a removal touches none
     * of them — so without this a departure would lock that person forever: the
     * replacement is refused as `person_taken`, and the account holding them is
     * no longer on the members screen for anybody to clear. The refusal would be
     * pointing at a control that does not exist.
     *
     * Released here rather than in the removal hook because it must hold however
     * the row arrives, including for the rows already orphaned — the same
     * argument that puts "re-rating voids the acceptance" in the store. It goes
     * through `unlinkAccountFromPerson` rather than a bare delete so the trail
     * records the release as its own act: one person changing hands is two
     * events, not one that quietly overwrites.
     */
    const [stillHere] = await db
      .select({ userId: member.userId })
      .from(member)
      .where(
        and(eq(member.organizationId, organizationId), eq(member.userId, heldBy.userId)),
      )
      .limit(1);

    if (stillHere) return { ok: false, reason: "person_taken" };

    await unlinkAccountFromPerson(organizationId, heldBy.userId, actor);
  }

  const previous = existing.find((row) => row.userId === link.userId) ?? null;

  /* Both people in one query: the one being claimed, to check it exists, and the
   * one being replaced, to name it in the trail. */
  const wanted = [link.personId, ...(previous ? [previous.personId] : [])];
  const named = await db
    .select({ id: aiPerson.id, name: aiPerson.name })
    .from(aiPerson)
    .where(and(eq(aiPerson.organizationId, organizationId), inArray(aiPerson.id, wanted)));

  const person = named.find((row) => row.id === link.personId);
  if (!person) return { ok: false, reason: "unknown_person" };

  if (previous?.personId === link.personId) return { ok: true };

  const previousName = previous
    ? (named.find((row) => row.id === previous.personId)?.name ?? previous.personId)
    : null;
  const account = membership.email || membership.name || link.userId;

  const values = {
    organizationId,
    userId: link.userId,
    personId: link.personId,
    linkedBy: actor.userId || null,
    linkedAt: new Date(),
  };

  await audited(
    organizationId,
    actor,
    [
      {
        /* `member`, not `person`: the subject is the seat in this organization,
         * and the access trail is where somebody looks to see who was told to be
         * whom. `subjectId` is a user id, which is what that kind means. */
        subjectKind: "member",
        subjectId: link.userId,
        action: previous
          ? `changed which person ${account} acts as`
          : `matched ${account} to a person`,
        field: "person",
        before: previousName,
        after: person.name,
      },
    ],
    async () => {
      await db
        .insert(aiAccountPerson)
        .values(values)
        .onConflictDoUpdate({
          target: [aiAccountPerson.organizationId, aiAccountPerson.userId],
          set: { personId: values.personId, linkedBy: values.linkedBy, linkedAt: values.linkedAt },
        });
    },
  );

  return { ok: true };
}

/**
 * Withdraw the claim that an account is a person.
 *
 * A hard delete: the mapping is a pointer to who somebody currently is, not a
 * governed record. What has to survive is the history of who was matched to
 * whom, and that is in the trail — where it cannot be rewritten. Records already
 * written keep the person they name; unlinking says nothing about the past.
 */
export async function unlinkAccountFromPerson(
  organizationId: string,
  userId: string,
  actor: Actor,
): Promise<void> {
  const previous = (await readAccountPeople(organizationId)).find(
    (row) => row.userId === userId,
  );
  if (!previous) return;

  /* Names rather than ids, for the same reason the link does. Both fall back to
   * the id: a person deleted between the link and the unlink still has to
   * render as something, and the id is the honest something. */
  const [person] = await db
    .select({ name: aiPerson.name })
    .from(aiPerson)
    .where(
      and(eq(aiPerson.organizationId, organizationId), eq(aiPerson.id, previous.personId)),
    )
    .limit(1);
  const [account] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "member",
        subjectId: userId,
        action: `cleared which person ${account?.email || account?.name || userId} acts as`,
        field: "person",
        before: person?.name ?? previous.personId,
        after: null,
      },
    ],
    async () => {
      await db
        .delete(aiAccountPerson)
        .where(
          and(
            eq(aiAccountPerson.organizationId, organizationId),
            eq(aiAccountPerson.userId, userId),
          ),
        );
    },
  );
}

/* -------------------------------------------------------------- policies */

export async function readAiPolicies(organizationId: string): Promise<Policy[]> {
  try {
    const rows = await db
      .select()
      .from(aiPolicy)
      .where(eq(aiPolicy.organizationId, organizationId))
      .orderBy(asc(aiPolicy.title));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status as Policy["status"],
      ownerId: row.ownerId ?? "",
      version: row.version,
      approvedAt: row.approvedAt,
      nextReviewDate: row.nextReviewDate,
      summary: row.summary,
    }));
  } catch (err) {
    console.error("[ai-store] policy read failed", err);
    return [];
  }
}

export async function saveAiPolicy(
  organizationId: string,
  policy: Policy,
  actor: Actor,
): Promise<void> {
  const before =
    (await readAiPolicies(organizationId)).find((p) => p.id === policy.id) ?? null;
  const values = {
    id: policy.id,
    organizationId,
    title: policy.title,
    status: policy.status,
    ownerId: policy.ownerId || null,
    version: policy.version,
    approvedAt: policy.approvedAt,
    nextReviewDate: policy.nextReviewDate,
    summary: policy.summary,
  };
  await audited(
    organizationId,
    actor,
    upsertEntries(
      "policy",
      policy.id,
      { created: "added a policy", changed: "changed the policy" },
      before,
      policy,
    ),
    async () => {
      await db
        .insert(aiPolicy)
        .values(values)
        .onConflictDoUpdate({ target: [aiPolicy.organizationId, aiPolicy.id], set: values });
    },
  );
}

/* -------------------------------------------------------- questionnaires */

/**
 * Inbound questionnaires with their questions, in one read.
 *
 * The questions come back nested because no caller wants a questionnaire
 * without them, and a register rendering a question count would otherwise need
 * a second query per row. **Drafted answers are not here and must not be:** an
 * answer is only safe to send while the evidence behind it is current, so it is
 * recomputed on open rather than remembered.
 */
export async function readQuestionnaires(organizationId: string): Promise<Questionnaire[]> {
  try {
    const rows = await db
      .select()
      .from(aiQuestionnaire)
      .where(
        and(
          eq(aiQuestionnaire.organizationId, organizationId),
          isNull(aiQuestionnaire.deletedAt),
        ),
      )
      .orderBy(asc(aiQuestionnaire.dueAt));
    if (rows.length === 0) return [];

    const questions = await db
      .select()
      .from(aiQuestionnaireQuestion)
      .where(
        and(
          eq(aiQuestionnaireQuestion.organizationId, organizationId),
          inArray(
            aiQuestionnaireQuestion.questionnaireId,
            rows.map((r) => r.id),
          ),
        ),
      )
      .orderBy(asc(aiQuestionnaireQuestion.position));

    const byQuestionnaire = new Map<string, QuestionnaireQuestion[]>();
    for (const q of questions) {
      const list = byQuestionnaire.get(q.questionnaireId) ?? [];
      list.push({
        id: q.id,
        number: q.number,
        text: q.text,
        controlIds: q.controlIds,
        policyIds: q.policyIds,
        evidenceIds: q.evidenceIds,
      });
      byQuestionnaire.set(q.questionnaireId, list);
    }

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      requester: row.requester,
      requesterType: row.requesterType as Questionnaire["requesterType"],
      receivedAt: row.receivedAt,
      dueAt: row.dueAt,
      ownerId: row.ownerId ?? "",
      status: row.status as Questionnaire["status"],
      note: row.note,
      questions: byQuestionnaire.get(row.id) ?? [],
    }));
  } catch (err) {
    console.error("[ai-store] questionnaire read failed", err);
    return [];
  }
}

/**
 * Replace a questionnaire and the complete set of questions it should have.
 *
 * Questions are replaced rather than merged, in line with every other link set
 * in this file: the caller sends what it wants to exist. The delete is scoped by
 * organization *as well as* by questionnaire id — without that, knowing an id
 * would be enough to clear another tenant's questions.
 */
export async function saveQuestionnaire(
  organizationId: string,
  questionnaire: Questionnaire,
  actor: Actor,
): Promise<void> {
  const before =
    (await readQuestionnaires(organizationId)).find((q) => q.id === questionnaire.id) ??
    null;
  const values = {
    id: questionnaire.id,
    organizationId,
    title: questionnaire.title,
    requester: questionnaire.requester,
    requesterType: questionnaire.requesterType,
    receivedAt: questionnaire.receivedAt,
    dueAt: questionnaire.dueAt,
    ownerId: questionnaire.ownerId || null,
    status: questionnaire.status,
    note: questionnaire.note,
  };

  await audited(
    organizationId,
    actor,
    upsertEntries(
      "questionnaire",
      questionnaire.id,
      { created: "logged a questionnaire", changed: "changed the questionnaire" },
      before,
      questionnaire,
    ),
    async () => {
      await db
        .insert(aiQuestionnaire)
        .values(values)
        .onConflictDoUpdate({
          target: [aiQuestionnaire.organizationId, aiQuestionnaire.id],
          set: values,
        });

      await db
        .delete(aiQuestionnaireQuestion)
        .where(
          and(
            eq(aiQuestionnaireQuestion.organizationId, organizationId),
            eq(aiQuestionnaireQuestion.questionnaireId, questionnaire.id),
          ),
        );

      if (questionnaire.questions.length > 0) {
        await db.insert(aiQuestionnaireQuestion).values(
          questionnaire.questions.map((q, position) => ({
            id: q.id,
            organizationId,
            questionnaireId: questionnaire.id,
            number: q.number,
            text: q.text,
            position,
            controlIds: q.controlIds,
            policyIds: q.policyIds,
            evidenceIds: q.evidenceIds,
          })),
        );
      }
    },
  );
}

/**
 * Remove a questionnaire from the register.
 *
 * Soft. A questionnaire is a promise to somebody outside the company with a
 * date on it, and the party who sent it still believes it is being answered —
 * so the fact that it arrived and was dropped has to outlive the row.
 *
 * Its questions are left alone. They have no foreign key to lean on, so they
 * are removed by hand at the purge; until then they are simply unreachable,
 * which is what lets a restore bring the questionnaire back with its questions
 * rather than as an empty shell.
 */
export async function deleteQuestionnaire(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<void> {
  const [before] = await db
    .select({ title: aiQuestionnaire.title, deletedAt: aiQuestionnaire.deletedAt })
    .from(aiQuestionnaire)
    .where(
      and(eq(aiQuestionnaire.organizationId, organizationId), eq(aiQuestionnaire.id, id)),
    )
    .limit(1);

  if (!before || before.deletedAt) return;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "questionnaire",
        subjectId: id,
        action: "deleted the questionnaire",
        field: "title",
        before: before.title,
        after: null,
      },
    ],
    async () => {
      await db
        .update(aiQuestionnaire)
        .set({ deletedAt: new Date(), deletedBy: actor.userId || null })
        .where(
          and(
            eq(aiQuestionnaire.organizationId, organizationId),
            eq(aiQuestionnaire.id, id),
          ),
        );
    },
  );
}

/** The trash, for questionnaires. Questions come along so a restore is whole. */
export async function readDeletedQuestionnaires(
  organizationId: string,
): Promise<DeletedQuestionnaire[]> {
  try {
    const rows = await db
      .select()
      .from(aiQuestionnaire)
      .where(
        and(
          eq(aiQuestionnaire.organizationId, organizationId),
          isNotNull(aiQuestionnaire.deletedAt),
        ),
      )
      .orderBy(desc(aiQuestionnaire.deletedAt));

    if (rows.length === 0) return [];

    const questions = await db
      .select()
      .from(aiQuestionnaireQuestion)
      .where(
        and(
          eq(aiQuestionnaireQuestion.organizationId, organizationId),
          inArray(
            aiQuestionnaireQuestion.questionnaireId,
            rows.map((r) => r.id),
          ),
        ),
      )
      .orderBy(asc(aiQuestionnaireQuestion.position));

    const byQuestionnaire = new Map<string, QuestionnaireQuestion[]>();
    for (const q of questions) {
      const list = byQuestionnaire.get(q.questionnaireId) ?? [];
      list.push({
        id: q.id,
        number: q.number,
        text: q.text,
        controlIds: q.controlIds ?? [],
        policyIds: q.policyIds ?? [],
        evidenceIds: q.evidenceIds ?? [],
      });
      byQuestionnaire.set(q.questionnaireId, list);
    }

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      requester: row.requester,
      requesterType: row.requesterType as Questionnaire["requesterType"],
      receivedAt: row.receivedAt,
      dueAt: row.dueAt,
      ownerId: row.ownerId ?? "",
      status: row.status as Questionnaire["status"],
      note: row.note,
      questions: byQuestionnaire.get(row.id) ?? [],
      deletedAt: (row.deletedAt as Date).toISOString(),
      deletedBy: row.deletedBy,
    }));
  } catch (err) {
    console.error("[ai-store] deleted questionnaire read failed", err);
    return [];
  }
}

/** Clear the tombstone. The questions were never touched, so it returns whole. */
export async function restoreQuestionnaire(
  organizationId: string,
  id: string,
  actor: Actor,
): Promise<boolean> {
  const [row] = await db
    .select({ title: aiQuestionnaire.title, deletedAt: aiQuestionnaire.deletedAt })
    .from(aiQuestionnaire)
    .where(
      and(eq(aiQuestionnaire.organizationId, organizationId), eq(aiQuestionnaire.id, id)),
    )
    .limit(1);

  if (!row || !row.deletedAt) return false;

  await audited(
    organizationId,
    actor,
    [
      {
        subjectKind: "questionnaire",
        subjectId: id,
        action: "restored the questionnaire",
        field: "title",
        before: null,
        after: row.title,
      },
    ],
    async () => {
      await db
        .update(aiQuestionnaire)
        .set({ deletedAt: null, deletedBy: null })
        .where(
          and(
            eq(aiQuestionnaire.organizationId, organizationId),
            eq(aiQuestionnaire.id, id),
          ),
        );
    },
  );

  return true;
}

/**
 * Permanently remove the questionnaires whose retention window has run out.
 *
 * **The questions have no foreign key**, only an index — so nothing cascades
 * and they are removed by hand. Left behind they would be unreachable rows
 * accumulating forever, and a questionnaire id reused later would inherit
 * somebody else's questions.
 *
 * There are no answers to remove. Questionnaire answers are ephemeral runtime
 * state and were never written to a table, which is the one place in this
 * product where "we do not store it" makes a purge simpler rather than harder.
 */
export async function purgeExpiredQuestionnaires(
  organizationId: string,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<{ id: string; title: string }[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const expired = await db
    .select({ id: aiQuestionnaire.id, title: aiQuestionnaire.title })
    .from(aiQuestionnaire)
    .where(
      and(
        eq(aiQuestionnaire.organizationId, organizationId),
        isNotNull(aiQuestionnaire.deletedAt),
        lt(aiQuestionnaire.deletedAt, cutoff),
      ),
    );

  if (expired.length === 0) return [];

  const ids = expired.map((row) => row.id);

  await audited(
    organizationId,
    SYSTEM_ACTOR,
    expired.map((row) => ({
      subjectKind: "questionnaire" as const,
      subjectId: row.id,
      action: "permanently removed the questionnaire after its retention window",
      field: "title",
      before: row.title,
      after: null,
    })),
    async () => {
      await db
        .delete(aiQuestionnaireQuestion)
        .where(
          and(
            eq(aiQuestionnaireQuestion.organizationId, organizationId),
            inArray(aiQuestionnaireQuestion.questionnaireId, ids),
          ),
        );

      await db
        .delete(aiQuestionnaire)
        .where(
          and(
            eq(aiQuestionnaire.organizationId, organizationId),
            inArray(aiQuestionnaire.id, ids),
          ),
        );
    },
  );

  return expired;
}

/** Every organisation with a questionnaire overdue for purging. */
export async function organizationIdsWithExpiredQuestionnaires(
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS,
): Promise<string[]> {
  const cutoff = purgeCutoff(now, retentionDays);

  const rows = await db
    .selectDistinct({ organizationId: aiQuestionnaire.organizationId })
    .from(aiQuestionnaire)
    .where(
      and(isNotNull(aiQuestionnaire.deletedAt), lt(aiQuestionnaire.deletedAt, cutoff)),
    );

  return rows.map((row) => row.organizationId);
}

/* ----------------------------------------------------------- suggestions */

export async function readSuggestions(organizationId: string): Promise<AiSuggestion[]> {
  try {
    const rows = await db
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.organizationId, organizationId))
      .orderBy(asc(aiSuggestion.id));
    return rows.map((row) => ({
      id: row.id,
      target: {
        kind: row.targetKind as AiSuggestion["target"]["kind"],
        id: row.targetId,
      },
      recommendation: row.recommendation,
      reasoning: row.reasoning,
      supportingData: row.supportingData as AiSuggestion["supportingData"],
      // Stored as whole percent; the domain type is a 0-1 fraction.
      confidence: row.confidence / 100,
      status: row.status as AiSuggestion["status"],
      decidedById: row.decidedById,
      decidedAt: row.decidedAt,
      editedText: row.editedText,
    }));
  } catch (err) {
    console.error("[ai-store] suggestion read failed", err);
    return [];
  }
}

export async function saveSuggestion(
  organizationId: string,
  suggestion: AiSuggestion,
  actor: Actor,
): Promise<void> {
  const before =
    (await readSuggestions(organizationId)).find((x) => x.id === suggestion.id) ?? null;
  const values = {
    id: suggestion.id,
    organizationId,
    targetKind: suggestion.target.kind,
    targetId: suggestion.target.id,
    recommendation: suggestion.recommendation,
    reasoning: suggestion.reasoning,
    supportingData: suggestion.supportingData as unknown as Record<string, unknown>[],
    confidence: Math.round(suggestion.confidence * 100),
    status: suggestion.status,
    decidedById: suggestion.decidedById,
    decidedAt: suggestion.decidedAt,
    editedText: suggestion.editedText,
  };
  /* A suggestion appearing is the model talking, not a person acting, so its
   * creation is not trail-worthy. What is, is the moment somebody *decided* on
   * it — that is the "humans dispose" half, and it is the only transition here
   * an auditor will ever ask about. */
  const decided = before !== null && before.status !== suggestion.status;

  await audited(
    organizationId,
    actor,
    decided
      ? [
          {
            subjectKind: "record",
            subjectId: suggestion.id,
            action: `${suggestion.status} an AI suggestion`,
            field: "status",
            before: before.status,
            after: suggestion.status,
          },
        ]
      : [],
    async () => {
      await db
        .insert(aiSuggestion)
        .values(values)
        .onConflictDoUpdate({
          target: [aiSuggestion.organizationId, aiSuggestion.id],
          set: values,
        });
    },
  );
}

/* ------------------------------------------------------------- workspace */

/** Every framework this organisation has in scope, for resolution and pickers. */
export async function readFrameworks(organizationId: string): Promise<Framework[]> {
  try {
    const rows = await db
      .select()
      .from(aiFramework)
      .where(eq(aiFramework.organizationId, organizationId))
      .orderBy(asc(aiFramework.name));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      shortName: row.shortName,
      description: row.description,
      version: row.version,
    }));
  } catch (err) {
    console.error("[ai-store] framework list read failed", err);
    return [];
  }
}

/**
 * One organisation's whole management system, in the shape the screens want.
 *
 * Composed from the accessors above rather than written as one joined query,
 * deliberately. Each accessor already degrades to its own empty value, so a
 * single table failing costs that register and not the page; a mega-query would
 * trade that for a round trip and take the whole screen down with it.
 *
 * The framework is resolved the same way `?framework=` resolves elsewhere in
 * this codebase: the requested one if the organisation has it, otherwise the
 * first in scope, otherwise none. An unknown id is a fallback rather than a
 * 404 because the id arrives from a URL a person can edit.
 *
 * **Activity is subject-scoped and empty by default.** The audit trail is the
 * one register that grows without bound, and only a detail page ever reads it —
 * for the one record it is about. Loading the lot into every page would be a
 * table scan to render a dashboard that never shows a single event, so a caller
 * that needs a trail names the subject it needs.
 *
 * Business units are derived from the people rather than stored. They are a
 * picker's option list, not an entity, and a table would add a join to gain a
 * second place for the same string to be spelled differently.
 */
export interface WorkspaceScope {
  /** Which standard the SoA and readiness figures describe. */
  frameworkId?: string;
  /** The one record whose audit trail this page renders. */
  activitySubjectId?: string;
  /**
   * The one request whose notes this page renders.
   *
   * Scoped like `activitySubjectId` rather than loaded with the register: the
   * queue shows a dozen requests and wants none of their notes, and every other
   * screen in the product wants none at all.
   */
  intakeNotesFor?: string;
}

export async function readWorkspace(
  organizationId: string,
  scope: WorkspaceScope = {},
): Promise<WorkspaceData> {
  const frameworks = await readFrameworks(organizationId);
  const chosen =
    frameworks.find((f) => f.id === scope.frameworkId) ?? frameworks[0] ?? null;

  const [
    bundle,
    applicability,
    people,
    accountPeople,
    policies,
    systems,
    useCases,
    requests,
    assessments,
    risks,
    findings,
    findingRiskLinks,
    evidence,
    activity,
    questionnaires,
    suggestions,
    intakeNotes,
  ] = await Promise.all([
    chosen
      ? readFramework(organizationId, chosen.id)
      : Promise.resolve<FrameworkBundle>({ framework: null, nodes: [], controls: [] }),
    chosen ? readApplicability(organizationId, chosen.id) : Promise.resolve([]),
    readPeople(organizationId),
    readAccountPeople(organizationId),
    readAiPolicies(organizationId),
    readAiSystems(organizationId),
    readUseCases(organizationId),
    readIntakeRequests(organizationId),
    readAssessments(organizationId),
    readAiRisks(organizationId),
    readAiFindings(organizationId),
    readFindingRiskLinks(organizationId),
    readAiEvidence(organizationId),
    scope.activitySubjectId
      ? readActivity(organizationId, scope.activitySubjectId)
      : Promise.resolve([]),
    readQuestionnaires(organizationId),
    readSuggestions(organizationId),
    scope.intakeNotesFor
      ? readIntakeNotes(organizationId, scope.intakeNotesFor)
      : Promise.resolve([]),
  ]);

  /*
   * A deleted system takes its dependents out of view with it.
   *
   * **Derived on read, not tombstoned.** `deleteAiSystem` is soft, and the
   * upsert clears the tombstone so re-registering a removed id revives the row.
   * If deletion had written `deletedAt` down the tree, nothing would clear those
   * on the way back — reviving a system would return it with no use cases, no
   * assessments and no claims, which is a worse answer than the one this
   * replaces. Computing visibility from the parent instead is symmetric for
   * free, stores nothing derived, and needs no migration.
   *
   * Done here rather than in each read because every page reaches its data
   * through this one function; six filtered queries would be six chances to miss
   * one, and this is a set lookup over rows already in memory.
   *
   * **A null `systemId` is not an orphan.** A risk or a finding can be
   * org-level, and dropping those would empty the register on the first
   * deletion. Only a row that names a system and finds it gone is hidden.
   */
  const live = new Set(systems.map((system) => system.id));
  const orphaned = (systemId: string | null | undefined) =>
    Boolean(systemId) && !live.has(systemId as string);

  /*
   * **A use case survives while any one of its systems does.**
   *
   * It reaches several now, so "its system was deleted" is no longer a question
   * with one answer. A purpose served by M365 Copilot, Zoom AI and an internal
   * assistant does not stop being a governed purpose because one of the three
   * was retired — it is still being done, by the other two, and hiding it would
   * take a live purpose off the register on an unrelated deletion.
   *
   * The dead system is stripped from the row rather than dropping the row,
   * exactly as `liveApplicability` and `liveEvidence` below do it: what the
   * deletion removes is the claim that *that* system implements the purpose.
   * Only when nothing is left does the use case go out of view.
   */
  const reaches = (useCase: AIUseCase) => useCase.systemIds.some((id) => live.has(id));

  const liveUseCases = useCases.filter(reaches).map((useCase) =>
    useCase.systemIds.some(orphaned)
      ? { ...useCase, systemIds: useCase.systemIds.filter((id) => live.has(id)) }
      : useCase,
  );

  /*
   * Second hop: a record can reach a dead system through a use case rather than
   * naming it directly, and a register that still lists it has only moved the
   * dangling link one step along.
   *
   * **The set is the orphaned use cases, not the complement of the live ones**,
   * and the difference became load-bearing when the use case register grew its
   * own soft delete. `readUseCases` filters tombstones, so a use case somebody
   * removed on its own is absent from `useCases` entirely — and "not in the live
   * set" would sweep it in here, hiding its risks from a register nobody deleted
   * them from, with no trash entry to find them in. Deleting a use case hides
   * nothing but the use case; deleting its *system* is what takes dependants out
   * of view, because that removes the thing every one of those records is about.
   *
   * With many systems per use case this hop fires strictly less often: a risk
   * filed against a shared purpose stays visible while any system still
   * implements it, which is the same rule one level up.
   */
  const orphanedUseCaseIds = new Set(
    useCases.filter((useCase) => !reaches(useCase)).map((u) => u.id),
  );
  const stranded = (useCaseId: string | null | undefined) =>
    Boolean(useCaseId) && orphanedUseCaseIds.has(useCaseId as string);

  const liveAssessments = assessments.filter(
    (row) => !orphaned(row.systemId) && !stranded(row.useCaseId),
  );
  const liveRisks = risks.filter(
    (row) => !orphaned(row.systemId) && !stranded(row.useCaseId),
  );
  const liveFindings = findings.filter((row) => !orphaned(row.systemId));

  const riskIds = new Set(liveRisks.map((row) => row.id));
  const findingIds = new Set(liveFindings.map((row) => row.id));

  /*
   * Claims and evidence links lose the dead system, not themselves.
   *
   * An applicability row belongs to a control, not to a system, and a piece of
   * evidence belongs to whoever collected it. What the deletion removes is the
   * *claim* that the control covers that system — which is exactly what has to
   * stop counting, because `coverageForSystem` derives the inventory's coverage
   * column from these arrays. Dropping the whole row instead would delete a
   * control's applicability decision because an unrelated system went away.
   */
  const liveApplicability = applicability.map((row) =>
    row.appliesToSystemIds.some(orphaned)
      ? { ...row, appliesToSystemIds: row.appliesToSystemIds.filter((id) => live.has(id)) }
      : row,
  );
  const liveEvidence = evidence.map((row) =>
    row.linkedSystemIds.some(orphaned)
      ? { ...row, linkedSystemIds: row.linkedSystemIds.filter((id) => live.has(id)) }
      : row,
  );

  return {
    people,
    accountPeople,
    businessUnits: [...new Set(people.map((p) => p.businessUnit).filter(Boolean))].sort(),
    systems,
    useCases: liveUseCases,
    requests,
    framework: bundle.framework,
    nodes: bundle.nodes,
    controls: bundle.controls,
    applicability: liveApplicability,
    policies,
    evidence: liveEvidence,
    assessments: liveAssessments,
    risks: liveRisks,
    findings: liveFindings,
    /* Links whose other end is no longer in view. `underminingFindings` already
     * drops a pair whose finding is missing, so this is coherence rather than a
     * crash — but a link count that includes edges to nothing is a number that
     * disagrees with the register beside it. */
    findingRiskLinks: findingRiskLinks.filter(
      (link) => riskIds.has(link.riskId) && findingIds.has(link.findingId),
    ),
    activity,
    questionnaires,
    suggestions,
    intakeNotes,
  };
}
