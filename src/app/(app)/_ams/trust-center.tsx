"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, Copy, Eye, EyeOff, Link2, Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { commitments, houseRules, toolEntries, type Audience } from "@/lib/ams/trust-center";
import { formatDate, RISK_TIER, TODAY } from "@/lib/ams/labels";
import { TONE_TEXT } from "@/lib/ams/tone";
import { StatusBadge } from "./status-badge";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * One page, two audiences, and a visible line between them.
 *
 * The dangerous version of a trust centre is one that silently shows less when
 * shared: somebody eventually publishes the wrong thing and nothing on screen
 * ever said what the boundary was. So the boundary is stated in both
 * directions. Internally, everything a customer would *not* see is marked with
 * a struck-through eye and the reason; externally, a banner says how many items
 * are hidden and why the page is shorter than it looks.
 *
 * The audience switcher is not a preview toggle tucked in a corner. It is the
 * loudest control on the page, because the single most useful thing this screen
 * can do is stop somebody sending a link without knowing what is on the other
 * end of it.
 */
const STATUS: Record<
  string,
  { label: string; tone: "ok" | "warn" | "critical" | "info" | "neutral"; blurb: string }
> = {
  approved: {
    label: "Approved",
    tone: "ok",
    blurb: "Assessed and signed off. Use it within the limits below.",
  },
  conditional: {
    label: "Conditional",
    tone: "warn",
    blurb: "In use while its assessment completes. Keep it to the listed purposes.",
  },
  not_approved: {
    label: "Not approved",
    tone: "critical",
    blurb: "Do not use it for work until it has been through intake.",
  },
  withdrawing: {
    label: "Being withdrawn",
    tone: "critical",
    blurb: "Stop using it. Replacement is being arranged.",
  },
};

