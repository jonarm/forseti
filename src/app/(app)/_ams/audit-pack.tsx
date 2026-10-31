"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Download, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { packSections, packSummary, preflight, soaRows } from "@/lib/ams/audit-pack";
import { currentStage } from "@/lib/ams/fixtures/assessments";
import { FINDING_SOURCE, riskScore } from "@/lib/ams/fixtures/registers";
import { evidenceDependants } from "@/lib/ams/readiness";
import {
  APPLICABILITY as APPLICABILITY_LABEL,
  ASSESSMENT_STATUS,
  ORIGIN,
  OVERSIGHT,
  RISK_TIER,
  VERIFICATION,
  formatDate,
} from "@/lib/ams/labels";
import { useWorkspace } from "@/lib/ams/workspace-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The audit evidence pack.
 *
 * Two panes, and the left one is the argument. Most tools in this category
 * generate a document that looks complete, because looking complete is what a
 * generator does — and the organisation then meets the holes in the room, with
 * the auditor. This screen opens by telling you what a competent auditor will
 * find in the pack you are about to hand over, separated into what stops the
 * audit and what merely gets probed.
 *
 * Every issue is derived from the registers rather than declared here, and every
 * one links to the record that would fix it. A pre-flight list you cannot act on
 * is just a nicer way of being told off.
 */
const PAPER = "rounded-lg border border-border bg-secondary/10 px-8 py-7";

