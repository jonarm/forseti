import { APPLICABILITY, EVIDENCE_TYPE, formatDate, isOverdue } from "../ams/labels";
import type { Workspace } from "../ams/workspace";
import type {
  Applicability,
  AnswerCitation,
  Evidence,
  FrameworkControl,
  Policy,
} from "../ams/types";

/**
 * The one description of the organization every AI feature reads from.
 *
 * Two prompts describing the same tenant differently is how a copilot ends up
 * contradicting the register it is quoting, so there is one module and every
 * drafting feature grounds through it. The GDPR toolkit learned this the
 * expensive way with `orgFactSheet()`/`evidenceBrief()`; this is that rule
 * carried forward onto the workspace.
 *
 * **Everything here names records, never categories.** A recommendation citing
 * "internal analysis" is unarguable in the bad sense — the compliance lead has
 * nothing to push back on, so they accept it blind or ignore it. Every string
 * this module produces contains an id, a title or a date somebody can go and
 * check, which is what makes disagreement possible.
 *
 * It also refuses to launder a weak record into a strong one. An expired
 * document cited as support is the failure these features exist to prevent, so
 * standing is computed from the record's own state and reported even when it
 * makes the draft look worse.
 */

/**
 * How long a stubbed draft takes to come back.
 *
 * Deliberate, and not only cosmetic. An answer that appears instantly reads as a
 * lookup, and the claim this product makes is that something was *considered* —
 * a reviewer who sees no elapsed time stops reading the reasoning by the third
 * one. It also keeps the loading states on screen honest: `drafting` is a real
 * state a real call will occupy, and code paths that only ever run for 0ms are
 * code paths nobody has actually seen.
 */
export const DRAFT_DELAY_MS = 900;

