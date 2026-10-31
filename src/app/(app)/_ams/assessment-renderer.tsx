"use client";

import { PreviewNotice } from "@/components/preview-notice";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { evaluate, fieldsUsedBy } from "@/lib/ams/predicate";
import { IMPACT_TEMPLATE } from "@/lib/ams/fixtures/assessment-template";
import { seedAnswers } from "@/lib/ams/fixtures/assessments";
import { ASSESSMENT_STATUS, ORIGIN, formatDate } from "@/lib/ams/labels";
import type {
  AiSuggestion,
  AnswerMap,
  AssessmentInstance,
  SignOffStep,
  SuggestionStatus,
  TemplateField,
  TemplateSection,
} from "@/lib/ams/types";
import { FieldRenderer, isAnswered, type RenderableField } from "./field-renderer";
import { SignOffBar, SentBackNotice } from "./sign-off-bar";
import { StatusBadge } from "./status-badge";
import { SuggestionCard } from "./suggestion-card";
import { refusalNote } from "@/lib/permissions";
import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";

/**
 * The assessment renderer, which knows nothing about assessments.
 *
 * It walks `IMPACT_TEMPLATE.sections`, evaluates each `showIf` against the
 * answer map, and hands every field to `FieldRenderer` to switch on its type.
 * There is no question text in this file and no field id — grep it and you will
 * find none. That is the property being demonstrated: the template is data, so
 * adding a regulator's new question is a fixture edit rather than a release.
 *
 * The conditional worth watching is the fairness section. Its `showIf` is at
 * *section* level, so answering "informs decisions about individual people" with
 * yes makes a whole section appear in the left rail and in the document — not
 * one extra field. Inside it, naming a protected or vulnerable group reveals the
 * disparity-testing question, which is the same mechanism nested one level down.
 *
 * Completion counts only what is currently visible. A hidden section's required
 * fields are not outstanding work, and counting them would leave every
 * assessment permanently incomplete for questions nobody was asked.
 */
