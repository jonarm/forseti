/**
 * The audit evidence pack — what it contains, and what an auditor will find in it.
 *
 * The pack is the artefact everything else exists to produce: the bundle handed
 * over at a certification audit. Composing it is the easy half. The half that
 * earns the screen is `preflight()`, which reads the same registers and reports
 * what a competent auditor will notice **before** they notice it.
 *
 * That is a deliberate inversion of how these tools usually behave. Most
 * generate a document that looks complete because generating a document that
 * looks complete is what a generator does — every section present, every table
 * populated, nothing flagged. The organisation then discovers the holes in the
 * room, with the auditor. A pack that opens by listing its own weaknesses is
 * less impressive and considerably more useful, and it is the only version that
 * changes what happens in the audit rather than merely documenting it.
 *
 * A pack is a snapshot. Generated on a date, from the records as they stood that
 * day, and regenerating tomorrow legitimately produces a different pack — which
 * is why the cover carries the date and the period rather than pretending to be
 * a standing document.
 */
import { canClose, riskScore } from "./fixtures/registers";
import { hasUsableEvidence, isUsableEvidence, frameworkReadiness } from "./readiness";
import { utcToday } from "./labels";
import type { Workspace } from "./workspace";

/* ------------------------------------------------------------- composition */

export interface PackSection {
  id: string;
  title: string;
  /** What an auditor uses it for — shown beside the toggle, not in the document. */
  purpose: string;
  /** Rough printed length, so turning sections off visibly costs something. */
  pages: number;
  /** Sections a certification audit will not proceed without. */
  required: boolean;
  rows: number;
}

export function packSections(ws: Workspace): PackSection[] {
  const applicable = ws.applicability.filter((r) => r.applicability === "yes");

  return [
    {
      id: "scope",
      title: "Scope and management system",
      purpose:
        "Establishes what is being certified and what is deliberately outside it. The first thing challenged.",
      pages: 2,
      rows: 1,
      required: true,
    },
    {
      id: "soa",
      title: "Statement of Applicability",
      purpose:
        "Every control, its applicability and the justification for anything excluded. The document the audit is structured around.",
      pages: 9,
      rows: ws.applicability.length,
      required: true,
    },
    {
      id: "inventory",
      title: "AI system inventory",
      purpose:
        "What is in scope, by name. An auditor samples from here and follows each one through the other sections.",
      pages: 3,
      rows: ws.systems.length,
      required: true,
    },
    {
      id: "use-cases",
      title: "Use case register",
      purpose:
        "What each tool is actually used for, and how risky each of those jobs is. The inventory says what was procured; this says what is being done with it, which is the level a regulator asks about.",
      pages: 4,
      rows: ws.useCases.length,
      /*
       * Not required, and the distinction is real: a certification audit will
       * not proceed without a Statement of Applicability, and it will proceed
       * without this. That is a fact about what auditors demand rather than
       * about what is worth showing them — a tool serving four purposes of
       * differing risk is a story the inventory row cannot tell, and an
       * auditor sampling from the inventory has no way to ask for it if the
       * pack never offers it.
       */
      required: false,
    },
    {
      id: "assessments",
      title: "Impact assessments",
      purpose:
        "Evidence that consequences were considered before deployment, with a sign-off chain.",
      pages: 12,
      rows: ws.assessments.length,
      required: true,
    },
    {
      id: "evidence",
      title: "Evidence index",
      purpose:
        "Each document, its verification state, and which controls rest on it. Where sampling starts.",
      pages: 4,
      rows: ws.evidence.length,
      required: true,
    },
    {
      id: "risks",
      title: "Risk register",
      purpose: "Inherent, treatment, residual, and who accepted what remains.",
      pages: 3,
      rows: ws.risks.length,
      required: true,
    },
    {
      id: "findings",
      title: "Findings and corrective actions",
      purpose:
        "Nonconformities, their root causes and verified closures. A register with nothing in it is a finding of its own.",
      pages: 4,
      rows: ws.findings.length,
      required: true,
    },
    {
      id: "policies",
      title: "Policy set",
      purpose: "The approved policies the controls cite, at the versions in force.",
      pages: 18,
      rows: ws.policies.length,
      required: false,
    },
    {
      id: "coverage",
      title: "Control coverage by system",
      purpose:
        "Which controls are claimed against which system. Useful, not required — and it exposes the systems nothing covers.",
      pages: 5,
      rows: applicable.length,
      required: false,
    },
  ];
}

/* ----------------------------------------------------------------- preflight */

export type PreflightSeverity = "blocker" | "weakness";

export interface PreflightIssue {
  id: string;
  severity: PreflightSeverity;
  /** What the auditor will say, in their words rather than ours. */
  title: string;
  detail: string;
  count: number;
  href: string;
  /** Which pack section it lands in, so the finding has an address. */
  section: string;
}

/**
 * What a competent auditor finds in this pack.
 *
 * A **blocker** is something that stops a certification audit proceeding or
 * produces a major nonconformity: an exclusion nobody argued, a system in scope
 * that no control covers, a finding closed by the person who fixed it. A
 * **weakness** is something they will note and probe: unverified evidence,
 * unaccepted residual risk, an assessment that has not been approved.
 *
 * The distinction matters because it decides what gets fixed this week.
 */