export function stall(ms = DRAFT_DELAY_MS): Promise<void> {
  // Skipped under vitest. The pause is a claim made to a *reader* — that
  // something was considered — and no reader is present in a test; paying it
  // per assertion would add half a minute to the suite to prove nothing. The
  // behaviour under test is what the draft says, not how long it took.
  if (process.env.VITEST) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------- standing */

/**
 * Whether a document currently supports a claim, and in one phrase, why.
 *
 * `sound` is the field that matters. Evidence that is expired, rejected, merely
 * unverified, or recorded without a file attached does not support an answer —
 * and the last of those is the one that hides, because the register looks full.
 */
export function evidenceStanding(e: Evidence): { sound: boolean; detail: string } {
  const kind = EVIDENCE_TYPE[e.type] ?? e.type;

  if (e.verificationState === "rejected") {
    return { sound: false, detail: `${kind} — rejected at verification` };
  }
  if (e.verificationState === "expired") {
    return { sound: false, detail: `${kind} — expired, collected ${formatDate(e.collectedAt)}` };
  }
  if (e.expiresAt && isOverdue(e.expiresAt)) {
    return { sound: false, detail: `${kind} — lapsed ${formatDate(e.expiresAt)}` };
  }
  if (e.file === null) {
    return { sound: false, detail: `${kind} — recorded, but no document attached` };
  }
  if (e.verificationState === "unverified") {
    return { sound: false, detail: `${kind} — collected ${formatDate(e.collectedAt)}, not yet verified` };
  }
  return {
    sound: true,
    detail: e.expiresAt
      ? `${kind} — verified, current until ${formatDate(e.expiresAt)}`
      : `${kind} — verified ${formatDate(e.collectedAt)}`,
  };
}

/**
 * Only an approved policy satisfies a control. A draft is a document, however
 * complete it reads, and a lapsed review date means nobody has confirmed it
 * still describes what the company does.
 */
export function policyStanding(p: Policy): { sound: boolean; detail: string } {
  if (p.status === "approved" && isOverdue(p.nextReviewDate)) {
    return { sound: false, detail: `v${p.version} — approved, but review overdue since ${formatDate(p.nextReviewDate)}` };
  }
  if (p.status === "approved") {
    return {
      sound: true,
      detail: p.approvedAt
        ? `v${p.version} — approved ${formatDate(p.approvedAt)}, next review ${formatDate(p.nextReviewDate)}`
        : `v${p.version} — approved, next review ${formatDate(p.nextReviewDate)}`,
    };
  }
  if (p.status === "expired") {
    return { sound: false, detail: `v${p.version} — expired` };
  }
  return { sound: false, detail: `v${p.version} — ${p.status === "in_review" ? "in review" : "draft"}, not adopted` };
}

/* --------------------------------------------------------- what backs a control */

export interface ControlSupport {
  control: FrameworkControl;
  policy: Policy | null;
  evidence: Evidence[];
  /** Evidence whose standing currently holds. The rest is named, not hidden. */
  sound: Evidence[];
  systems: { id: string; name: string }[];
  /**
   * The stored value, not its label.
   *
   * Logic compares this; only a render path may reach for
   * `APPLICABILITY[...].label`. The refusal gate in `answer.ts` turns on whether
   * a control is applicable, and a gate that compares display copy inverts
   * silently the day somebody rewords "Applicable" to "In scope" — which is a
   * copy edit nobody would think to test.
   */
  applicability: Applicability | null;
  implementation: string;
  owner: string | null;
}

/**
 * Everything the organization's own records say about one control.
 *
 * Assembled from the workspace rather than passed in, for the same reason an AI
 * route reads its context from the store: a caller that can choose the
 * supporting facts can choose the conclusion.
 */
export function controlSupport(ws: Workspace, controlId: string): ControlSupport | null {
  const control = ws.controlById(controlId);
  if (!control) return null;

  const row = ws.applicabilityFor(controlId);
  const policy = row?.linkedPolicyId ? (ws.policyById(row.linkedPolicyId) ?? null) : null;

  const evidence = (row?.linkedEvidenceIds ?? [])
    .map((id) => ws.evidenceById(id))
    .filter((e): e is Evidence => e !== undefined);

  const systems = (row?.appliesToSystemIds ?? [])
    .map((id) => ws.systemById(id))
    .filter((s): s is NonNullable<ReturnType<Workspace["systemById"]>> => s !== undefined)
    .map((s) => ({ id: s.id, name: s.name }));

  return {
    control,
    policy,
    evidence,
    sound: evidence.filter((e) => evidenceStanding(e).sound),
    systems,
    applicability: row?.applicability ?? null,
    implementation: row?.implementationStatus ?? "not_started",
    owner: row?.ownerId ? ws.personById(row.ownerId).name : null,
  };
}

/* --------------------------------------------------------------- rendering */

export type SupportingDatum = { label: string; detail: string; href?: string };

/**
 * A control's backing rendered as the card's supporting rows.
 *
 * Unsound records are included and marked rather than filtered out. A card that
 * silently drops the expired DPIA is telling the reader the control is better
 * supported than it is, which is the one output worse than no draft at all.
 */
export function supportingDataFor(support: ControlSupport): SupportingDatum[] {
  const rows: SupportingDatum[] = [
    {
      label: "Control",
      detail: `${support.control.officialRef} — ${support.control.shortTitle}`,
    },
  ];

  if (support.systems.length > 0) {
    rows.push({
      label: "Claimed against",
      detail: support.systems.map((s) => s.name).join(", "),
      href: `/inventory/${support.systems[0].id}`,
    });
  } else {
    rows.push({ label: "Claimed against", detail: "No system — the control is not claimed anywhere" });
  }

  if (support.policy) {
    const { detail } = policyStanding(support.policy);
    rows.push({ label: support.policy.title, detail });
  } else {
    rows.push({ label: "Policy", detail: "None linked" });
  }

  for (const e of support.evidence.slice(0, 3)) {
    const { detail } = evidenceStanding(e);
    rows.push({ label: e.title, detail, href: `/evidence/${e.id}` });
  }

  if (support.evidence.length === 0) {
    rows.push({ label: "Evidence", detail: "Nothing attached to this control" });
  } else if (support.evidence.length > 3) {
    rows.push({
      label: "Further evidence",
      detail: `${support.evidence.length - 3} more attached, ${support.sound.length} of ${support.evidence.length} currently usable`,
    });
  }

  return rows;
}

/** The same backing, in the shape the questionnaire's provenance strip wants. */
export function citationsFor(support: ControlSupport): AnswerCitation[] {
  const cites: AnswerCitation[] = [
    {
      kind: "control",
      id: support.control.id,
      label: `${support.control.officialRef} ${support.control.shortTitle}`,
      detail: `${support.applicability ? APPLICABILITY[support.applicability].label : "Not yet decided"}, ${support.implementation.replace(/_/g, " ")}`,
      sound: support.applicability === "yes",
      href: `/frameworks/${support.control.frameworkId}?control=${support.control.id}`,
    },
  ];

  if (support.policy) {
    const { sound, detail } = policyStanding(support.policy);
    cites.push({
      kind: "policy",
      id: support.policy.id,
      label: support.policy.title,
      detail,
      sound,
      href: `/frameworks/${support.control.frameworkId}?policy=${support.policy.id}`,
    });
  }

  for (const e of support.evidence) {
    const { sound, detail } = evidenceStanding(e);
    cites.push({ kind: "evidence", id: e.id, label: e.title, detail, sound, href: `/evidence/${e.id}` });
  }

  return cites;
}

/**
 * The most recent verification among the cited evidence — or null.
 *
 * Deliberately the *oldest* sound collection date rather than the newest: an
 * answer is only as current as the weakest thing holding it up, and quoting the
 * freshest document flatters a set that contains a two-year-old export.
 */
export function lastVerifiedAmong(evidence: Evidence[]): string | null {
  const dates = evidence.filter((e) => evidenceStanding(e).sound).map((e) => e.collectedAt).sort();
  return dates[0] ?? null;
}

/** Problems the sender should be told before anything goes to a customer. */
export function caveatsFor(support: ControlSupport): string[] {
  const caveats: string[] = [];

  const stale = support.evidence.filter((e) => !evidenceStanding(e).sound);
  for (const e of stale) {
    caveats.push(`${e.title} — ${evidenceStanding(e).detail}. Cited here because it is what the control has.`);
  }

  if (support.policy && !policyStanding(support.policy).sound) {
    caveats.push(
      `${support.policy.title} is ${support.policy.status === "approved" ? "past its review date" : "not approved"}, so it states an intention rather than an adopted position.`,
    );
  }

  if (support.implementation === "in_progress" || support.implementation === "planned") {
    caveats.push(
      `The control is ${support.implementation.replace(/_/g, " ")}, so this describes what is being built rather than what is running today.`,
    );
  }

  return caveats;
}

/** Today, in the format every stored timestamp in this codebase uses. */
export function nowIso(): string {
  return new Date().toISOString();
}