export function TrustCenter() {
  const ws = useWorkspace();
  const [audience, setAudience] = useState<Audience>("internal");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const tools = useMemo(() => toolEntries(ws), [ws]);
  const claims = useMemo(() => commitments(ws), [ws]);
  const rules = useMemo(() => houseRules(ws), [ws]);

  const external = audience === "external";
  const visibleTools = tools.filter((t) => (external ? t.audience === "both" : true));
  const visibleClaims = claims.filter((c) => (external ? c.audience === "both" : true));
  const hidden =
    tools.length - tools.filter((t) => t.audience === "both").length +
    (claims.length - claims.filter((c) => c.audience === "both").length);

  const filtered = visibleTools.filter((t) =>
    query.trim()
      ? `${t.name} ${t.vendor} ${t.useFor.join(" ")}`.toLowerCase().includes(query.toLowerCase())
      : true,
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="space-y-4 border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Trust centre</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {external
                ? "What a customer sees when you send them the link. Same records, fewer of them."
                : "What staff need in order to use AI without asking — and what a customer would see if you shared this."}
            </p>
          </div>

          {/* The loudest control on the page, deliberately. */}
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border p-1">
            <button
              type="button"
              onClick={() => setAudience("internal")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] transition-colors",
                !external
                  ? "bg-secondary font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Users className="size-3.5" aria-hidden />
              Internal
            </button>
            <button
              type="button"
              onClick={() => setAudience("external")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] transition-colors",
                external
                  ? "bg-secondary font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Building2 className="size-3.5" aria-hidden />
              External
            </button>
          </div>
        </div>

        {external ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand/30 bg-brand/5 px-3.5 py-2.5">
            <Building2 className="size-4 shrink-0 text-brand" aria-hidden />
            <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed">
              <span className="font-medium">This is the customer view.</span>{" "}
              {hidden} items are withheld — tools that are not approved or being
              withdrawn, and the internal readiness figure. Nothing here names an
              owner, a finding or a risk rating.
            </p>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? <Copy aria-hidden /> : <Link2 aria-hidden />}
              {copied ? "Link copied" : "Copy share link"}
            </Button>
          </div>
        ) : (
          <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-muted-foreground">
            <EyeOff className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
            Entries marked with a struck-through eye are internal only. Switch to
            the customer view to see the page exactly as they would — the split
            is shown rather than applied silently, because a page that quietly
            shows less when shared is the one somebody eventually sends by
            mistake.
          </p>
        )}
      </header>

      <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-6">
        {/* ------------------------------------------------------ commitments */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium">
            {external ? "How we govern AI" : "What we say publicly"}
          </h2>
          <ul className="divide-y divide-border/60 border-y border-border">
            {visibleClaims.map((claim) => (
              <li key={claim.id} className="space-y-1 py-3">
                <div className="flex items-start gap-2">
                  {!external && claim.audience === "internal_only" && (
                    <EyeOff className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
                  )}
                  <p className="min-w-0 flex-1 text-sm leading-relaxed">{claim.claim}</p>
                </div>
                <p
                  className={cn(
                    "text-[0.8125rem] leading-relaxed text-muted-foreground",
                    !external && claim.audience === "internal_only" && "pl-5.5",
                  )}
                >
                  {claim.basis}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground/60">
            Every line is a checkable claim rather than a value statement. &ldquo;We
            take AI safety seriously&rdquo; commits to nothing and can never be shown
            false, which is why it is not here.
          </p>
        </section>

        {/* ------------------------------------------------------- the tools */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-medium">
              {external ? "AI systems we operate" : "May I use it?"}
            </h2>
            <span className="text-sm text-muted-foreground">
              {filtered.length} {external ? "shared" : "tools"}
            </span>
            <div className="relative ml-auto w-56">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a tool…"
                className="h-8 pl-8 text-sm"
                aria-label="Search tools"
              />
            </div>
          </div>

          <ul className="space-y-2">
            {filtered.map((tool) => (
              <li
                key={tool.systemId}
                className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {!external && tool.audience === "internal_only" && (
                    <EyeOff className="size-3.5 shrink-0 text-warn" aria-hidden />
                  )}
                  <h3 className="text-sm font-medium">{tool.name}</h3>
                  <span className="text-[0.8125rem] text-muted-foreground">{tool.vendor}</span>
                  <StatusBadge
                    className="ml-auto"
                    label={STATUS[tool.status].label}
                    tone={STATUS[tool.status].tone}
                  />
                </div>

                <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                  {STATUS[tool.status].blurb}
                </p>

                {tool.useFor.length > 0 && (
                  <p className="text-[0.8125rem] leading-relaxed">
                    <span className="text-muted-foreground">Approved for: </span>
                    {tool.useFor.join(", ")}
                  </p>
                )}

                {!external && (
                  <p className="text-[0.8125rem] leading-relaxed">
                    <span className="text-muted-foreground">Never put in: </span>
                    {tool.mayNotContain.join(", ")}
                  </p>
                )}

                {/* Internal only, deliberately. These are the aggregations a
                  * multi-purpose tool needs — how many jobs it does, the worst
                  * tier among them, whether all of them are assessed — and each
                  * would be a *new* external disclosure. Publishing them is a
                  * decision about what this organisation tells customers, not a
                  * side effect of the model learning to count. */}
                {!external && tool.governedUseCases > 0 && (
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-muted-foreground">
                    <span>
                      {tool.governedUseCases} governed purpose
                      {tool.governedUseCases === 1 ? "" : "s"}
                    </span>
                    {tool.highestTier && (
                      <span className={TONE_TEXT[RISK_TIER[tool.highestTier].tone]}>
                        {RISK_TIER[tool.highestTier].label} at worst
                      </span>
                    )}
                    <span className={tool.everyUseCaseAssessed ? "text-ok" : "text-warn"}>
                      {tool.everyUseCaseAssessed
                        ? "every purpose assessed"
                        : "not every purpose assessed"}
                    </span>
                  </p>
                )}

                <p className="text-[0.75rem] leading-relaxed text-muted-foreground/70">
                  {tool.oversight}
                  {/* Said out loud, because the line above is the *weakest* of
                    * however many purposes this tool serves, and without this it
                    * reads as the arrangement rather than as the floor. */}
                  <span className="block text-muted-foreground/50">
                    {tool.oversightBasis}
                  </span>
                </p>

                {!external && tool.withheldBecause && (
                  <p className="flex items-start gap-1.5 border-t border-border/60 pt-2 text-[0.75rem] leading-relaxed text-warn">
                    <EyeOff className="mt-0.5 size-3 shrink-0" aria-hidden />
                    Not shown externally — {tool.withheldBecause.toLowerCase()}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* ---------------------------------------------------- internal only */}
        {!external && (
          <section className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-medium">The rules</h2>
              {rules.policy && (
                <span className="text-[0.8125rem] text-muted-foreground">
                  {rules.policy.title} v{rules.policy.version} · approved{" "}
                  {formatDate(rules.policy.approvedAt ?? TODAY)}
                </span>
              )}
              <EyeOff className="ml-auto size-3.5 shrink-0 text-warn" aria-hidden />
            </div>
            <ul className="space-y-2">
              {rules.rules.map((rule) => (
                <li
                  key={rule.id}
                  className="rounded-md border border-border px-3 py-2 text-[0.8125rem] leading-relaxed"
                >
                  {rule.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* --------------------------------------------------------- the ask */}
        <section className="space-y-2 rounded-lg border border-border bg-secondary/20 p-4">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Eye className="size-3.5 text-muted-foreground" aria-hidden />
            {external ? "Ask us something" : "Want to use something that is not on the list?"}
          </h2>
          {external ? (
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              Send a due diligence questionnaire and we will answer it against our
              control set, with the supporting evidence named. Our commitment is
              five working days.
            </p>
          ) : (
            <>
              <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                Send it through intake. It takes about five minutes, and most
                requests are noted rather than escalated — the triage exists to
                find the few that need a forum decision, not to slow the rest
                down.
              </p>
              <Button size="sm" variant="outline" render={<Link href="/intake/new" />}>
                Raise a request
              </Button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
