/**
 * Readiness, computed rather than stored.
 *
 * Every figure on the dashboard is derived here from one organisation's own
 * workspace, so a control losing its evidence moves the headline without anyone
 * editing a number. The alternative — a stored score — is a figure that was true
 * once and cannot be traced back to anything.
 *
 * Every function takes the workspace as its first argument, for the same reason
 * `store.ts` takes `organizationId` first: it makes forgetting whose data you
 * are summarising a type error rather than a number that looks plausible. There
 * is no module-scope register left to fall back to.
 *
 * **The definition that matters.** A control is *ready* only when all three hold:
 * it is applicable, it is marked implemented, and it carries at least one piece
 * of evidence that is verified and not expired. That is deliberately stricter
 * than the number most tools report, and it produces a lower one. It is also the
 * only definition that survives contact with an auditor, who does not care what
 * status you selected — they care what you can hand them.
 *
 * The dashboard shows implemented and evidenced separately for exactly that
 * reason. The gap between them is the most useful number in the product: it is
 * the distance between what an organisation believes about itself and what it
 * could prove on the day.
 */
import { REQUEST_STATUS, daysWaiting } from "./fixtures/requests";
import { isOverdue, utcToday } from "./labels";
import type { ControlApplicability } from "./types";
import type { Workspace } from "./workspace";

/** A document only counts if somebody checked it and it has not lapsed. */
export function isUsableEvidence(ws: Workspace, id: string): boolean {
  const doc = ws.evidenceById(id);
  if (!doc) return false;
  if (doc.verificationState !== "verified") return false;
  return !doc.expiresAt || !isOverdue(doc.expiresAt);
}

export function hasUsableEvidence(ws: Workspace, row: ControlApplicability): boolean {
  return row.linkedEvidenceIds.some((id) => isUsableEvidence(ws, id));
}

export function isReady(ws: Workspace, row: ControlApplicability): boolean {
  return (
    row.applicability === "yes" &&
    row.implementationStatus === "implemented" &&
    hasUsableEvidence(ws, row)
  );
}

/** The scoped rows — everything the Statement of Applicability says is in. */
function applicableRows(ws: Workspace): ControlApplicability[] {
  return ws.applicability.filter((row) => row.applicability === "yes");
}

