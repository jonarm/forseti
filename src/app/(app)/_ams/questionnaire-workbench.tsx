"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Loader2,
  Pencil,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  QUESTIONNAIRE_STATUS,
  REQUESTER_TYPE,
} from "@/lib/ams/fixtures/questionnaires";
import { confidenceBand } from "@/lib/ams/fixtures/ai";
import { formatDate, isOverdue, utcToday } from "@/lib/ams/labels";
import type { DraftedAnswer, Questionnaire, QuestionnaireQuestion } from "@/lib/ams/types";
import { StatusBadge } from "./status-badge";
import { refusalNote } from "@/lib/permissions";
import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";

/**
 * Answering a customer questionnaire, with the receipts attached.
 *
 * The value is not the prose. Any model writes a confident paragraph about AI
 * governance; what makes an answer *sendable* is knowing which control, policy
 * and document it came from and whether those are currently in a state you would
 * be happy for the customer to inspect. So the provenance is not a disclosure
 * behind a chevron — it sits under every answer, with each citation marked sound
 * or not, and the caveats stated in the words somebody would use when handing the
 * answer over.
 *
 * Two behaviours are the point:
 *
 *   - **Nothing is sent until a person accepts it.** Draft, then Accept, Edit or
 *     Reject, and the record keeps who decided. Same pattern as intake triage
 *     and the SoA justification writer, because it is the same claim.
 *   - **Refusing is a legitimate answer.** Two of these questions have nothing
 *     in the record behind them, and the copilot declines rather than composing
 *     something. Inventing an answer to a certification question is how an
 *     organisation ends up having made a false statement to a customer in
 *     writing.
 */

type Decision = "pending" | "accepted" | "edited" | "rejected";

interface AnswerState {
  draft: DraftedAnswer | null;
  drafting: boolean;
  text: string;
  decision: Decision;
  editing: boolean;
  decidedAt: string | null;
}

const EMPTY: AnswerState = {
  draft: null,
  drafting: false,
  text: "",
  decision: "pending",
  editing: false,
  decidedAt: null,
};

/** Worded like the 403 `/api/ai/draft-answer` would return, because it is the same refusal. */
const COPILOT_REFUSAL = refusalNote("use the questionnaire copilot");

