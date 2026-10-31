"use client";

import { PreviewNotice } from "@/components/preview-notice";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, Lock, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  FINDING_RISK_KIND,
  FINDING_SEVERITY,
  FINDING_SOURCE,
  FINDING_STATUS,
  canClose,
  findingAge,
} from "@/lib/ams/fixtures/registers";
import { formatDate, isOverdue, utcToday } from "@/lib/ams/labels";
import type { Finding } from "@/lib/ams/types";
import { ActivityPanel } from "./activity-panel";
import { Ref, StatusBadge } from "./status-badge";
import { TrackedTextarea, clip, useActivityLog } from "./use-activity-log";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * A finding, from raised to closed.
 *
 * The record is the lifecycle, in order: what was found, why it happened, what
 * we did, who checked, and only then a closure date. Each stage is a field
 * rather than a status somebody sets, because the status is the *consequence*
 * of the fields being filled in — a register where "closed" is a dropdown value
 * is a register where closed means somebody stopped looking.
 *
 * The gate is `canClose()`. Root cause, corrective action, and a dated
 * verification **by somebody other than the owner**, or the button stays down
 * and says which of the four is missing. A fix checked by the person who made it
 * is a self-assessment, and closed findings are the first thing an external
 * auditor samples.
 */
export function FindingRecord({ finding: initial }: { finding: Finding }) {
  const {
    people: PEOPLE,
    personById,
    systemById,
    controlById,
    linksForFinding,
    risks: RISKS,
  } = useWorkspace();
  const [finding, setFinding] = useState<Finding>(initial);
  const log = useActivityLog(initial.id, "finding");
  const [busy, setBusy] = useState<"verify" | "close" | null>(null);

  const gate = canClose(finding);
  const system = finding.systemId ? systemById(finding.systemId) : undefined;
  const control = finding.controlId ? controlById(finding.controlId) : undefined;
  const source = FINDING_SOURCE[finding.source];

  const links = linksForFinding(finding.id).map((link) => ({
    link,
    risk: RISKS.find((r) => r.id === link.riskId),
  }));
  const late = finding.status !== "closed" && isOverdue(finding.dueAt);

  function set<K extends keyof Finding>(key: K, value: Finding[K]) {
    setFinding((f) => ({ ...f, [key]: value }));
  }

  function verify() {
    setBusy("verify");
    window.setTimeout(() => {
      setFinding((f) => ({
        ...f,
        verifiedAt: utcToday(),
        status: f.status === "closed" ? f.status : "verification",
      }));
      log.record(
        "recorded verification",
        "Verified by",
        "Nobody",
        `${personById(finding.verifiedById ?? "").name} · ${formatDate(utcToday())}`,
      );
      setBusy(null);
    }, 800);
  }

  function close() {
    setBusy("close");
    window.setTimeout(() => {
      setFinding((f) => ({ ...f, status: "closed", closedAt: utcToday() }));
      log.record(
        "closed the finding",
        "Status",
        FINDING_STATUS[finding.status].label,
        "Closed",
      );
      setBusy(null);
    }, 800);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <header className="space-y-2">
        <Link
          href="/findings"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Findings
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">{finding.title}</h1>
          <StatusBadge
            label={FINDING_SEVERITY[finding.severity].label}
            tone={FINDING_SEVERITY[finding.severity].tone}
          />
          <StatusBadge
            label={FINDING_STATUS[finding.status].label}
            tone={FINDING_STATUS[finding.status].tone}
          />
        </div>

        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {finding.summary}
        </p>

        <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-1">
          <Fact label="Source" value={source.label} />
          <Fact label="Raised by" value={finding.raisedBy} />
          <Fact label="Raised" value={`${formatDate(finding.raisedAt)} · ${findingAge(finding)} days`} />
          <Fact
            label={finding.status === "closed" ? "Closed" : "Due"}
            value={
              finding.status === "closed" && finding.closedAt
                ? formatDate(finding.closedAt)
                : formatDate(finding.dueAt)
            }
            className={cn(late && "text-critical")}
          />
          <Fact
            label="Against"
            value={system?.name ?? "Organisation-wide"}
            href={system ? `/inventory/${system.id}` : undefined}
          />
        </dl>

        {control && (
          <p className="text-[0.8125rem] text-muted-foreground">
            Control <Ref>{control.officialRef}</Ref>{" "}
            <Link
              href={`/frameworks/iso-42001?node=${control.nodeId}`}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {control.shortTitle}
            </Link>
          </p>
        )}
      </header>

      {/* --------------------------------------------------------- the lifecycle */}
      <section className="space-y-4 rounded-lg border border-border bg-secondary/20 p-4">
        <PreviewNotice>
          Root cause, corrective action, verification and closure edits are not saved.
          Reloading restores the stored finding. Record creation and filing are separate saved actions.
        </PreviewNotice>
        <Stage
          n={1}
          title="Root cause"
          done={Boolean(finding.rootCause)}
          hint="Why it happened, not what happened. A corrective action written against a symptom fixes the symptom."
        >
          <TrackedTextarea
            rows={3}
            value={finding.rootCause ?? ""}
            ariaLabel="Root cause"
            placeholder="Software under the departmental card threshold never reaches procurement, so nothing triggers intake."
            onChange={(v) => set("rootCause", v || null)}
            onCommit={(before, after) =>
              log.record("recorded the root cause", "Root cause", clip(before), clip(after))
            }
            className="text-sm leading-relaxed"
          />
        </Stage>

        <Stage
          n={2}
          title="Corrective action"
          done={Boolean(finding.correctiveAction)}
          hint="What changes so this does not recur — not what was done to tidy up this instance."
        >
          <TrackedTextarea
            rows={3}
            value={finding.correctiveAction ?? ""}
            ariaLabel="Corrective action"
            placeholder="AI supplier assessment made mandatory at purchase-order stage regardless of value."
            onChange={(v) => set("correctiveAction", v || null)}
            onCommit={(before, after) =>
              log.record(
                "recorded the corrective action",
                "Corrective action",
                clip(before),
                clip(after),
              )
            }
            className="text-sm leading-relaxed"
          />
        </Stage>

        <Stage
          n={3}
          title="Verification"
          done={Boolean(finding.verifiedById && finding.verifiedAt)}
          hint="Checked by somebody other than the owner, on a date. This is the stage that makes closure mean anything."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Verified by</Label>
              <Select
                value={finding.verifiedById ?? ""}
                onValueChange={(v) => {
                  log.record(
                    "changed the verifier",
                    "Verified by",
                    finding.verifiedById ? personById(finding.verifiedById).name : "Nobody",
                    v ? personById(v).name : "Nobody",
                  );
                  set("verifiedById", v || null);
                }}
              >
                <SelectTrigger size="sm" className="w-full font-normal">
                  <SelectValue>
                    {finding.verifiedById ? (
                      personById(finding.verifiedById).name
                    ) : (
                      <span className="text-muted-foreground/60">Nobody yet</span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PEOPLE.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name} — {person.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {finding.verifiedById === finding.ownerId && (
                <p className="text-[0.6875rem] text-warn">
                  That is the owner. Verification has to be somebody else.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <div className="flex h-8 items-center gap-2">
                {finding.verifiedAt ? (
                  <span className="text-sm tabular">{formatDate(finding.verifiedAt)}</span>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={
                      busy !== null ||
                      !finding.verifiedById ||
                      finding.verifiedById === finding.ownerId
                    }
                    onClick={verify}
                  >
                    {busy === "verify" ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Check aria-hidden />
                    )}
                    Record verification
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-2">
            <TrackedTextarea
              rows={2}
              value={finding.verificationNote ?? ""}
              ariaLabel="Verification note"
              placeholder="Sampled ten of the thirty-four previously flagged sites; all now restricted."
              onChange={(v) => set("verificationNote", v || null)}
              onCommit={(before, after) =>
                log.record(
                  "recorded a verification note",
                  "Verification note",
                  clip(before),
                  clip(after),
                )
              }
              className="text-sm leading-relaxed"
            />
          </div>
        </Stage>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Activity</h2>
        <ActivityPanel events={log.events} />
      </section>

      {/* --------------------------------------------------------- linked risks */}
      {links.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-medium">Risks this connects to</h2>
            <span className="text-sm text-muted-foreground">{links.length}</span>
          </div>

          <ul className="divide-y divide-border/60 border-y border-border">
            {links.map(({ link, risk }) =>
              risk ? (
                <li key={`${link.findingId}-${link.riskId}`} className="space-y-1 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link
                      href={`/risks/${risk.id}`}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {risk.title}
                    </Link>
                    <StatusBadge
                      label={FINDING_RISK_KIND[link.kind].label}
                      tone={FINDING_RISK_KIND[link.kind].tone}
                      title={FINDING_RISK_KIND[link.kind].blurb}
                    />
                    <span className="ml-auto text-[0.75rem] tabular text-muted-foreground/60">
                      residual {risk.residualLikelihood * risk.residualImpact}
                    </span>
                  </div>
                  <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                    {link.note}
                  </p>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------- closure */}
      <section className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">Closure</h2>
          <StatusBadge
            className="ml-auto"
            label={finding.status === "closed" ? "Closed" : "Not closed"}
            tone={finding.status === "closed" ? "ok" : "neutral"}
          />
        </div>

        {finding.status === "closed" ? (
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            Closed {finding.closedAt && formatDate(finding.closedAt)} after
            verification by{" "}
            <span className="text-foreground">
              {finding.verifiedById ? personById(finding.verifiedById).name : "—"}
            </span>
            . Took {findingAge(finding)} days from raised to closed.
          </p>
        ) : (
          <>
            <p
              className={cn(
                "flex items-start gap-2 text-[0.8125rem] leading-relaxed",
                gate.ok ? "text-muted-foreground" : "text-warn",
              )}
            >
              {!gate.ok && <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
              {gate.reason}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!gate.ok || busy !== null} onClick={close}>
                {busy === "close" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Check aria-hidden />
                )}
                Close finding
              </Button>
              <div className="ml-auto">
                <Label className="sr-only">Owner</Label>
                <Select
                  value={finding.ownerId}
                  onValueChange={(v) => {
                    const next = v ?? finding.ownerId;
                    log.record(
                      "reassigned the owner",
                      "Owner",
                      personById(finding.ownerId).name,
                      personById(next).name,
                    );
                    set("ownerId", next);
                  }}
                >
                  <SelectTrigger size="sm" className="font-normal">
                    <SelectValue>Owner: {personById(finding.ownerId).name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PEOPLE.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name} — {person.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** One stage of the lifecycle, numbered so the order reads as an order. */
function Stage({
  n,
  title,
  hint,
  done,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 border-t border-border/60 pt-3 first:border-0 first:pt-0">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full text-[0.6rem] tabular",
            done ? "bg-ok/15 text-ok" : "bg-secondary text-muted-foreground",
          )}
        >
          {done ? "✓" : n}
        </span>
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="text-[0.75rem] leading-snug text-muted-foreground">{hint}</p>
      {children}
    </div>
  );
}

function Fact({
  label,
  value,
  href,
  className,
}: {
  label: string;
  value: string;
  href?: string;
  className?: string;
}) {
  return (
    <div className="max-w-xs space-y-0.5">
      <dt className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
        {label}
      </dt>
      <dd className={cn("text-sm", className)}>
        {href ? (
          <Link href={href} className="underline-offset-4 hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