function share(done: number, total: number) {
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/* ------------------------------------------------------------- the headline */

export function frameworkReadiness(ws: Workspace) {
  const applicable = applicableRows(ws);
  const implemented = applicable.filter((r) => r.implementationStatus === "implemented");
  const evidenced = applicable.filter((r) => hasUsableEvidence(ws, r));
  const ready = applicable.filter((r) => isReady(ws, r));

  return {
    ready: share(ready.length, applicable.length),
    implemented: share(implemented.length, applicable.length),
    evidenced: share(evidenced.length, applicable.length),
    /** The distance between what we claim and what we could hand over. */
    provenGap: implemented.length - ready.length,
    scoped: ws.applicability.length,
    excluded: ws.applicability.length - applicable.length,
  };
}

/** Readiness per clause or Annex A area, for the breakdown. */
export function readinessByNode(ws: Workspace) {
  return ws.nodes.map((node) => {
    const controls = ws.controls.filter((c) => c.nodeId === node.id);
    const rows = controls
      .map((c) => ws.applicabilityFor(c.id))
      .filter((r): r is ControlApplicability => r !== undefined && r.applicability === "yes");

    return {
      node,
      ...share(rows.filter((r) => isReady(ws, r)).length, rows.length),
      /** Applicable count is what the tree shows; excluded areas read as "—". */
      applicable: rows.length,
      total: controls.length,
    };
  });
}

/* ---------------------------------------------------------- the other rails */

export function policyPosture(ws: Workspace) {
  const approved = ws.policies.filter((p) => p.status === "approved");
  return {
    ...share(approved.length, ws.policies.length),
    dueForReview: approved.filter((p) => isOverdue(p.nextReviewDate)).length,
    unapproved: ws.policies.filter((p) => p.status !== "approved"),
    /** Applicable controls citing no policy at all. */
    controlsWithoutPolicy: applicableRows(ws).filter((r) => !r.linkedPolicyId).length,
  };
}

export function evidencePosture(ws: Workspace) {
  const usable = ws.evidence.filter((e) => isUsableEvidence(ws, e.id));
  const expired = ws.evidence.filter(
    (e) => e.verificationState === "expired" || (e.expiresAt && isOverdue(e.expiresAt)),
  );
  /* Sixty days is the window in which a renewal can still be arranged calmly. */
  const soon = ws.evidence.filter((e) => {
    if (!e.expiresAt || isOverdue(e.expiresAt)) return false;
    const days = (new Date(e.expiresAt).getTime() - new Date(utcToday()).getTime()) / 86_400_000;
    return days <= 60;
  });

  return {
    ...share(usable.length, ws.evidence.length),
    expired,
    expiringSoon: soon,
    unverified: ws.evidence.filter((e) => e.verificationState === "unverified"),
    controlsWithoutEvidence: applicableRows(ws).filter((r) => !hasUsableEvidence(ws, r)),
  };
}

export function systemPosture(ws: Workspace) {
  const assessed = ws.systems.filter((s) =>
    ws.assessments.some((a) => a.systemId === s.id && a.status === "approved"),
  );

  const byOrigin = (["procured_saas", "api_integration", "internal_model"] as const).map(
    (origin) => ({
      origin,
      count: ws.systems.filter((s) => s.origin === origin).length,
    }),
  );

  const byRisk = (["minimal", "limited", "high", "unacceptable"] as const).map((tier) => ({
    tier,
    count: ws.systems.filter((s) => s.riskTier === tier).length,
  }));

  return {
    ...share(assessed.length, ws.systems.length),
    total: ws.systems.length,
    genAi: ws.systems.filter((s) => s.isGenAi).length,
    discovered: ws.systems.filter(
      (s) => s.discoveredVia && s.discoveredVia !== "manual" && s.discoveredVia !== "import",
    ),
    byOrigin,
    byRisk,
  };
}

/* ------------------------------------------------------- attention required */

export type AttentionSeverity = "critical" | "warn";

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  /** The group heading. Kept short — it is a column, not a sentence. */
  kind: string;
  title: string;
  detail: string;
  href: string;
}

/**
 * What somebody has to do something about, ordered worst first.
 *
 * The list is deliberately not exhaustive. A dashboard that surfaces forty
 * items surfaces nothing — the reader scans two and closes the tab. Each
 * generator below answers one question a compliance lead would actually be
 * asked in a review, and anything that is merely untidy is left off.
 */