export function AssessmentRenderer({ assessment }: { assessment: AssessmentInstance }) {
  const ws = useWorkspace();
  const { personById, systemById, getUseCase } = ws;
  const system = systemById(assessment.systemId);
  const useCase = assessment.useCaseId ? getUseCase(assessment.useCaseId) : undefined;

  // Seeded in the fixture layer, not here. Mapping "what the use case already
  // told us" onto template fields means naming field ids, and this file names
  // none — that is the property the screen exists to demonstrate.
  const [answers, setAnswers] = useState<AnswerMap>(() => seedAnswers(ws, assessment));

  const [sectionId, setSectionId] = useState(IMPACT_TEMPLATE.sections[0].id);
  const [signOff, setSignOff] = useState<SignOffStep[]>(assessment.signOff);
  /*
   * Who is looking. In the real product this is the signed-in user and there is
   * no switcher — it exists so a demo can show all three views of the same
   * document without three logins.
   */
  const [viewerId, setViewerId] = useState(assessment.signOff[0].assigneeId);
  const [sentBack, setSentBack] = useState<{ reason: string; byId: string } | null>(null);
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  /** Only the sections this system and these answers actually ask for. */
  const visibleSections = useMemo(
    () =>
      IMPACT_TEMPLATE.sections.filter((section) => {
        if (section.origins && system && !section.origins.includes(system.origin)) return false;
        return section.showIf ? evaluate(section.showIf, answers) : true;
      }),
    [answers, system],
  );

  const section =
    visibleSections.find((s) => s.id === sectionId) ?? visibleSections[0];

  const visibleFields = useMemo(
    () => section.fields.filter((f) => (f.showIf ? evaluate(f.showIf, answers) : true)),
    [section, answers],
  );

  function progressFor(target: TemplateSection) {
    const fields = target.fields.filter((f) =>
      f.showIf ? evaluate(f.showIf, answers) : true,
    );
    const required = fields.filter((f) => f.required);
    return {
      required: required.length,
      done: required.filter((f) => isAnswered(answers[f.id])).length,
    };
  }

  const totals = visibleSections.reduce(
    (acc, s) => {
      const p = progressFor(s);
      return { required: acc.required + p.required, done: acc.done + p.done };
    },
    { required: 0, done: 0 },
  );

  const currentStage = signOff.find((s) => s.state === "current");

  /*
   * A submitted document is frozen.
   *
   * Not politeness — correctness. A reviewer endorses the document they read,
   * and if the owner can keep typing underneath them the approver signs
   * something nobody reviewed. The owner's route back in is "Withdraw and
   * edit", which resets the reviews and says so first.
   */
  const editable = signOff[0].state === "current" && viewerId === signOff[0].assigneeId;

  function advanceSignOff() {
    setSignOff((prev) => {
      const at = prev.findIndex((s) => s.state === "current");
      if (at === -1) return prev;
      const done = prev.map((step, i) =>
        i === at ? { ...step, state: "complete" as const, completedAt: "2026-08-10" } : step,
      );
      // The next stage is the next one still outstanding, which is not always
      // the next in line: a withdrawn-and-resubmitted document can already
      // carry an endorsement that survived, and re-asking for it would be
      // asking the same person to sign the same thing twice.
      const next = done.findIndex((step, i) => i > at && step.state !== "complete");
      return next === -1
        ? done
        : done.map((step, i) => (i === next ? { ...step, state: "current" as const } : step));
    });
    setSentBack(null);
    setResetNotice(null);
  }

  /** Back to the owner, with every review given so far discarded. */
  function sendBack(reason: string) {
    const by = currentStage?.assigneeId ?? "";
    setSignOff((prev) =>
      prev.map((step, i) =>
        i === 0
          ? { ...step, state: "current", completedAt: null }
          : { ...step, state: "pending", completedAt: null },
      ),
    );
    setSentBack({ reason, byId: by });
    setViewerId(signOff[0].assigneeId);
  }

  /**
   * Reopen a submitted document without discarding what has been reviewed.
   *
   * The blunt version — reset everything on any withdrawal — makes fixing a typo
   * cost you an approval, which teaches owners not to fix typos. Reviews given
   * stand, and it is the *material* change below that invalidates them. That
   * distinction is the rule worth having: not "did you edit" but "did you change
   * what the document asks".
   */
  function withdraw() {
    const heldReviews = signOff.slice(1).some((s) => s.state === "complete");
    setSignOff((prev) =>
      prev.map((step, i) => {
        if (i === 0) return { ...step, state: "current" as const, completedAt: null };
        // Whatever stage was waiting goes back to pending — the document is with
        // the owner now, and two stages cannot both be current.
        return step.state === "current" ? { ...step, state: "pending" as const } : step;
      }),
    );
    setResetNotice(
      heldReviews
        ? "Reopened for editing. The reviews already given still stand — but changing an answer that alters which sections exist will reset them."
        : "Reopened for editing.",
    );
  }

  /**
   * Answer changes, with the one rule that has teeth.
   *
   * Changing a material field is changing which questions the document contains.
   * Any review already given was given against a different set of questions, so
   * it resets — silently carrying an endorsement across a change that adds an
   * entire section is how a signature ends up attached to something nobody read.
   */
  function answerChanged(field: TemplateField, value: unknown) {
    setAnswers((a) => ({ ...a, [field.id]: value }));

    if (!field.material) return;
    if (!signOff.slice(1).some((s) => s.state === "complete")) return;

    setSignOff((prev) =>
      prev.map((step, i) =>
        i === 0 ? { ...step, state: "current", completedAt: null } : { ...step, state: "pending", completedAt: null },
      ),
    );
    setResetNotice(
      `Changing "${field.label}" changes which sections this assessment contains, so the reviews already given have been reset.`,
    );
  }

  const index = visibleSections.findIndex((s) => s.id === section.id);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="space-y-3 border-b border-border px-6 py-5">
        <Link
          href={`/inventory/${assessment.systemId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {system?.name ?? "System"}
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">
            {useCase ? useCase.name : system?.name}
          </h1>
          <StatusBadge
            label={ASSESSMENT_STATUS[assessment.status].label}
            tone={ASSESSMENT_STATUS[assessment.status].tone}
          />
          <span className="text-xs text-muted-foreground">
            {IMPACT_TEMPLATE.name} v{IMPACT_TEMPLATE.version}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm text-muted-foreground">
            {system && ORIGIN[system.origin].label} · due {formatDate(assessment.dueAt)} ·{" "}
            {totals.done} of {totals.required} required answers complete
          </p>

          <div className="ml-auto flex items-center gap-1.5">
            <span className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
              Viewing as
            </span>
            {signOff.map((step) => (
              <button
                key={step.stage}
                type="button"
                onClick={() => setViewerId(step.assigneeId)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[0.75rem] transition-colors",
                  viewerId === step.assigneeId
                    ? "border-primary/50 bg-primary/10"
                    : "border-border text-muted-foreground hover:bg-secondary/50",
                )}
              >
                {personById(step.assigneeId).name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="px-6 py-3">
        <PreviewNotice>
          Manual answer edits, reviewer simulation and sign-off on this screen are not saved.
          Reloading restores stored values. Accepting a draft suggestion is a separate saved action.
        </PreviewNotice>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------- the section rail */}
        <nav className="w-64 shrink-0 overflow-y-auto border-r border-border p-3">
          <p className="px-2 pt-1 pb-2 font-mono text-[0.6rem] uppercase tracking-[0.11em] text-muted-foreground/60">
            Sections
          </p>
          <ol className="space-y-0.5">
            {visibleSections.map((s, i) => {
              const p = progressFor(s);
              const done = p.required > 0 && p.done === p.required;
              const conditional = Boolean(s.showIf || s.origins);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSectionId(s.id)}
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      s.id === section.id
                        ? "bg-secondary font-medium"
                        : "text-muted-foreground hover:bg-secondary/50",
                    )}
                  >
                    <span className="w-4 shrink-0 tabular text-[0.6875rem] text-muted-foreground/50">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-[0.8125rem] leading-snug">
                      {s.title}
                      {conditional && (
                        <span
                          className="ml-1.5 text-brand"
                          title="This section appeared because of an answer you gave"
                        >
                          ·
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular text-[0.6875rem]",
                        done ? "text-ok" : "text-muted-foreground/60",
                      )}
                    >
                      {p.required === 0 ? "—" : `${p.done}/${p.required}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <p className="mt-4 px-2 text-[0.6875rem] leading-relaxed text-muted-foreground/60">
            Sections marked <span className="text-brand">·</span> appeared because
            of an answer. Change the answer and they leave again — nothing here is
            hard-coded.
          </p>
        </nav>

        {/* ---------------------------------------------------- the section */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 px-6 py-6 pb-32">
            {sentBack && <SentBackNotice reason={sentBack.reason} byId={sentBack.byId} />}

            {resetNotice && (
              <p className="rounded-lg border border-brand/25 bg-brand/5 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
                {resetNotice}
              </p>
            )}

            {!editable && (
              <p className="rounded-lg border border-border bg-secondary/30 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
                {viewerId === signOff[0].assigneeId
                  ? "Submitted, so the answers are frozen. Withdraw it below to edit — that resets any review already given."
                  : `Read only. This document belongs to ${personById(signOff[0].assigneeId).name}; you are here to review it, not to change it.`}
              </p>
            )}

            <header className="space-y-1.5">
              <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
                Section {index + 1} of {visibleSections.length}
              </p>
              <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {section.intent}
              </p>
              {section.showIf && (
                <p className="flex items-start gap-1.5 rounded-md border border-brand/25 bg-brand/5 px-2.5 py-1.5 text-[0.8125rem] text-muted-foreground">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                  <span>
                    Shown because of your answer to{" "}
                    <span className="text-foreground">
                      {labelFor(fieldsUsedBy(section.showIf)[0])}
                    </span>
                    .
                  </span>
                </p>
              )}
            </header>

            <div className="space-y-6">
              {visibleFields.map((field) => (
                <AssessmentField
                  key={field.id}
                  assessmentId={assessment.id}
                  field={field}
                  value={answers[field.id]}
                  onChange={(value) => answerChanged(field, value)}
                  readOnly={!editable}
                />
              ))}
            </div>

            <div className="flex items-center gap-2 border-t border-border pt-4">
              {index > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSectionId(visibleSections[index - 1].id)}
                >
                  <ArrowLeft aria-hidden />
                  {visibleSections[index - 1].title}
                </Button>
              )}
              {index < visibleSections.length - 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setSectionId(visibleSections[index + 1].id)}
                >
                  {visibleSections[index + 1].title}
                  <ChevronRight aria-hidden />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <SignOffBar
        steps={signOff}
        viewerId={viewerId}
        outstanding={totals.required - totals.done}
        onAdvance={advanceSignOff}
        onSendBack={sendBack}
        onWithdraw={withdraw}
      />
    </div>
  );
}

