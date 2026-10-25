import { NextResponse } from "next/server";

import {
  organizationIdsWithExpiredAssessments,
  organizationIdsWithExpiredIntakeRequests,
  organizationIdsWithExpiredQuestionnaires,
  organizationIdsWithExpiredEvidence,
  organizationIdsWithExpiredFindings,
  organizationIdsWithExpiredRisks,
  organizationIdsWithExpiredTrash,
  organizationIdsWithExpiredUseCases,
  purgeExpiredAssessments,
  purgeExpiredIntakeRequests,
  purgeExpiredQuestionnaires,
  purgeExpiredEvidence,
  purgeExpiredFindings,
  purgeExpiredRisks,
  purgeExpiredSystems,
  purgeExpiredUseCases,
  TRASH_RETENTION_DAYS,
} from "@/lib/ai-store";
import { requireCronRequest } from "@/lib/cron-auth";

/**
 * GET /api/cron/purge-trash — permanently remove what has sat in the trash for
 * its retention window.
 *
 * **The only handler in the product with no tenant behind it.** Everything else
 * under `/api` resolves an organisation from a session cookie; this runs at
 * 04:00 with nobody signed in, so `requireCronRequest()` — a shared secret from
 * `CRON_SECRET`, refusing outright when that is unset — is what stands in for
 * the session. `route-guards.test.ts` knows about exactly this one function, so
 * a second unauthenticated endpoint cannot appear without failing the suite.
 *
 * **GET because that is what Vercel Cron sends**, not because the operation is
 * safe. It is the most destructive route in the codebase. The secret is what
 * makes that acceptable, and the two mitigations that matter are elsewhere: the
 * purge only ever touches rows a person already removed, and the audit trail it
 * writes is in a table with no foreign key into any of this.
 *
 * **Tenant by tenant, never in one sweep.** The enumeration is the one
 * deliberately cross-tenant read in the store; the deletes are org-scoped calls
 * in a loop, so the write path keeps the same `organizationId` filter as every
 * other write in the product. A single global `DELETE ... WHERE deleted_at <`
 * would be shorter, faster, and one missing clause from emptying a tenant that
 * was never in scope — for the one operation nothing can undo.
 *
 * **One organisation's failure does not stop the rest.** A tenant whose purge
 * throws is counted and logged and the loop continues: the alternative is a
 * single bad row freezing retention for every other customer, silently, until
 * somebody reads the logs.
 *
 * **One sweep per kind, not one sweep.** Each register keeps its tombstones on
 * its own table, so the job asks each kind which organisations are overdue and
 * purges those. A register with nothing overdue costs one indexed query. Kinds
 * join this list as they gain soft delete, and a loop over a registry would
 * hide which ones have not.
 *
 * Nothing here is a spend or a model call, so there is no rate limit. The
 * schedule is the rate limit, and the secret is the gate.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cron = requireCronRequest(request);
  if (!cron.ok) return cron.response;

  const startedAt = Date.now();

  /* The registers that have a retention window today, each with the pair of
   * functions the sweep needs. Adding a kind here is what turns its purge on —
   * deliberately explicit, because a registry loop would paper over a register
   * whose table has no `deleted_at` column yet. */
  const sweeps = [
    { kind: "system", overdue: organizationIdsWithExpiredTrash, purge: purgeExpiredSystems },
    {
      /* Systems cascade their use cases at the foreign key, so this sweep is for
       * the ones removed on their own. It is also the only purge that clears
       * columns nothing cascades from — see `purgeExpiredUseCases`. */
      kind: "useCase",
      overdue: organizationIdsWithExpiredUseCases,
      purge: purgeExpiredUseCases,
    },
    { kind: "risk", overdue: organizationIdsWithExpiredRisks, purge: purgeExpiredRisks },
    {
      kind: "finding",
      overdue: organizationIdsWithExpiredFindings,
      purge: purgeExpiredFindings,
    },
    {
      kind: "evidence",
      overdue: organizationIdsWithExpiredEvidence,
      purge: purgeExpiredEvidence,
    },
    {
      kind: "assessment",
      overdue: organizationIdsWithExpiredAssessments,
      purge: purgeExpiredAssessments,
    },
    {
      kind: "questionnaire",
      overdue: organizationIdsWithExpiredQuestionnaires,
      purge: purgeExpiredQuestionnaires,
    },
    {
      kind: "intake",
      overdue: organizationIdsWithExpiredIntakeRequests,
      purge: purgeExpiredIntakeRequests,
    },
  ] as const;

  const purgedByKind: Record<string, number> = {};
  const scanned = new Set<string>();
  const failed = new Set<string>();

  for (const sweep of sweeps) {
    const organizationIds = await sweep.overdue();
    purgedByKind[sweep.kind] = 0;

    for (const organizationId of organizationIds) {
      scanned.add(organizationId);
      try {
        const removed = await sweep.purge(organizationId);
        purgedByKind[sweep.kind] += removed.length;
      } catch (err) {
        /* Logged with the tenant and the register so it can be chased, and not
         * rethrown: one bad row must not freeze retention for every other
         * customer, or for the next register. */
        console.error(`[cron] ${sweep.kind} purge failed for ${organizationId}`, err);
        failed.add(organizationId);
      }
    }
  }

  const purged = Object.values(purgedByKind).reduce((a, b) => a + b, 0);

  const summary = {
    ok: true,
    retentionDays: TRASH_RETENTION_DAYS,
    organizationsScanned: scanned.size,
    recordsPurged: purged,
    purgedByKind,
    // Kept under its old name as well: this is the figure the first version of
    // this job reported, and something may be reading it.
    systemsPurged: purgedByKind.system ?? 0,
    organizationsFailed: failed.size,
    tookMs: Date.now() - startedAt,
  };

  // Logged as well as returned: nobody reads a cron's response body, and this
  // is the record that the job ran and what it did.
  console.info("[cron] purge-trash", summary);

  return NextResponse.json(summary);
}