export function QuestionnaireWorkbench({ questionnaire }: { questionnaire: Questionnaire }) {
  const ws = useWorkspace();
  const { personById } = ws;
  const { useCopilot } = usePermissions();
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [batchError, setBatchError] = useState<string | null>(null);

  /**
   * Draft one question or all of them, through the same call.
   *
   * The header button and the per-question button differ only in how many ids
   * they pass. Two code paths would let the fan-out drift from the single —
   * typically by forgetting that a refusal is a valid result — and a refusal
   * that renders correctly one at a time and vanishes in the batch is the worst
   * possible version of this feature.
   */
  async function draft(ids: string[]) {
    if (ids.length === 0) return;
    setBatchError(null);
    setAnswers((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { ...EMPTY, ...next[id], drafting: true };
      return next;
    });

    try {
      const res = await fetch("/api/ai/draft-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionnaireId: questionnaire.id, questionIds: ids }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setBatchError(payload.error ?? "Drafting failed.");
        setAnswers((prev) => {
          const next = { ...prev };
          for (const id of ids) next[id] = { ...EMPTY, ...next[id], drafting: false };
          return next;
        });
        return;
      }

      setAnswers((prev) => {
        const next = { ...prev };
        for (const answer of payload.answers as DraftedAnswer[]) {
          next[answer.questionId] = {
            ...EMPTY,
            ...next[answer.questionId],
            draft: answer,
            drafting: false,
            // A refusal has no text to edit; the field stays empty and the
            // refusal renders in its place.
            text: answer.text ?? "",
          };
        }
        return next;
      });
    } catch {
      setBatchError("Could not reach the drafting service. Check your connection and try again.");
      setAnswers((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = { ...EMPTY, ...next[id], drafting: false };
        return next;
      });
    }
  }

  /*
   * Only the questions that have neither a draft nor one in flight.
   *
   * Re-drafting a question somebody already accepted would silently replace
   * their decision, and paying for a second draft of something already on
   * screen is waste. "Draft all" means "draft the rest".
   */
  const undrafted = questionnaire.questions
    .filter((q) => !answers[q.id]?.draft && !answers[q.id]?.drafting)
    .map((q) => q.id);

  const anyDrafting = questionnaire.questions.some((q) => answers[q.id]?.drafting);

  const settled = useMemo(
    () =>
      questionnaire.questions.filter(
        (q) => answers[q.id]?.decision === "accepted" || answers[q.id]?.decision === "edited",
      ).length,
    [answers, questionnaire.questions],
  );

  const flagged = useMemo(
    () =>
      questionnaire.questions.filter((q) => (answers[q.id]?.draft?.caveats.length ?? 0) > 0)
        .length,
    [answers, questionnaire.questions],
  );

  function patch(id: string, next: Partial<AnswerState>) {
    setAnswers((prev) => ({ ...prev, [id]: { ...EMPTY, ...prev[id], ...next } }));
  }

  const late = isOverdue(questionnaire.dueAt);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="space-y-3 border-b border-border px-6 py-5">
        <Link
          href="/questionnaires"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Questionnaires
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight">{questionnaire.title}</h1>
              <StatusBadge
                label={QUESTIONNAIRE_STATUS[questionnaire.status].label}
                tone={QUESTIONNAIRE_STATUS[questionnaire.status].tone}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {questionnaire.requester} · {REQUESTER_TYPE[questionnaire.requesterType]} ·
              received {formatDate(questionnaire.receivedAt)} · due{" "}
              <span className={cn(late && "text-critical")}>
                {formatDate(questionnaire.dueAt)}
              </span>{" "}
              · owner {personById(questionnaire.ownerId).name}
            </p>
            <p className="max-w-3xl text-[0.8125rem] leading-relaxed text-muted-foreground/80">
              {questionnaire.note}
            </p>
          </div>

          <Button
            size="sm"
            onClick={() => draft(undrafted)}
            disabled={anyDrafting || undrafted.length === 0 || !useCopilot}
            title={useCopilot ? undefined : COPILOT_REFUSAL}
          >
            <Sparkles aria-hidden />
            {anyDrafting
              ? "Drafting…"
              : undrafted.length === 0
                ? "All questions drafted"
                : `Draft ${undrafted.length} answer${undrafted.length === 1 ? "" : "s"}`}
          </Button>
        </div>

        {batchError && (
          <p className="rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-[0.8125rem] text-critical">
            {batchError}
          </p>
        )}

        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">
            {settled} of {questionnaire.questions.length} answered
          </span>
          {flagged > 0 && (
            <>
              , <span className="text-warn">{flagged} carrying a caveat</span>
            </>
          )}
          . Nothing leaves this screen until a person accepts it.
        </p>
      </header>

      <div className="mx-auto w-full max-w-4xl space-y-4 px-6 py-6">
        {questionnaire.questions.map((question) => {
          const state = answers[question.id] ?? EMPTY;
          return (
            <QuestionCard
              key={question.id}
              question={question}
              state={state}
              onPatch={(next) => patch(question.id, next)}
              onDraft={() => draft([question.id])}
            />
          );
        })}

        {questionnaire.questions.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            This questionnaire was answered and submitted; the questions are held
            with the response rather than in the working view.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- one question */

function QuestionCard({
  question,
  state,
  onPatch,
  onDraft,
}: {
  question: QuestionnaireQuestion;
  state: AnswerState;
  onPatch: (next: Partial<AnswerState>) => void;
  onDraft: () => void;
}) {
  const { personById } = useWorkspace();
  const { useCopilot } = usePermissions();
  const { draft, drafting, text, decision, editing } = state;
  const band = draft ? confidenceBand(draft.confidence) : null;
  const decided = decision !== "pending";

  return (
    <section
      className={cn(
        "space-y-3 rounded-lg border p-4",
        decided ? "border-border bg-secondary/20" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start gap-2.5">
        <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground/70">
          {question.number}
        </span>
        <h2 className="min-w-0 flex-1 text-sm font-medium leading-snug">{question.text}</h2>
        {decided && (
          <StatusBadge
            label={OUTCOME[decision].label}
            tone={OUTCOME[decision].tone}
          />
        )}
      </div>

      {!draft && !drafting && (
        <Button
          variant="outline"
          size="xs"
          onClick={onDraft}
          disabled={!useCopilot}
          title={useCopilot ? undefined : COPILOT_REFUSAL}
        >
          <Sparkles aria-hidden />
          Draft from our records
        </Button>
      )}

      {drafting && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Reading the control set, the policy library and the evidence register…
        </p>
      )}

      {draft && (
        <>
          {/* ------------------------------------------------- the answer */}
          {draft.text === null ? (
            <div className="space-y-1.5 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium">
                <ShieldCheck className="size-3.5 shrink-0 text-warn" aria-hidden />
                No answer drafted — the record does not support one
              </p>
              <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                {draft.refusal}
              </p>
            </div>
          ) : editing ? (
            <Textarea
              rows={6}
              value={text}
              onChange={(e) => onPatch({ text: e.target.value })}
              aria-label={`Answer to ${question.number}`}
              className="text-sm leading-relaxed"
            />
          ) : (
            <p
              className={cn(
                "text-sm leading-relaxed",
                decision === "rejected" && "text-muted-foreground line-through",
              )}
            >
              {text}
            </p>
          )}

          {/* --------------------------------------------------- provenance */}
          <div className="space-y-2 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
                What this rests on
              </p>
              {band && (
                <StatusBadge
                  label={`${band.label} · ${Math.round(draft.confidence * 100)}%`}
                  tone={band.tone}
                />
              )}
              {draft.lastVerified && (
                <span className="text-[0.6875rem] text-muted-foreground/60">
                  Oldest evidence collected {formatDate(draft.lastVerified)}
                </span>
              )}
            </div>

            {draft.citations.length === 0 ? (
              <p className="text-[0.8125rem] text-muted-foreground">
                Nothing cited. An answer with no provenance is one nobody can
                stand behind when it is quoted back.
              </p>
            ) : (
              <ul className="space-y-1">
                {draft.citations.map((c) => (
                  <li key={`${c.kind}-${c.id}`} className="flex items-start gap-2 text-[0.8125rem]">
                    <span
                      className={cn(
                        "mt-1 size-1.5 shrink-0 rounded-full",
                        c.sound ? "bg-ok" : "bg-warn",
                      )}
                      aria-hidden
                    />
                    <span className="w-16 shrink-0 text-[0.6875rem] uppercase tracking-wider text-muted-foreground/50">
                      {c.kind}
                    </span>
                    <Link
                      href={c.href}
                      className="min-w-0 flex-1 underline-offset-4 hover:underline"
                    >
                      {c.label}
                    </Link>
                    <span
                      className={cn(
                        "shrink-0 text-[0.75rem]",
                        c.sound ? "text-muted-foreground/60" : "text-warn",
                      )}
                    >
                      {c.detail}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {draft.caveats.length > 0 && (
              <ul className="space-y-1 rounded-md border border-warn/25 bg-warn/5 px-2.5 py-2">
                {draft.caveats.map((caveat, i) => (
                  <li key={i} className="text-[0.8125rem] leading-snug text-muted-foreground">
                    {caveat}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ----------------------------------------------------- decision */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            {decided ? (
              <p className="text-xs text-muted-foreground">
                {OUTCOME[decision].verb} by {personById("p-larsen").name}
                {state.decidedAt && ` · ${formatDate(state.decidedAt)}`}
              </p>
            ) : editing ? (
              <>
                <Button
                  size="xs"
                  onClick={() => onPatch({ decision: "edited", editing: false, decidedAt: utcToday() })}
                >
                  <Check aria-hidden />
                  Save and use
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onPatch({ editing: false, text: draft.text ?? "" })}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                {draft.text !== null && (
                  <Button
                    size="xs"
                    onClick={() => onPatch({ decision: "accepted", decidedAt: utcToday() })}
                  >
                    <Check aria-hidden />
                    Use this answer
                  </Button>
                )}
                <Button size="xs" variant="outline" onClick={() => onPatch({ editing: true })}>
                  <Pencil aria-hidden />
                  {draft.text === null ? "Write one" : "Edit"}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onPatch({ decision: "rejected", decidedAt: utcToday() })}
                >
                  <X aria-hidden />
                  Reject
                </Button>
                <p className="ml-auto text-[0.6875rem] text-muted-foreground/60">
                  Nothing is sent until you choose.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const OUTCOME: Record<
  Decision,
  { label: string; verb: string; tone: "ok" | "warn" | "critical" | "info" | "neutral" }
> = {
  pending: { label: "Awaiting a decision", verb: "Drafted", tone: "neutral" },
  accepted: { label: "Answer accepted", verb: "Accepted", tone: "ok" },
  edited: { label: "Edited and used", verb: "Edited and accepted", tone: "ok" },
  rejected: { label: "Rejected", verb: "Rejected", tone: "neutral" },
};
