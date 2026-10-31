import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ATTENTION_LIMIT,
  attentionSummary,
  evidencePosture,
  frameworkReadiness,
  policyPosture,
  readinessByNode,
  systemPosture,
} from "@/lib/ams/readiness";
import { ORIGIN, RISK_TIER, utcToday, formatDate } from "@/lib/ams/labels";
import { coverageTone, TONE_FILL, TONE_TEXT, TONE_TRACK, type Tone } from "@/lib/ams/tone";
import { amsPage } from "@/lib/ams-page";
import { EmptyState } from "../_ams/empty-state";
import { StatusBadge } from "../_ams/status-badge";

/**
 * The readiness dashboard, and the landing screen.
 *
 * Every figure is derived in `readiness.ts` from the same records the other
 * screens render. Nothing is stored, so a document expiring moves the headline
 * without anyone editing a number.
 *
 * The layout follows one decision: **the headline is the strict number.** A
 * control counts as ready only when it is applicable, implemented *and* carries
 * evidence that is verified and current. That produces a lower figure than the
 * one most tools report, and the two bars beneath it show why — the gap between
 * "implemented" and "ready" is the distance between what the organisation
 * believes about itself and what it could hand an auditor on the day. A
 * dashboard reporting the flattering number is worse than no dashboard, because
 * it gets trusted.
 *
 * The attention list is deliberately short. Forty items surface nothing: the
 * reader scans two and closes the tab.
 */
export const dynamic = "force-dynamic";