export function AuditPack() {
  const ws = useWorkspace();
  const {
    personById,
    systems: SYSTEMS,
    useCases: USE_CASES,
    getSystemsForUseCase,
    effectiveTier,
    evidence: EVIDENCE,
    assessments: ASSESSMENTS,
    findings: FINDINGS,
    risks: RISKS,
  } = ws;
  const sections = packSections(ws);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sections.map((s) => s.id)),
  );
  const summary = useMemo(() => packSummary(ws, selected), [ws, selected]);
  const issues = useMemo(() => preflight(ws), [ws]);

  function toggle(id: string, required: boolean) {
    if (required) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Audit evidence pack</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The bundle handed over at a certification audit, assembled from the
            registers as they stand today. A pack is a snapshot — regenerate
            tomorrow and it legitimately differs, which is why the cover carries
            a date rather than pretending to be a standing document.
          </p>
        </div>
        {/* The document below is the pack. Rendering it to PDF is the next
          * slice, and a button that reported a file it had not written would be
          * the one claim on this screen an auditor could catch us on. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex cursor-not-allowed opacity-55" tabIndex={0}>
                <Button size="sm" disabled>
                  <Download aria-hidden />
                  Generate pack
                </Button>
              </span>
            }
          />
          <TooltipContent side="left" className="max-w-xs">
            Preview only for now. Everything below is assembled from your live
            registers; writing it out as a filed PDF comes next.
          </TooltipContent>
        </Tooltip>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------- contents + preflight */}
        <aside className="w-96 shrink-0 space-y-5 overflow-y-auto border-r border-border p-4">
          <section className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-medium">What an auditor will find</h2>
              <span className="ml-auto text-xs tabular text-muted-foreground">
                {summary.blockers.length + summary.weaknesses.length} items
              </span>
            </div>
            <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
              Read from the same registers the pack is built from. Fix these
              before the pack goes out, or expect to discuss them in the room.
            </p>

            <ul className="space-y-2 pt-1">
              {issues.map((issue) => (
                <li key={issue.id}>
                  <Link
                    href={issue.href}
                    className={cn(
                      "group block space-y-1 rounded-md border px-2.5 py-2 transition-colors",
                      issue.severity === "blocker"
                        ? "border-critical/30 bg-critical/5 hover:border-critical/50"
                        : "border-warn/25 bg-warn/5 hover:border-warn/40",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          issue.severity === "blocker" ? "text-critical" : "text-warn",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 text-[0.8125rem] font-medium leading-snug group-hover:underline">
                        {issue.title}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 tabular text-[0.8125rem]",
                          issue.severity === "blocker" ? "text-critical" : "text-warn",
                        )}
                      >
                        {issue.count}
                      </span>
                    </div>
                    <p className="pl-5 text-[0.75rem] leading-relaxed text-muted-foreground">
                      {issue.detail}
                    </p>
                    <p className="flex items-center gap-1 pl-5 text-[0.6875rem] text-muted-foreground/60">
                      {issue.section}
                      <ArrowRight className="size-3" aria-hidden />
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-medium">Contents</h2>
              <span className="ml-auto text-xs tabular text-muted-foreground">
                ~{summary.pages} pages
              </span>
            </div>
            <ul className="space-y-1.5">
              {sections.map((section) => (
                <li key={section.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors",
                      selected.has(section.id)
                        ? "border-border bg-secondary/40"
                        : "border-border/60 opacity-55",
                      section.required && "cursor-default",
                    )}
                  >
                    <Checkbox
                      checked={selected.has(section.id)}
                      disabled={section.required}
                      onCheckedChange={() => toggle(section.id, section.required)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[0.8125rem] font-medium">{section.title}</span>
                        {section.required && (
                          <span className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
                            Required
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-[0.6875rem] tabular text-muted-foreground/60">
                          {section.rows} · {section.pages}pp
                        </span>
                      </span>
                      <span className="block text-[0.75rem] leading-snug text-muted-foreground">
                        {section.purpose}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-[0.6875rem] leading-relaxed text-muted-foreground/60">
              Required sections cannot be dropped. A pack missing the Statement
              of Applicability is not a pack an audit can start from.
            </p>
          </section>

          <section className="space-y-1.5 rounded-md border border-dashed border-border px-3 py-2.5">
            <p className="text-[0.8125rem] font-medium">
              {summary.pages} pages, preview only
            </p>
            <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
              The document on the right is the pack, read from the registers as
              they stand. Writing it out as a dated PDF — and filing that PDF to
              the evidence register, so what you handed over stays recoverable
              after the registers move on — is not built yet.
            </p>
          </section>
        </aside>

        {/* ------------------------------------------------------- the document */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-background p-6">
          <div className="mx-auto max-w-3xl space-y-5">
            <div className={PAPER}>
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.11em] text-muted-foreground">
                Audit evidence pack
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">
                {summary.framework?.name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Organization preview · prepared {formatDate(summary.preparedOn)}
              </p>
              <p className="mt-3 max-w-2xl text-[0.8125rem] leading-relaxed text-muted-foreground">
                Covering {formatDate(summary.periodFrom)} to{" "}
                {formatDate(summary.periodTo)}. Scope: every AI system used by the
                organisation, whether procured, integrated or built in house, as
                recorded in the AI inventory at the date of preparation.
              </p>

              <dl className="mt-4 grid grid-cols-4 gap-3 border-t border-border/60 pt-4">
                <Tile label="Controls in scope" value={summary.controls} />
                <Tile
                  label="Ready"
                  value={`${summary.readiness.ready.percent}%`}
                  note={`${summary.readiness.ready.done} of ${summary.readiness.ready.total}`}
                />
                <Tile label="Blockers" value={summary.blockers.length} tone="critical" />
                <Tile label="Weaknesses" value={summary.weaknesses.length} tone="warn" />
              </dl>

              <p className="mt-4 border-t border-border/60 pt-3 text-[0.75rem] leading-relaxed text-muted-foreground/70">
                Readiness is reported strictly: a control counts only where it is
                applicable, implemented, and carries evidence that is verified and
                current. {summary.readiness.provenGap} controls are marked
                implemented and could not be evidenced on the date of preparation.
              </p>
            </div>

            {selected.has("soa") && (
              <Doc title="Statement of Applicability" note={`${soaRows(ws).length} controls`}>
                <table className="w-full border-separate border-spacing-0 text-[0.75rem]">
                  <thead>
                    <tr>
                      <Th>Ref</Th>
                      <Th>Control</Th>
                      <Th>Applies</Th>
                      <Th>Justification</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {soaRows(ws)
                      .slice(0, 8)
                      .map(({ row, control }) => (
                        <tr key={row.controlId} className="align-top">
                          <Td mono>{control!.officialRef}</Td>
                          <Td>{control!.shortTitle}</Td>
                          <Td>{APPLICABILITY_LABEL[row.applicability].label}</Td>
                          <Td wrap>{row.justification || "—"}</Td>
                          <Td>{row.implementationStatus.replace(/_/g, " ")}</Td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <Continues n={soaRows(ws).length - 8} />
              </Doc>
            )}

            {selected.has("inventory") && (
              <Doc title="AI system inventory" note={`${SYSTEMS.length} systems`}>
                <table className="w-full border-separate border-spacing-0 text-[0.75rem]">
                  <thead>
                    <tr>
                      <Th>System</Th>
                      <Th>Origin</Th>
                      <Th>Risk</Th>
                      <Th>Owner</Th>
                      <Th>Assessment</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {SYSTEMS.slice(0, 6).map((s) => (
                      <tr key={s.id}>
                        <Td>{s.name}</Td>
                        <Td>{ORIGIN[s.origin].label}</Td>
                        <Td>{RISK_TIER[s.riskTier].label}</Td>
                        <Td>{personById(s.ownerId).name}</Td>
                        <Td>{ASSESSMENT_STATUS[s.assessmentStatus].label}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Continues n={SYSTEMS.length - 6} />
              </Doc>
            )}

            {selected.has("use-cases") && (
              <Doc title="Use case register" note={`${USE_CASES.length} use cases`}>
                <table className="w-full border-separate border-spacing-0 text-[0.75rem]">
                  <thead>
                    <tr>
                      <Th>Use case</Th>
                      <Th>Systems</Th>
                      <Th>Risk</Th>
                      <Th>Oversight</Th>
                      <Th>Owner</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {USE_CASES.slice(0, 8).map((useCase) => {
                      const on = getSystemsForUseCase(useCase.id);
                      /* The purpose's own tier: this table is one row per use
                       * case, and a pairing-level answer would need one row per
                       * pairing. Where a pairing differs, the Systems column is
                       * what tells an auditor there is more than one answer to
                       * ask about. */
                      const tier = effectiveTier(useCase.id);
                      return (
                        <tr key={useCase.id}>
                          <Td>{useCase.name}</Td>
                          <Td>{on.map((system) => system.name).join(", ") || "—"}</Td>
                          <Td>{RISK_TIER[tier].label}</Td>
                          <Td>{OVERSIGHT[useCase.oversightLevel].label}</Td>
                          <Td>{personById(useCase.ownerId).name}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Continues n={USE_CASES.length - 8} />
              </Doc>
            )}

            {selected.has("assessments") && (
              <Doc title="Impact assessments" note={`${ASSESSMENTS.length} assessments`}>
                <ul className="space-y-2.5">
                  {ASSESSMENTS.map((a) => {
                    const stage = currentStage(a);
                    return (
                      <li key={a.id} className="space-y-0.5">
                        <p className="text-[0.8125rem] font-medium">
                          {SYSTEMS.find((s) => s.id === a.systemId)?.name}
                        </p>
                        <p className="text-[0.75rem] text-muted-foreground">
                          {ASSESSMENT_STATUS[a.status].label} ·{" "}
                          {stage
                            ? `awaiting ${personById(stage.assigneeId).name} at "${stage.label}"`
                            : `signed off ${a.signOff[2].completedAt ? formatDate(a.signOff[2].completedAt) : ""}`}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </Doc>
            )}

            {selected.has("evidence") && (
              <Doc title="Evidence index" note={`${EVIDENCE.length} documents`}>
                <table className="w-full border-separate border-spacing-0 text-[0.75rem]">
                  <thead>
                    <tr>
                      <Th>Document</Th>
                      <Th>State</Th>
                      <Th>Expires</Th>
                      <Th>Controls</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {EVIDENCE.slice(0, 7).map((e) => (
                      <tr key={e.id}>
                        <Td>{e.title}</Td>
                        <Td>{VERIFICATION[e.verificationState].label}</Td>
                        <Td>{e.expiresAt ? formatDate(e.expiresAt) : "—"}</Td>
                        <Td>{evidenceDependants(ws, e.id).controls.length}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Continues n={EVIDENCE.length - 7} />
              </Doc>
            )}

            {selected.has("risks") && (
              <Doc title="Risk register" note={`${RISKS.length} risks`}>
                <table className="w-full border-separate border-spacing-0 text-[0.75rem]">
                  <thead>
                    <tr>
                      <Th>Risk</Th>
                      <Th>Inherent</Th>
                      <Th>Residual</Th>
                      <Th>Accepted by</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {RISKS.map((r) => (
                      <tr key={r.id}>
                        <Td wrap>{r.title}</Td>
                        <Td>{riskScore(r.inherentLikelihood, r.inherentImpact)}</Td>
                        <Td>{riskScore(r.residualLikelihood, r.residualImpact)}</Td>
                        <Td className={cn(!r.acceptedById && "text-warn")}>
                          {r.acceptedById ? personById(r.acceptedById).name : "Nobody"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Doc>
            )}

            {selected.has("findings") && (
              <Doc title="Findings and corrective actions" note={`${FINDINGS.length} findings`}>
                <ul className="space-y-2.5">
                  {FINDINGS.slice(0, 5).map((f) => (
                    <li key={f.id} className="space-y-0.5">
                      <p className="text-[0.8125rem] font-medium">{f.title}</p>
                      <p className="text-[0.75rem] text-muted-foreground">
                        {FINDING_SOURCE[f.source].label} · raised{" "}
                        {formatDate(f.raisedAt)} · {f.status.replace(/_/g, " ")}
                        {f.verifiedById &&
                          f.verifiedAt &&
                          ` · verified by ${personById(f.verifiedById).name} on ${formatDate(f.verifiedAt)}`}
                      </p>
                    </li>
                  ))}
                </ul>
                <Continues n={FINDINGS.length - 5} />
              </Doc>
            )}

            {selected.has("policies") && (
              <Doc title="Policy set" note="Approved versions in force" />
            )}
            {selected.has("coverage") && (
              <Doc title="Control coverage by system" note="Which controls reach which system" />
            )}

            <p className="px-8 text-[0.6875rem] leading-relaxed text-muted-foreground/60">
              Control references identify clauses of {summary.framework?.shortName}.
              Titles and descriptions in this pack are our own; the text of the
              standard is not reproduced.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Doc({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={PAPER}>
      <div className="mb-3 flex items-baseline gap-2 border-b border-border/60 pb-2">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="ml-auto text-[0.6875rem] text-muted-foreground/60">{note}</span>
      </div>
      {children ?? (
        <p className="text-[0.75rem] text-muted-foreground/60">
          Included in full in the generated document.
        </p>
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-border px-2 py-1.5 text-left font-mono text-[0.6rem] font-medium uppercase tracking-wider whitespace-nowrap text-muted-foreground">
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  wrap,
  className,
}: {
  children: React.ReactNode;
  mono?: boolean;
  wrap?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "border-b border-border/60 px-2 py-1.5 align-top",
        mono && "font-mono text-[0.6875rem] text-muted-foreground",
        wrap ? "leading-snug" : "whitespace-nowrap",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** The preview shows the first rows; the pack contains all of them. */
function Continues({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <p className="pt-2 text-[0.6875rem] text-muted-foreground/50">
      … and {n} more in the generated document.
    </p>
  );
}

function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "critical" | "warn";
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[0.6875rem] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-xl font-semibold leading-none tabular",
          tone === "critical" && value !== 0 && "text-critical",
          tone === "warn" && value !== 0 && "text-warn",
        )}
      >
        {value}
      </dd>
      {note && <p className="text-[0.6875rem] text-muted-foreground/60">{note}</p>}
    </div>
  );
}
