"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { confidenceBand } from "@/lib/ams/fixtures/ai";
import { formatTimestamp } from "@/lib/ams/fixtures/activity";
import type { AiSuggestion, SuggestionStatus } from "@/lib/ams/types";
import { StatusBadge } from "./status-badge";
import { refusalNote } from "@/lib/permissions";
import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";

/**
 * AI proposes, humans dispose — the product's core claim, as one component.
 *
 * Every AI surface renders through here: intake triage, the SoA justification
 * writer, the per-section assessment assist. Using one card is the point. Three
 * bespoke ones would make the pattern read as a coincidence rather than as a
 * rule the product follows everywhere.
 *
 * Four things it will not do, each of them deliberate:
 *
 *   - **Nothing is applied on arrival.** The recommendation renders as a
 *     proposal in a bordered card, visually distinct from the record it would
 *     change. Until someone clicks, the underlying value is untouched.
 *   - **Reasoning is always shown, never collapsed behind a disclosure.** A
 *     recommendation you have to click twice to interrogate is one people stop
 *     interrogating by the third day.
 *   - **Supporting data names records, not categories.** "34 sites shared
 *     organisation-wide" can be checked and argued with; "internal analysis"
 *     cannot, and an unarguable recommendation gets accepted blind or ignored.
 *   - **A decision leaves a mark.** After Accept, Edit or Reject the card keeps
 *     the outcome, who made it and when. The rejected ones stay too — an
 *     assistant that shows only its accepted suggestions is keeping a record of
 *     its own wins, and the thing worth proving to an auditor is that a person
 *     was able to say no.
 *
 * **Deciding is a permission; reading the proposal is not.** Someone who cannot
 * accept still sees the recommendation, its reasoning and its supporting data —
 * an auditor reviewing what the model proposed and whether anybody adopted it
 * needs exactly that, and hiding the card would hide the evidence along with the
 * button. Only the decision row changes, and it says why rather than going
 * blank. `/api/suggestions` re-checks; this is the courtesy, not the gate.
 */
/** Worded like the 403 `/api/suggestions` would return, because it is the same refusal. */
const DECIDE_REFUSAL = refusalNote("accept or reject a drafted suggestion");

export function SuggestionCard({
  suggestion,
  /** What the recommendation would be written into, e.g. "Risk tier". */
  targetLabel,
  onDecision,
  className,
}: {
  suggestion: AiSuggestion;
  targetLabel?: string;
  onDecision?: (status: SuggestionStatus, text: string) => void;
  className?: string;
}) {
  const { personById } = useWorkspace();
  const { answerControls } = usePermissions();
  const [status, setStatus] = useState<SuggestionStatus>(suggestion.status);
  const [text, setText] = useState(suggestion.editedText ?? suggestion.recommendation);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<SuggestionStatus | null>(null);
  const [decidedBy, setDecidedBy] = useState(suggestion.decidedById);
  const [decidedAt, setDecidedAt] = useState(suggestion.decidedAt);

  const band = confidenceBand(suggestion.confidence);
  const decided = status !== "pending";

  function decide(next: SuggestionStatus, value: string) {
    setPending(next);
    // The deliberate delay again — applying a decision is a write, and a write
    // that returns instantly teaches people the screen is a drawing.
    window.setTimeout(() => {
      setStatus(next);
      setText(value);
      setEditing(false);
      setPending(null);
      // In the real product this is the signed-in user; the mockup uses the
      // governance lead so the audit trail below reads correctly.
      setDecidedBy("p-anders");
      setDecidedAt(new Date().toISOString());
      onDecision?.(next, value);
    }, 800);
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-secondary/20",
        decided ? "border-border" : "border-brand/30",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <Sparkles
          className={cn("size-3.5 shrink-0", decided ? "text-muted-foreground" : "text-brand")}
          aria-hidden
        />
        <span className="text-xs font-medium">
          {decided ? "Suggested" : "Suggestion"}
          {targetLabel ? ` · ${targetLabel}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge
            label={`${band.label} · ${Math.round(suggestion.confidence * 100)}%`}
            tone={band.tone}
          />
          {decided && <StatusBadge label={OUTCOME[status].label} tone={OUTCOME[status].tone} />}
        </div>
      </div>

      <div className="space-y-3 p-3">
        {editing ? (
          <Textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Edit the recommendation"
            className="text-sm"
          />
        ) : (
          <p
            className={cn(
              "text-sm leading-relaxed",
              status === "rejected" && "text-muted-foreground line-through",
            )}
          >
            {text}
          </p>
        )}

        <div className="space-y-1.5">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
            Reasoning
          </p>
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            {suggestion.reasoning}
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
            What this is based on
          </p>
          <ul className="space-y-1">
            {suggestion.supportingData.map((item, i) => (
              <li key={i} className="flex gap-2 text-[0.8125rem] leading-snug">
                <span className="shrink-0 text-muted-foreground/70">{item.label}</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-foreground/90">{item.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-3 py-2">
        {decided ? (
          <p className="text-xs text-muted-foreground">
            {OUTCOME[status].verb} by{" "}
            <span className="text-foreground">{personById(decidedBy).name}</span>
            {decidedAt && <> · {formatTimestamp(decidedAt)}</>}
          </p>
        ) : editing ? (
          <>
            <Button size="xs" onClick={() => decide("edited", text)} disabled={pending !== null}>
              {pending === "edited" ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Save and apply
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setText(suggestion.recommendation);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              size="xs"
              onClick={() => decide("accepted", text)}
              disabled={pending !== null || !answerControls}
              title={answerControls ? undefined : DECIDE_REFUSAL}
            >
              {pending === "accepted" ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Accept
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => setEditing(true)}
              disabled={pending !== null || !answerControls}
              title={answerControls ? undefined : DECIDE_REFUSAL}
            >
              <Pencil aria-hidden />
              Edit
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => decide("rejected", text)}
              disabled={pending !== null || !answerControls}
              title={answerControls ? undefined : DECIDE_REFUSAL}
            >
              {pending === "rejected" ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
              Reject
            </Button>
            <p className="ml-auto text-[0.6875rem] text-muted-foreground/60">
              {answerControls
                ? "Nothing changes until you choose."
                : "Waiting on somebody who can answer controls."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const OUTCOME: Record<
  SuggestionStatus,
  { label: string; verb: string; tone: "ok" | "warn" | "critical" | "neutral" }
> = {
  pending: { label: "Awaiting decision", verb: "Proposed", tone: "neutral" },
  accepted: { label: "Accepted", verb: "Accepted", tone: "ok" },
  edited: { label: "Accepted with edits", verb: "Edited and accepted", tone: "ok" },
  rejected: { label: "Rejected", verb: "Rejected", tone: "neutral" },
};
