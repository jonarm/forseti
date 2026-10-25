"use client";

import { Download, FileText, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { APPLICABILITY as APPLICABILITY_LABEL, IMPLEMENTATION, formatDate, TODAY } from "@/lib/ams/labels";
import type { ControlApplicability } from "@/lib/ams/types";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * The Statement of Applicability as the document it becomes.
 *
 * A preview rather than a download, and shaped like the artefact an auditor is
 * handed: a header establishing scope and version, the counts they check first,
 * then every control with its answer and — the part that actually gets read —
 * the justification for each one that is not applicable.
 *
 * Two decisions worth keeping. The export shows **the current working state**,
 * including edits made in this session, because an SoA you cannot export until
 * you have saved is an SoA people keep in a spreadsheet instead. And exclusions
 * are ordered first: they are what gets sampled, so burying them at A.10 in
 * reference order would be arranging the document for our own convenience.
 */
export function SoaExportDialog({
  open,
  onOpenChange,
  rows,
  counts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ControlApplicability[];
  counts: { applicable: number; excluded: number; na: number; implemented: number };
}) {
  const { personById, framework } = useWorkspace();
  const [generating, setGenerating] = useState(false);

  const excluded = rows.filter((r) => r.applicability !== "yes");
  const applicable = rows.filter((r) => r.applicability === "yes");
  const missingJustification = excluded.filter(
    (r) => r.justification.trim().length < 20,
  ).length;

  function generate() {
    setGenerating(true);
    window.setTimeout(() => setGenerating(false), 800);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[min(64rem,calc(100vw-3rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="gap-1 border-b border-border p-4">
          <DialogTitle className="text-base">Export Statement of Applicability</DialogTitle>
          <DialogDescription className="text-xs">
            A preview of the document as it stands right now. Every change on
            the workbench is already saved, so this is what the register holds
            rather than what this session happens to remember.
          </DialogDescription>
        </DialogHeader>

        {missingJustification > 0 && (
          <p className="border-b border-border bg-warn/5 px-4 py-2.5 text-xs text-warn">
            {missingJustification} control{missingJustification === 1 ? " is" : "s are"} excluded
            or not applicable without a justification. An auditor samples these
            first, so the export flags them rather than quietly omitting the gap.
          </p>
        )}

        <div className="max-h-[62vh] overflow-y-auto bg-secondary/10 px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            <header className="space-y-1 border-b border-border pb-4">
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.11em] text-muted-foreground">
                Statement of Applicability
              </p>
              <h2 className="text-lg font-semibold tracking-tight">{framework?.name}</h2>
              <p className="text-sm text-muted-foreground">
                Meridian Analytics · prepared {formatDate(TODAY)} · owner{" "}
                {personById("p-anders").name}
              </p>
              <p className="max-w-2xl pt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
                Scope: every AI system used by the organisation, whether procured,
                integrated or built in house, as recorded in the AI inventory at
                the date of preparation.
              </p>
            </header>

            <section className="grid grid-cols-4 gap-3">
              <Tile label="Applicable" value={counts.applicable} />
              <Tile label="Not applicable" value={counts.na} />
              <Tile label="Excluded" value={counts.excluded} />
              <Tile label="Implemented" value={counts.implemented} tone="ok" />
            </section>

            <Section
              title={`Controls not applied (${excluded.length})`}
              note="Listed first because these are the positions that get challenged."
              rows={excluded}
            />

            <Section title={`Controls applied (${applicable.length})`} rows={applicable} />

            <p className="border-t border-border pt-4 text-[0.6875rem] leading-relaxed text-muted-foreground/60">
              Control references identify clauses of {framework?.shortName}. Titles
              and descriptions in this document are our own; the text of the
              standard is not reproduced.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Would generate a dated PDF and attach it to the evidence register.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button size="sm" onClick={generate} disabled={generating}>
              {generating ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              Generate PDF
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok";
}) {
  return (
    <div className="space-y-1 rounded-lg border border-border bg-background/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-semibold leading-none tabular", tone === "ok" && "text-ok")}>
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  note,
  rows,
}: {
  title: string;
  note?: string;
  rows: ControlApplicability[];
}) {
  const { controlById, policyById, personById } = useWorkspace();
  if (rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <FileText className="size-3.5 text-muted-foreground" aria-hidden />
          {title}
        </h3>
        {note && <p className="text-[0.75rem] text-muted-foreground">{note}</p>}
      </div>

      <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
        <thead>
          <tr>
            <th className="border-b border-border px-2 py-1.5 text-left font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
              Ref
            </th>
            <th className="border-b border-border px-2 py-1.5 text-left font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
              Control
            </th>
            <th className="border-b border-border px-2 py-1.5 text-left font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
              Applies
            </th>
            <th className="border-b border-border px-2 py-1.5 text-left font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
              Justification
            </th>
            <th className="border-b border-border px-2 py-1.5 text-left font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
              Status
            </th>
            <th className="border-b border-border px-2 py-1.5 text-left font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
              Owner
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const control = controlById(row.controlId);
            if (!control) return null;
            const policy = policyById(row.linkedPolicyId);
            return (
              <tr key={row.controlId} className="align-top">
                <td className="border-b border-border/60 px-2 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                  {control.officialRef}
                </td>
                <td className="border-b border-border/60 px-2 py-2">
                  {control.shortTitle}
                  {policy && (
                    <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">
                      {policy.title}
                    </span>
                  )}
                </td>
                <td className="border-b border-border/60 px-2 py-2 whitespace-nowrap">
                  {APPLICABILITY_LABEL[row.applicability].label}
                </td>
                <td className="border-b border-border/60 px-2 py-2 leading-snug">
                  {row.justification.trim() || (
                    <span className="text-warn">Not stated</span>
                  )}
                </td>
                <td className="border-b border-border/60 px-2 py-2 whitespace-nowrap text-muted-foreground">
                  {IMPLEMENTATION[row.implementationStatus].label}
                </td>
                <td className="border-b border-border/60 px-2 py-2 whitespace-nowrap text-muted-foreground">
                  {row.ownerId ? personById(row.ownerId).name : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