export default async function ReadinessDashboard() {
  const { ws } = await amsPage();

  /* An organisation with no standard in scope has no readiness to report, and
   * a dashboard of zeroes reads as a broken page rather than an empty one. */
  if (!ws.framework) return <NothingInScope />;

  const SOA = `/frameworks/${ws.framework.id}`;
  const readiness = frameworkReadiness(ws);
  const nodes = readinessByNode(ws);
  const policies = policyPosture(ws);
  const evidence = evidencePosture(ws);
  const systems = systemPosture(ws);
  const attention = attentionSummary(ws);

  const tone = coverageTone(readiness.ready.percent);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <header className="space-y-1">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.11em] text-muted-foreground">
          Readiness · {formatDate(utcToday())}
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{ws.framework.shortName}</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Derived from the inventory, the Statement of Applicability and the
          evidence register. Nothing here is stored, so a document expiring moves
          the number without anyone editing it.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="space-y-4 rounded-lg border border-border bg-secondary/20 p-5">
          <div className="space-y-1">
            <p className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/60">
              Ready
            </p>
            <div className="flex items-baseline gap-2">
              <span className={cn("text-4xl font-semibold leading-none", TONE_TEXT[tone])}>
                {readiness.ready.percent}%
              </span>
              <span className="text-sm text-muted-foreground">
                {readiness.ready.done} of {readiness.ready.total}
              </span>
            </div>
          </div>

          <Meter percent={readiness.ready.percent} tone={tone} />

          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            Applicable, implemented, and carrying evidence that is verified and
            current — all three, because an auditor does not care which status
            you selected.
          </p>

          <dl className="space-y-2.5 border-t border-border/60 pt-3">
            <SubMeter label="Marked implemented" share={readiness.implemented} />
            <SubMeter
              label="Evidenced"
              share={readiness.evidenced}
              href={`${SOA}?lens=no-evidence`}
            />
          </dl>

          {readiness.provenGap > 0 && (
            <p className="rounded-md border border-warn/25 bg-warn/5 px-2.5 py-2 text-[0.8125rem] leading-relaxed text-muted-foreground">
              <Link
                href={`${SOA}?lens=unproven`}
                className="text-warn underline underline-offset-4 hover:text-foreground"
              >
                {readiness.provenGap} controls
              </Link>{" "}
              are marked implemented but could not be proven today. That gap is
              the distance between what we believe and what we could hand over.
            </p>
          )}

          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground/60">
            <Link
              href={`${SOA}?lens=excluded`}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {readiness.excluded} of {readiness.scoped} controls
            </Link>{" "}
            are excluded or not applicable, each with a justification in the
            Statement of Applicability.
          </p>
        </div>

        <div className="space-y-4">
          <Breakdown
            soa={SOA}
            title="Management clauses"
            nodes={nodes.filter((n) => n.node.kind === "management_clause")}
          />
          <Breakdown
            soa={SOA}
            title="Annex A"
            nodes={nodes.filter((n) => n.node.kind === "annex_a")}
          />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Panel
          title="Policies"
          href="/frameworks/iso-42001"
          headline={`${policies.done} of ${policies.total} approved`}
          percent={policies.percent}
        >
          <Line
            label="Applicable controls citing no policy"
            value={policies.controlsWithoutPolicy}
            tone="warn"
            href={`${SOA}?lens=no-policy`}
          />
          <Line label="Approved but overdue for review" value={policies.dueForReview} tone="warn" />
          {policies.unapproved.map((policy) => (
            <p key={policy.id} className="text-[0.75rem] leading-snug text-muted-foreground/70">
              {policy.title} — {policy.status === "draft" ? "still a draft" : "in review"}
            </p>
          ))}
        </Panel>

        <Panel
          title="Evidence"
          href="/evidence"
          headline={`${evidence.done} of ${evidence.total} usable`}
          percent={evidence.percent}
        >
          <Line
            label="Expired"
            value={evidence.expired.length}
            tone="critical"
            href="/evidence?lens=expired"
          />
          <Line
            label="Expiring within 60 days"
            value={evidence.expiringSoon.length}
            tone="warn"
            href="/evidence?lens=expiring"
          />
          <Line
            label="Collected but never verified"
            value={evidence.unverified.length}
            tone="warn"
            href="/evidence?lens=unverified"
          />
          <Line
            label="Applicable controls with nothing usable"
            value={evidence.controlsWithoutEvidence.length}
            tone="warn"
            href={`${SOA}?lens=no-evidence`}
          />
        </Panel>

        <Panel
          title="AI systems"
          href="/inventory"
          headline={`${systems.done} of ${systems.total} with an approved assessment`}
          percent={systems.percent}
        >
          <Line
            label="Generative"
            value={systems.genAi}
            href="/inventory?genai=yes"
          />
          <Line
            label="Found rather than declared"
            value={systems.discovered.length}
            tone="warn"
            href="/inventory?discovered=1"
          />
          <div className="space-y-1.5 border-t border-border/60 pt-2">
            <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
              By origin
            </p>
            {systems.byOrigin.map(({ origin, count }) => (
              <Bar
                key={origin}
                label={ORIGIN[origin].label}
                count={count}
                total={systems.total}
                tone="neutral"
                href={count > 0 ? `/inventory?origin=${origin}` : undefined}
              />
            ))}
          </div>
          <div className="space-y-1.5 border-t border-border/60 pt-2">
            <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
              By risk tier
            </p>
            {systems.byRisk.map(({ tier, count }) => (
              <Bar
                key={tier}
                label={RISK_TIER[tier].label}
                count={count}
                total={systems.total}
                tone={RISK_TIER[tier].tone}
                href={count > 0 ? `/inventory?risk=${tier}` : undefined}
              />
            ))}
          </div>
        </Panel>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-medium">Attention required</h2>
          <span className="text-sm text-muted-foreground">
            {attention.total} items, {attention.critical} of them critical
          </span>
        </div>

        <ul className="divide-y divide-border/60 border-y border-border">
          {attention.shown.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="group flex items-start gap-3 py-2.5 transition-colors hover:bg-secondary/30"
              >
                <AlertTriangle
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    item.severity === "critical" ? "text-critical" : "text-warn",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium group-hover:underline">
                      {item.title}
                    </span>
                    <StatusBadge
                      label={item.kind}
                      tone={item.severity === "critical" ? "critical" : "warn"}
                    />
                  </div>
                  <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
                <ArrowRight
                  className="mt-1 size-3.5 shrink-0 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>

        {attention.remainder.length > 0 && (
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            Showing the {ATTENTION_LIMIT} most serious. Also outstanding:{" "}
            {attention.remainder
              .map(({ kind, count }) => `${count} ${plural(kind, count)}`)
              .join(", ")}
            . A dashboard listing all {attention.total} would be a backlog, and a
            backlog gets scrolled past.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Pluralise a kind for the tail line.
 *
 * "5 open finding" is the kind of small wrongness that makes a reader trust the
 * numbers less, and the kinds are short enough that a naive rule covers them.
 */
function plural(kind: string, count: number): string {
  const lower = kind.toLowerCase();
  if (count === 1) return lower;
  if (lower.endsWith("s")) return lower;
  return `${lower}s`;
}

/* ------------------------------------------------------------------ parts */

function Meter({ percent, tone }: { percent: number; tone: Tone }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full", TONE_TRACK[tone])}>
      <div
        className={cn("h-full rounded-full", TONE_FILL[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function SubMeter({
  label,
  share,
  href,
}: {
  label: string;
  share: { done: number; total: number; percent: number };
  href?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="tabular text-muted-foreground">
          {href ? (
            <Link
              href={href}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {share.done}/{share.total} · {share.percent}%
            </Link>
          ) : (
            <>
              {share.done}/{share.total} · {share.percent}%
            </>
          )}
        </dd>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-muted-foreground/50"
          style={{ width: `${share.percent}%` }}
        />
      </div>
    </div>
  );
}

function Breakdown({
  title,
  nodes,
  soa,
}: {
  title: string;
  nodes: ReturnType<typeof readinessByNode>;
  /** The Statement of Applicability this breakdown links into. */
  soa: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
        {title}
      </p>
      <ul className="divide-y divide-border/60 border-y border-border">
        {nodes.map(({ node, percent, done, applicable }) => {
          const tone = applicable === 0 ? "neutral" : coverageTone(percent);
          return (
            <li key={node.id}>
              <Link
                href={`${soa}?node=${node.id}`}
                className="group flex items-center gap-3 py-1.5 transition-colors hover:bg-secondary/30"
              >
              <span className="w-9 shrink-0 font-mono text-[0.6875rem] text-muted-foreground/70">
                {node.officialRef}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] group-hover:underline">
                {node.shortTitle}
              </span>
              {applicable === 0 ? (
                <span className="shrink-0 text-xs text-muted-foreground/40">
                  none applicable
                </span>
              ) : (
                <>
                  <span
                    className={cn("w-14 shrink-0 text-right text-xs tabular", TONE_TEXT[tone])}
                  >
                    {done}/{applicable}
                  </span>
                  <div
                    className={cn(
                      "h-1 w-20 shrink-0 overflow-hidden rounded-full",
                      TONE_TRACK[tone],
                    )}
                  >
                    <div
                      className={cn("h-full rounded-full", TONE_FILL[tone])}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </>
              )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Panel({
  title,
  href,
  headline,
  percent,
  children,
}: {
  title: string;
  href: string;
  headline: string;
  percent: number;
  children: React.ReactNode;
}) {
  const tone = coverageTone(percent);
  return (
    <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <Link
          href={href}
          className="ml-auto text-[0.6875rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Open
        </Link>
      </div>
      <div className="space-y-1.5">
        <p className={cn("text-sm", TONE_TEXT[tone])}>{headline}</p>
        <Meter percent={percent} tone={tone} />
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/**
 * A figure with somewhere to go.
 *
 * A zero is never a link. There is nothing behind it to drill into, and a
 * clickable zero that lands on an empty table is a small betrayal every time.
 */
function Line({
  label,
  value,
  tone = "neutral",
  href,
}: {
  label: string;
  value: number;
  tone?: Tone;
  href?: string;
}) {
  const figure = (
    <span
      className={cn(
        "shrink-0 tabular",
        value === 0 ? "text-muted-foreground/50" : TONE_TEXT[tone],
      )}
    >
      {value}
    </span>
  );

  if (!href || value === 0) {
    return (
      <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
        <span className="text-muted-foreground">{label}</span>
        {figure}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="group flex items-baseline justify-between gap-3 text-[0.8125rem]"
    >
      <span className="text-muted-foreground group-hover:text-foreground group-hover:underline">
        {label}
      </span>
      {figure}
    </Link>
  );
}

function Bar({
  label,
  count,
  total,
  tone,
  href,
}: {
  label: string;
  count: number;
  total: number;
  tone: Tone;
  href?: string;
}) {
  if (!href) {
    return (
      <div className="flex items-center gap-2 text-[0.8125rem]">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
        <BarFigure count={count} total={total} tone={tone} />
      </div>
    );
  }

  return (
    <Link href={href} className="group flex items-center gap-2 text-[0.8125rem]">
      <span className="min-w-0 flex-1 truncate text-muted-foreground group-hover:text-foreground group-hover:underline">
        {label}
      </span>
      <BarFigure count={count} total={total} tone={tone} />
    </Link>
  );
}

function BarFigure({ count, total, tone }: { count: number; total: number; tone: Tone }) {
  return (
    <>
      <span className="w-6 shrink-0 text-right tabular text-muted-foreground">{count}</span>
      <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", TONE_FILL[tone])}
          style={{ width: `${total === 0 ? 0 : (count / total) * 100}%` }}
        />
      </div>
    </>
  );
}

/** Before a standard is in scope there is no number to report, only a next step. */
function NothingInScope() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <header className="space-y-1">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.11em] text-muted-foreground">
          Readiness · {formatDate(utcToday())}
        </p>
        <h1 className="text-xl font-semibold tracking-tight">No standard in scope</h1>
      </header>
      <EmptyState
        title="Readiness is measured against a standard, and there is not one yet"
        body="Once a framework is in scope, every figure on this page derives from your Statement of Applicability, your inventory and your evidence register. Until then there is nothing to compute, and a page of zeroes would only look broken."
        action={
          <Link href="/inventory" className="text-sm text-primary hover:underline">
            Start with the AI inventory
          </Link>
        }
      />
    </div>
  );
}