export function attentionRequired(ws: Workspace): AttentionItem[] {
  const items: AttentionItem[] = [];
  const applicable = applicableRows(ws);
  const evidence = evidencePosture(ws);
  const frameworkHref = ws.framework ? `/frameworks/${ws.framework.id}` : "/frameworks";

  // A system nobody has claimed a single control against.
  for (const system of ws.systems) {
    const claimed = applicable.some((r) => r.appliesToSystemIds.includes(system.id));
    if (!claimed) {
      items.push({
        id: `unclaimed-${system.id}`,
        severity: system.riskTier === "high" ? "critical" : "warn",
        kind: "Ungoverned system",
        title: system.name,
        detail:
          "No control is claimed against this system, so it contributes nothing to readiness and nothing covers it.",
        href: `/inventory/${system.id}`,
      });
    }
  }

  // High risk without an approved assessment is the finding an auditor writes.
  for (const system of ws.systems) {
    if (system.riskTier !== "high") continue;
    const approved = ws.assessments.some(
      (a) => a.systemId === system.id && a.status === "approved",
    );
    if (!approved) {
      items.push({
        id: `unassessed-${system.id}`,
        severity: "critical",
        kind: "High risk, unassessed",
        title: system.name,
        detail: "High risk tier with no approved impact assessment.",
        href: `/inventory/${system.id}`,
      });
    }
  }

  for (const system of ws.systems) {
    if (isOverdue(system.nextReviewDate)) {
      items.push({
        id: `review-${system.id}`,
        severity: "warn",
        kind: "Overdue review",
        title: system.name,
        detail: `Review was due ${system.nextReviewDate}.`,
        href: `/inventory/${system.id}`,
      });
    }
  }

  for (const finding of ws.findings) {
    if (finding.status === "closed") continue;
    const late = isOverdue(finding.dueAt);
    items.push({
      id: `finding-${finding.id}`,
      severity: finding.severity === "critical" || late ? "critical" : "warn",
      kind: late ? "Overdue finding" : "Open finding",
      title: finding.title,
      detail: finding.summary,
      href: `/findings/${finding.id}`,
    });
  }

  for (const doc of evidence.expired) {
    const controls = applicable.filter((r) => r.linkedEvidenceIds.includes(doc.id));
    items.push({
      id: `expired-${doc.id}`,
      severity: "critical",
      kind: "Expired evidence",
      title: doc.title,
      detail: `${controls.length} control${controls.length === 1 ? "" : "s"} rely on this document, and it has lapsed.`,
      href: frameworkHref,
    });
  }

  for (const row of evidence.controlsWithoutEvidence) {
    if (row.implementationStatus !== "implemented") continue;
    const control = ws.controlById(row.controlId);
    if (!control) continue;
    items.push({
      id: `noevidence-${row.controlId}`,
      severity: "warn",
      kind: "Claimed, unproven",
      title: `${control.officialRef} — ${control.shortTitle}`,
      detail: "Marked implemented with no evidence that is verified and current.",
      href: frameworkHref,
    });
  }

  for (const request of ws.requests) {
    if (!REQUEST_STATUS[request.status].open) continue;
    const days = daysWaiting(request);
    if (days <= 10) continue;
    items.push({
      id: `request-${request.id}`,
      severity: "warn",
      kind: "Stalled request",
      title: request.submission.name,
      detail: `${request.reference} has been waiting ${days} days.`,
      href: `/intake/${request.id}`,
    });
  }

  // Untreated high-scoring risk, which is the one a board asks about.
  for (const risk of ws.risks) {
    if (risk.status !== "open") continue;
    if (risk.residualLikelihood * risk.residualImpact < 12) continue;
    items.push({
      id: `risk-${risk.id}`,
      severity: "critical",
      kind: "High residual risk",
      title: risk.title,
      detail: risk.treatmentSummary,
      href: `/risks/${risk.id}`,
    });
  }

  return items.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1,
  );
}

/** How many items the list actually shows before it stops being read. */
export const ATTENTION_LIMIT = 12;

/**
 * The list as the dashboard shows it: worst first, capped, with an honest tail.
 *
 * Capping is the point rather than a compromise. Thirty-two rows is a backlog,
 * and a backlog on a dashboard gets scrolled past — so the screen shows the
 * twelve that matter and states plainly what it is not showing, grouped by kind.
 * Hiding the remainder silently would be the actual sin; hiding it with a count
 * and a name is just editing.
 */
export function attentionSummary(ws: Workspace) {
  const all = attentionRequired(ws);
  const shown = all.slice(0, ATTENTION_LIMIT);
  const rest = all.slice(ATTENTION_LIMIT);

  const remainder = new Map<string, number>();
  for (const item of rest) {
    remainder.set(item.kind, (remainder.get(item.kind) ?? 0) + 1);
  }

  return {
    shown,
    total: all.length,
    critical: all.filter((a) => a.severity === "critical").length,
    remainder: [...remainder.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/* ---------------------------------------------------------- evidence blast radius */

/**
 * What breaks if this document lapses.
 *
 * The reason an evidence record is worth having at all. A document is not
 * interesting in itself — what matters is the set of controls resting on it and
 * whether any of them are resting on it *alone*. When the Microsoft DPA expires,
 * the question nobody can otherwise answer is which controls silently stopped
 * being evidenced, and `soleSupport` is that answer.
 *
 * `wouldFallBack` is the softer case: the control keeps other usable evidence,
 * so losing this one costs depth rather than coverage. Worth showing separately,
 * because treating the two the same is how a renewal gets deprioritised.
 */
export function evidenceDependants(ws: Workspace, evidenceId: string) {
  const controls = ws.applicability.filter((row) =>
    row.linkedEvidenceIds.includes(evidenceId),
  );

  const soleSupport = controls.filter(
    (row) =>
      !row.linkedEvidenceIds.some((id) => id !== evidenceId && isUsableEvidence(ws, id)),
  );

  return {
    controls,
    soleSupport,
    wouldFallBack: controls.filter((row) => !soleSupport.includes(row)),
    systems: [...new Set(controls.flatMap((row) => row.appliesToSystemIds))],
  };
}