/* -------------------------------------------------------------- one field */

/**
 * A field, plus the assist that belongs to it.
 *
 * The assist only appears where the template says `aiAssist`, and it renders
 * through the same `SuggestionCard` as intake triage and the SoA. Accepting
 * writes into the field; rejecting leaves whatever the person typed. The button
 * says "Draft" rather than "Generate" because the product's claim is that this
 * is a first pass someone edits, not an answer.
 */
/** Worded like the 403 `/api/ai/draft-*` would return, because it is the same refusal. */
const DRAFT_REFUSAL = refusalNote("draft with AI");

function AssessmentField({
  assessmentId,
  field,
  value,
  onChange,
  readOnly,
}: {
  assessmentId: string;
  field: TemplateField;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pendingSuggestionsFor } = useWorkspace();
  const { draftWithAi } = usePermissions();

  // Seeded from the workspace: the proposal is stored when it is made, so a
  // refresh has to find an outstanding one rather than silently losing it.
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(() => {
    // Exact match: the prefix helper would let field `purpose` adopt a proposal
    // made for `purposeLimitation`.
    const target = `${assessmentId}.${field.id}`;
    return pendingSuggestionsFor(target).find((s) => s.target.id === target) ?? null;
  });
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  async function draft() {
    setDrafting(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/ai/draft-assessment-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId,
          fieldId: field.id,
          label: field.label,
          help: field.help,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setDraftError(payload.error ?? "Drafting failed.");
        return;
      }
      setSuggestion(payload.suggestion);
    } catch {
      setDraftError("Could not reach the drafting service. Check your connection and try again.");
    } finally {
      setDrafting(false);
    }
  }

  async function decide(status: SuggestionStatus, text: string) {
    if (!suggestion) return;
    if (status === "accepted" || status === "edited") onChange(text);
    await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestionId: suggestion.id, status, text }),
    });
    setSuggestion(null);
    /*
     * Required, and it does more here than elsewhere: accepting a drafted answer
     * is a material change, so the server has also reset the sign-off chain.
     * Without the refresh the bar at the foot of the page would keep showing an
     * endorsement that no longer exists.
     */
    router.refresh();
  }

  /*
   * A frozen document renders as prose, not as disabled inputs.
   *
   * Greyed-out form controls read as "broken" and invite clicking; a reviewer
   * reading a submitted assessment is reading a document, and it should look
   * like one.
   */
  if (readOnly) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">{field.label}</p>
        <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
          {formatAnswer(field, value)}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <FieldRenderer
        field={field as RenderableField}
        value={value}
        onChange={onChange}
      />

      {field.aiAssist && !suggestion && !drafting && (
        /* See the SoA workbench: disabled and explained, never absent.
         * `/api/ai/draft-assessment-field` re-checks `ai: ["draft"]`. */
        <button
          type="button"
          onClick={draft}
          disabled={!draftWithAi}
          title={draftWithAi ? undefined : DRAFT_REFUSAL}
          className="inline-flex items-center gap-1.5 text-[0.75rem] text-muted-foreground transition-colors hover:text-brand disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground"
        >
          <Sparkles className="size-3" aria-hidden />
          Draft this with AI
        </button>
      )}

      {drafting && (
        <p className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
          <Sparkles className="size-3 animate-pulse text-brand" aria-hidden />
          Reading the system record, its use cases and the evidence attached to it…
        </p>
      )}

      {draftError && <p className="text-[0.75rem] text-critical">{draftError}</p>}

      {suggestion && (
        <SuggestionCard
          suggestion={suggestion}
          targetLabel={field.label}
          // Only an accepted or edited suggestion writes into the field.
          // Rejecting still records the decision and leaves whatever the person
          // had already typed untouched.
          onDecision={decide}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- helpers */

/** An answer, rendered for reading rather than editing. */
function formatAnswer(field: TemplateField, value: unknown): string {
  if (value === undefined || value === null || value === "") return "Not answered";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (Array.isArray(value)) {
    if (value.length === 0) return "Not answered";
    // Repeatable rows arrive as objects; everything else is option values.
    if (typeof value[0] === "object") {
      return (value as Record<string, string>[])
        .map((row) => Object.values(row).filter(Boolean).join(" — "))
        .join("; ");
    }
    return (value as string[])
      .map((v) => field.options?.find((o) => o.value === v)?.label ?? v)
      .join(", ");
  }

  return field.options?.find((o) => o.value === value)?.label ?? String(value);
}

/** The human label for a field id, so a conditional can explain itself. */
function labelFor(fieldId: string): string {
  for (const section of IMPACT_TEMPLATE.sections) {
    const field = section.fields.find((f) => f.id === fieldId);
    if (field) return field.label;
  }
  return fieldId;
}
