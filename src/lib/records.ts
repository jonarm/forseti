import {
  readDeletedAiEvidence,
  readDeletedAiFindings,
  readDeletedAiRisks,
  readDeletedAiSystems,
  readDeletedAssessments,
  readDeletedIntakeRequests,
  readDeletedQuestionnaires,
  readDeletedUseCases,
  deleteAiEvidence,
  deleteAssessment,
  deleteIntakeRequest,
  deleteQuestionnaire,
  deleteAiFinding,
  deleteAiRisk,
  deleteAiSystem,
  deleteUseCase,
  restoreAiEvidence,
  restoreAssessment,
  restoreIntakeRequest,
  restoreQuestionnaire,
  restoreAiFinding,
  restoreAiRisk,
  restoreAiSystem,
  restoreUseCase,
} from "./ai-store";
import type { RecordKind } from "./ams/record-kinds";
import type { Workspace } from "./ams/workspace";
import type { Actor } from "./audit";

/**
 * How to read and remove each kind of record.
 *
 * The server half of `ams/record-kinds.ts`. That file describes the registers —
 * their labels, columns and permissions — and is safe in a browser bundle; this
 * one binds each kind to the store functions that touch the database, and must
 * never be imported by a component.
 *
 * There is no `server-only` marker on it, because the barrier already exists
 * and adding a dependency to restate it would be the weaker half of the pair:
 * this imports `ai-store`, which imports `@/db`, which throws at module load
 * without `DATABASE_URL`. A component that reached for this would fail loudly
 * in the browser rather than quietly shipping a database client — a worse
 * error message than `server-only` gives, and the same outcome.
 *
 * **Rows come from the workspace, not from a per-kind query.** Every register's
 * screen derives its figures through `Workspace` accessors — coverage, use-case
 * counts, the person behind an owner id — and an export that queried its own
 * rows would compute those a second way. So the routes read the workspace once
 * and pick the list out of it, which is also why a kind is a *selector* here
 * rather than a fetcher.
 *
 * Every kind is bound now — the `remove`/`restore` pair stays nullable because
 * the route reads it as the second half of a permission: the registry's feature
 * flag says a register offers deletion, this says the store can actually do it,
 * and a client claiming otherwise is answered rather than trusted.
 */

export interface RecordBinding {
  /** The kind's rows, out of a workspace the caller has already read. */
  rows: (ws: Workspace) => readonly { id: string }[];
  /** Soft delete. Null until the kind has one. */
  remove:
    | ((organizationId: string, id: string, actor: Actor) => Promise<void>)
    | null;
  /** Clear the tombstone. Null until the kind has one. */
  restore:
    | ((organizationId: string, id: string, actor: Actor) => Promise<boolean>)
    | null;
  /**
   * What is in this kind's trash.
   *
   * Every register has one now, so this is not nullable — a kind that could not
   * answer would be a tab the trash cannot render, and the screen would rather
   * show an empty register than omit one. The rows carry `deletedAt` and
   * `deletedBy` on top of the record; the trash reads only those, the id, and
   * whatever it can find to call the record.
   */
  readDeleted: (
    organizationId: string,
  ) => Promise<readonly { id: string; deletedAt: string; deletedBy: string | null }[]>;
}

export const RECORD_BINDINGS: Record<RecordKind, RecordBinding> = {
  system: {
    rows: (ws) => ws.systems,
    remove: deleteAiSystem,
    restore: restoreAiSystem,
    readDeleted: readDeletedAiSystems,
  },
  useCase: {
    rows: (ws) => ws.useCases,
    remove: deleteUseCase,
    restore: restoreUseCase,
    readDeleted: readDeletedUseCases,
  },
  risk: {
    rows: (ws) => ws.risks,
    remove: deleteAiRisk,
    restore: restoreAiRisk,
    readDeleted: readDeletedAiRisks,
  },
  finding: {
    rows: (ws) => ws.findings,
    remove: deleteAiFinding,
    restore: restoreAiFinding,
    readDeleted: readDeletedAiFindings,
  },
  evidence: {
    rows: (ws) => ws.evidence,
    remove: deleteAiEvidence,
    restore: restoreAiEvidence,
    readDeleted: readDeletedAiEvidence,
  },
  assessment: {
    rows: (ws) => ws.assessments,
    remove: deleteAssessment,
    restore: restoreAssessment,
    readDeleted: readDeletedAssessments,
  },
  questionnaire: {
    rows: (ws) => ws.questionnaires,
    remove: deleteQuestionnaire,
    restore: restoreQuestionnaire,
    readDeleted: readDeletedQuestionnaires,
  },
  intake: {
    rows: (ws) => ws.requests,
    remove: deleteIntakeRequest,
    restore: restoreIntakeRequest,
    readDeleted: readDeletedIntakeRequests,
  },
};
