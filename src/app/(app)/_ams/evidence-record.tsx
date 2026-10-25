"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Download, FileText, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { evidenceDependants } from "@/lib/ams/readiness";
import { EVIDENCE_TYPE, VERIFICATION, formatDate, isOverdue, TODAY } from "@/lib/ams/labels";
import type { Evidence } from "@/lib/ams/types";
import { EmptyState } from "./empty-state";
import { ActivityPanel } from "./activity-panel";
import { Ref, StatusBadge } from "./status-badge";
import { useActivityLog } from "./use-activity-log";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * One document, and everything resting on it.
 *
 * The record exists for the reverse view. A link straight to a PDF would answer
 * "what is this file"; the question a governance lead actually has is "what
 * happens if this lapses", and only the register can answer it. So the largest
 * block on the page is the list of controls that cite this document, split by
 * whether they have anything else — because a control that would keep other
 * usable evidence is a renewal you can schedule, and one resting on this alone
 * is a hole opening on a known date.
 *
 * Verification is a human act with a name against it, for the same reason
 * approving an assessment is. A document that verifies itself is just a file.
 */
export function EvidenceRecord({ evidence }: { evidence: Evidence }) {
  const ws = useWorkspace();
  const { personById, controlById, systemById } = ws;
  const [state, setState] = useState(evidence.verificationState);
  const [decidedAt, setDecidedAt] = useState<string | null>(
    evidence.verificationState === "verified" ? evidence.collectedAt : null,
  );
  const [busy, setBusy] = useState<"verify" | "reject" | null>(null);
  const log = useActivityLog(evidence.id, "evidence");

  const deps = evidenceDependants(ws, evidence.id);
  const lapsed = Boolean(evidence.expiresAt && isOverdue(evidence.expiresAt));
  const daysLeft = evidence.expiresAt
    ? Math.round(
        (new Date(evidence.expiresAt).getTime() - new Date(TODAY).getTime()) / 86_400_000,
      )
    : null;

  function decide(next: "verified" | "rejected", kind: "verify" | "reject") {
    setBusy(kind);
    window.setTimeout(() => {
      setState(next);
      setDecidedAt(TODAY);
      setBusy(null);
      log.record(
        next === "verified" ? "verified the document" : "rejected the document",
        "Verification",
        VERIFICATION[state].label,
        VERIFICATION[next].label,
      );
    }, 800);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <header className="space-y-2">
        <Link
          href="/evidence"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Evidence register
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h1 className="text-xl font-semibold tracking-tight">{evidence.title}</h1>
          <StatusBadge
            label={VERIFICATION[state].label}
            tone={VERIFICATION[state].tone}
          />
          {lapsed && <StatusBadge label="Lapsed" tone="critical" />}
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-1">
          <Fact label="Type" value={EVIDENCE_TYPE[evidence.type]} />
          <Fact label="Source" value={evidence.source} />
          <Fact label="Owner" value={personById(evidence.ownerId).name} />
          <Fact label="Collected" value={formatDate(evidence.collectedAt)} />
          <Fact
            label="Expires"
            value={evidence.expiresAt ? formatDate(evidence.expiresAt) : "No expiry"}
            className={cn(lapsed && "text-critical")}
          />
        </dl>
      </header>

      {/* The sentence the register exists to be able to write. */}
      {evidence.expiresAt && deps.soleSupport.length > 0 && (
        <div
          className={cn(
            "flex items-start gap-2.5 rounded-lg border px-3.5 py-3",
            lapsed ? "border-critical/30 bg-critical/5" : "border-warn/30 bg-warn/5",
          )}
        >
          <AlertTriangle
            className={cn("mt-0.5 size-4 shrink-0", lapsed ? "text-critical" : "text-warn")}
            aria-hidden
          />
          <p className="text-[0.8125rem] leading-relaxed">
            {lapsed ? (
              <>
                This document lapsed on {formatDate(evidence.expiresAt)}.{" "}
                <span className="text-critical">
                  {deps.soleSupport.length} control
                  {deps.soleSupport.length === 1 ? " has" : "s have"} nothing else
                </span>{" "}
                and stopped being evidenced that day.
              </>
            ) : (
              <>
                Expires in {daysLeft} days.{" "}
                <span className="text-warn">
                  {deps.soleSupport.length} control
                  {deps.soleSupport.length === 1 ? "" : "s"} rest
                  {deps.soleSupport.length === 1 ? "s" : ""} on this alone
                </span>{" "}
                and will stop being evidenced on that date unless it is renewed.
              </>
            )}
          </p>
        </div>
      )}

      {/* ---------------------------------------------------- the artefact */}
      <DocumentPanel evidence={evidence} />

      {/* ------------------------------------------------------ verification */}
      <section className="space-y-2 rounded-lg border border-border bg-secondary/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">Verification</h2>
          <StatusBadge
            className="ml-auto"
            label={VERIFICATION[state].label}
            tone={VERIFICATION[state].tone}
          />
        </div>

        {state === "unverified" ? (
          <>
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              Collected but nobody has checked it. Until someone does, the
              controls below are relying on a document that has not been read —
              which is why an unverified document does not count toward
              readiness.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" disabled={busy !== null} onClick={() => decide("verified", "verify")}>
                {busy === "verify" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Check aria-hidden />
                )}
                Verify
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => decide("rejected", "reject")}
              >
                {busy === "reject" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <X aria-hidden />
                )}
                Reject
              </Button>
              <p className="text-xs text-muted-foreground">
                Recorded against {personById("p-anders").name}, with a timestamp.
              </p>
            </div>
          </>
        ) : (
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            {state === "verified" && (
              <>
                Checked by {personById(evidence.ownerId).name}
                {decidedAt && <> on {formatDate(decidedAt)}</>}.
                {lapsed && " It has since expired, which verification does not undo."}
              </>
            )}
            {state === "expired" &&
              "Lapsed. A document that has expired cannot be re-verified — it has to be replaced."}
            {state === "rejected" &&
              "Rejected on review. It stays in the register so the decision is on record rather than the document simply vanishing."}
          </p>
        )}
      </section>

      {/* --------------------------------------------------- what rests on it */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-medium">What rests on this document</h2>
          <span className="text-sm text-muted-foreground">
            {deps.controls.length} control{deps.controls.length === 1 ? "" : "s"}
            {deps.soleSupport.length > 0 && (
              <>
                , <span className="text-warn">{deps.soleSupport.length} with nothing else</span>
              </>
            )}
          </span>
        </div>

        {deps.controls.length === 0 ? (
          <EmptyState
            title="Attached to nothing"
            body="This document is in the register but no control cites it, so it proves nothing. Either link it to the control it supports, or accept that collecting it was wasted effort."
          />
        ) : (
          <ul className="divide-y divide-border/60 border-y border-border">
            {deps.controls.map((row) => {
              const control = controlById(row.controlId);
              if (!control) return null;
              const alone = deps.soleSupport.includes(row);
              return (
                <li key={row.controlId} className="flex items-start gap-3 py-2.5">
                  <Ref className="w-14 shrink-0 pt-0.5">{control.officialRef}</Ref>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Link
                        href={`/frameworks/iso-42001?node=${control.nodeId}`}
                        className="text-sm font-medium underline-offset-4 hover:underline"
                      >
                        {control.shortTitle}
                      </Link>
                      {alone ? (
                        <StatusBadge label="Nothing else supports it" tone="warn" />
                      ) : (
                        <StatusBadge label="Has other evidence" tone="neutral" />
                      )}
                    </div>
                    <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                      {control.requirementSummary}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Activity</h2>
        <ActivityPanel events={log.events} />
      </section>

      {/* ------------------------------------------------------ linked systems */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Systems reached through those controls ({deps.systems.length})
        </h2>
        {deps.systems.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-foreground">
            None. The controls citing this document are organisation-level rather
            than claimed against any particular system, which is legitimate for a
            policy and suspicious for a configuration export.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {deps.systems.map((id) => {
              const system = systemById(id);
              return system ? (
                <Link
                  key={id}
                  href={`/inventory/${id}`}
                  className="rounded border border-border px-2 py-1 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {system.name}
                </Link>
              ) : null;
            })}
          </div>
        )}
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground/60">
          Attached directly to {evidence.linkedSystemIds.length} system
          {evidence.linkedSystemIds.length === 1 ? "" : "s"}. A document only
          evidences a system it is attached to — which is why coverage varies
          across the inventory instead of every row reading the same.
        </p>
      </section>
    </div>
  );
}

/**
 * The artefact itself, or the absence of one.
 *
 * Both cases matter. A record with a file gets an inline viewer, because the
 * point of opening an evidence record during an audit is to read the thing —
 * making somebody download it first is a step that gets skipped, and a step
 * that gets skipped is a document nobody checked.
 *
 * A record with no file is the more interesting state, and it is stated rather
 * than left blank. Somebody wrote down that proof exists and never attached it;
 * the register looks complete and the audit finds nothing. The panel says so
 * plainly instead of rendering an empty box.
 */
function DocumentPanel({ evidence }: { evidence: Evidence }) {
  const file = evidence.file;

  if (!file) {
    return (
      <section className="space-y-2 rounded-lg border border-dashed border-warn/40 bg-warn/5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="size-4 shrink-0 text-warn" aria-hidden />
          <h2 className="text-sm font-medium">No document attached</h2>
        </div>
        <p className="max-w-2xl text-[0.8125rem] leading-relaxed text-muted-foreground">
          The record says this evidence exists; nothing is attached to it. The
          register looks complete and an auditor asking to see it finds nothing —
          which is the most common way an evidence register rots, and the reason
          this state gets its own colour rather than an empty panel.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium">{file.name}</h2>
        <span className="text-xs text-muted-foreground">
          {file.sizeKb} KB
          {file.pages ? ` · ${file.pages} pages` : ""}
        </span>
        <a
          href={file.href}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 text-[0.75rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <Download className="size-3" aria-hidden />
          Open original
        </a>
      </div>

      {file.kind === "pdf" ? (
        <iframe
          src={`${file.href}#view=FitH`}
          title={file.name}
          className="h-[32rem] w-full rounded-md border border-border bg-white"
        />
      ) : (
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background/60 p-3 font-mono text-[0.75rem] leading-relaxed text-muted-foreground">
          {file.preview ?? "No preview available."}
        </pre>
      )}

      {file.kind !== "pdf" && (
        <p className="text-[0.6875rem] text-muted-foreground/60">
          First lines only. Open the original for the full extract.
        </p>
      )}
    </section>
  );
}

function Fact({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
        {label}
      </dt>
      <dd className={cn("text-sm", className)}>{value}</dd>
    </div>
  );
}