export function preflight(ws: Workspace): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const applicable = ws.applicability.filter((r) => r.applicability === "yes");
  const excluded = ws.applicability.filter((r) => r.applicability !== "yes");
  const soaHref = ws.framework ? `/frameworks/${ws.framework.id}` : "/frameworks";

  const thinJustification = excluded.filter((r) => r.justification.trim().length < 80);
  if (thinJustification.length > 0) {
    issues.push({
      id: "thin-justifications",
      severity: "blocker",
      title: "Exclusions without a justification an auditor can weigh",
      detail:
        "A one-line exclusion states a conclusion without the argument. Each needs to name the activity not undertaken, any exception to it, and what would trigger a review.",
      count: thinJustification.length,
      href: `${soaHref}?lens=excluded`,
      section: "Statement of Applicability",
    });
  }

  const unproven = applicable.filter(
    (r) => r.implementationStatus === "implemented" && !hasUsableEvidence(ws, r),
  );
  if (unproven.length > 0) {
    issues.push({
      id: "unproven",
      severity: "blocker",
      title: "Controls claimed implemented with nothing to show for them",
      detail:
        "Sampling lands here first. A control marked implemented and evidenced by nothing current is the shortest route to a major nonconformity.",
      count: unproven.length,
      href: `${soaHref}?lens=unproven`,
      section: "Statement of Applicability",
    });
  }

  const uncovered = ws.systems.filter(
    (s) => !applicable.some((r) => r.appliesToSystemIds.includes(s.id)),
  );
  if (uncovered.length > 0) {
    issues.push({
      id: "uncovered-systems",
      severity: "blocker",
      title: "Systems in the inventory that no control covers",
      detail:
        "They are in scope by virtue of being listed, and nothing in the management system reaches them. An auditor will ask why they are in the pack.",
      count: uncovered.length,
      href: "/inventory?discovered=1",
      section: "AI system inventory",
    });
  }

  const selfClosed = ws.findings.filter(
    (f) => f.status === "closed" && !canClose(f).ok,
  );
  if (selfClosed.length > 0) {
    issues.push({
      id: "self-closed",
      severity: "blocker",
      title: "Findings closed without an independent verification",
      detail:
        "Closed findings are sampled deliberately. One closed by the person who fixed it undermines the whole corrective action process, not just that record.",
      count: selfClosed.length,
      href: "/findings?status=closed",
      section: "Findings and corrective actions",
    });
  }

  const expiredInUse = ws.evidence.filter(
    (e) =>
      !isUsableEvidence(ws, e.id) &&
      applicable.some((r) => r.linkedEvidenceIds.includes(e.id)),
  );
  if (expiredInUse.length > 0) {
    issues.push({
      id: "expired-evidence",
      severity: "weakness",
      title: "Evidence cited by a control but expired or never verified",
      detail:
        "It is in the index and it is not usable. Better to withdraw it and show the gap than to include it and have the gap found.",
      count: expiredInUse.length,
      href: "/evidence?lens=expired",
      section: "Evidence index",
    });
  }

  const highRiskUnassessed = ws.systems.filter(
    (s) =>
      s.riskTier === "high" &&
      !ws.assessments.some((a) => a.systemId === s.id && a.status === "approved"),
  );
  if (highRiskUnassessed.length > 0) {
    issues.push({
      id: "high-risk-unassessed",
      severity: "weakness",
      title: "High risk systems with no approved impact assessment",
      detail:
        "The pack shows the tier and the absence side by side. Expect a question about how the tier was set without one.",
      count: highRiskUnassessed.length,
      href: "/assessments?status=open",
      section: "Impact assessments",
    });
  }

  const unaccepted = ws.risks.filter(
    (r) => r.acceptedById === null && riskScore(r.residualLikelihood, r.residualImpact) >= 8,
  );
  if (unaccepted.length > 0) {
    issues.push({
      id: "unaccepted-residual",
      severity: "weakness",
      title: "Elevated residual risk nobody has accepted",
      detail:
        "Every one has an owner. None has a name against the residue, so the register records work done and nothing agreed.",
      count: unaccepted.length,
      href: "/risks?lens=unaccepted",
      section: "Risk register",
    });
  }

  const draftPolicies = ws.policies.filter((p) => p.status !== "approved");
  if (draftPolicies.length > 0) {
    issues.push({
      id: "draft-policies",
      severity: "weakness",
      title: "Controls citing a policy that is not approved",
      detail:
        "A draft is a document, not a control. Any control resting on one is unevidenced however complete the draft reads.",
      count: draftPolicies.length,
      href: `${soaHref}?lens=no-policy`,
      section: "Policy set",
    });
  }

  return issues.sort((a, b) =>
    a.severity === b.severity ? b.count - a.count : a.severity === "blocker" ? -1 : 1,
  );
}

/* ------------------------------------------------------------------ summary */

export function packSummary(ws: Workspace, selected: Set<string>) {
  const sections = packSections(ws).filter((s) => selected.has(s.id));
  const issues = preflight(ws);

  return {
    framework: ws.framework,
    preparedOn: utcToday(),
    /* A pack covers a period; a certification audit asks what changed in it. */
    periodFrom: "2025-08-11",
    periodTo: utcToday(),
    sections,
    pages: sections.reduce((n, s) => n + s.pages, 0),
    rows: sections.reduce((n, s) => n + s.rows, 0),
    controls: ws.controls.length,
    readiness: frameworkReadiness(ws),
    blockers: issues.filter((i) => i.severity === "blocker"),
    weaknesses: issues.filter((i) => i.severity === "weakness"),
  };
}

/** Controls, resolved for the SoA table in the preview. */
export function soaRows(ws: Workspace) {
  return ws.applicability
    .map((row) => ({ row, control: ws.controlById(row.controlId) }))
    .filter((r) => r.control);
}
