"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Send, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { BUSINESS_UNITS } from "@/lib/ams/fixtures/people";
import { EXAMPLE_SUBMISSION, QUESTION_SETS } from "@/lib/ams/fixtures/intake";
import { DATA_CATEGORY, ORIGIN } from "@/lib/ams/labels";
import type { DataCategory, IntakeSubmission, SystemOrigin } from "@/lib/ams/types";
import { FieldRenderer, isAnswered, type RenderableField } from "./field-renderer";

/**
 * The requester's form. Five steps, and nothing else.
 *
 * Triage and the decision used to live at the bottom of this component, which
 * made the demo read as though one person submits a request and immediately
 * rules on it. They now live on the reviewer's route, and this screen ends where
 * a requester's involvement actually ends: the request goes into the queue.
 *
 * The one mechanism that matters here is step 3. It renders
 * `QUESTION_SETS[origin]`, so choosing a different origin on step 2 changes what
 * you are asked next — no branch in this file names a question, which is what
 * makes "origin drives the workflow" a mechanism rather than a claim. Verify it
 * by grepping this file for any field id; there are none.
 */

const STEPS = ["Basics", "Origin", "Origin questions", "Data and exposure", "Review"] as const;

const EMPTY: IntakeSubmission = {
  name: "",
  description: "",
  businessUnit: "",
  origin: null,
  isGenAi: null,
  vendor: "",
  dataCategories: [],
  facesCustomers: null,
  informsDecisionsAboutPeople: null,
  originAnswers: {},
};

const DATA_OPTIONS = (Object.keys(DATA_CATEGORY) as DataCategory[]).map((key) => ({
  value: key,
  label: DATA_CATEGORY[key].label,
}));

export function IntakeWizard() {
  const router = useRouter();

  const [submission, setSubmission] = useState<IntakeSubmission>(EMPTY);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  function set<K extends keyof IntakeSubmission>(key: K, value: IntakeSubmission[K]) {
    setSubmission((s) => ({ ...s, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  }

  function setOriginAnswer(id: string, value: unknown) {
    setSubmission((s) => ({ ...s, originAnswers: { ...s.originAnswers, [id]: value } }));
    setErrors((e) => (e[id] ? { ...e, [id]: "" } : e));
  }

  function validateStep(): boolean {
    const next: Record<string, string> = {};

    if (step === 0) {
      if (submission.name.trim().length < 2) next.name = "Give it a name people will recognise.";
      if (submission.description.trim().length < 20)
        next.description = "Describe what it would be used for — at least a sentence.";
      if (!submission.businessUnit) next.businessUnit = "Which team is asking for this?";
    }

    if (step === 1 && !submission.origin)
      next.origin = "Origin decides which questions come next.";

    if (step === 2 && submission.origin) {
      for (const field of QUESTION_SETS[submission.origin].fields) {
        if (field.required && !isAnswered(submission.originAnswers[field.id]))
          next[field.id] = "This one is required.";
      }
    }

    if (step === 3) {
      if (submission.isGenAi === null) next.isGenAi = "Does it generate content?";
      if (submission.dataCategories.length === 0)
        next.dataCategories = "Pick at least one — 'none' is almost never true.";
      if (submission.facesCustomers === null) next.facesCustomers = "Required.";
      if (submission.informsDecisionsAboutPeople === null)
        next.informsDecisionsAboutPeople = "Required.";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function advance() {
    if (!validateStep()) return;
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }

    setSubmitting(true);
    setFailure(null);

    /*
     * The answers go up, and nothing else.
     *
     * This used to run the triage rules here and send the recommendation with
     * the form. It was never shown to the requester on the way past — it went
     * straight from `triage()` into the body — so the round trip bought nothing
     * and cost the one thing that matters: `reviewType` is the baseline
     * `/api/intake/decision` measures a departure against, and a client that can
     * name it can submit a request that is quietly agreed with rather than
     * quietly overridden. The route runs the same rules over the same
     * submission.
     */
    void (async () => {
      try {
        const response = await fetch("/api/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submission }),
        });
        const json = await response.json().catch(() => ({}));

        if (!response.ok) {
          setFailure(String(json.error ?? "The request could not be submitted."));
          setSubmitting(false);
          return;
        }

        // Straight to the review screen, which is now reading a stored row
        // rather than one held in this tab.
        router.push(`/intake/${json.id}`);
      } catch {
        setFailure("Could not reach the server. Nothing was submitted.");
        setSubmitting(false);
      }
    })();
  }

  if (submitting) {
    return (
      <div className="flex flex-col items-center gap-3 py-32">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">Running triage rules…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href="/intake"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Intake &amp; triage
      </Link>

      <header className="mt-3 space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">Register an AI request</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Six questions, then it goes to the governance queue. Answer honestly
          rather than carefully — the point of triage is to send the risky things
          to the right people, not to catch you out.
        </p>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setSubmission(EXAMPLE_SUBMISSION);
            setStep(4);
            setErrors({});
          }}
        >
          <Sparkles aria-hidden />
          Fill with an example
        </Button>
      </header>

      <ol className="mt-6 flex flex-wrap gap-1.5">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={cn(
                "w-full space-y-1 border-t-2 pt-2 text-left transition-colors",
                i < step && "cursor-pointer border-ok/50",
                i === step && "border-primary",
                i > step && "cursor-default border-border",
              )}
            >
              <span
                className={cn(
                  "block font-mono text-[0.6rem] uppercase tracking-wider",
                  i === step ? "text-foreground" : "text-muted-foreground/60",
                )}
              >
                {i + 1}. {label}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-6 space-y-5">
        {step === 0 && (
          <>
            <FieldRenderer
              field={{ id: "name", label: "What is it called?", type: "short_text", required: true }}
              value={submission.name}
              onChange={(v) => set("name", v as string)}
              error={errors.name}
            />
            <FieldRenderer
              field={{
                id: "description",
                label: "What would it be used for?",
                type: "long_text",
                required: true,
                help: "The job it does, in the words you would use to a colleague.",
              }}
              value={submission.description}
              onChange={(v) => set("description", v as string)}
              error={errors.description}
            />
            <FieldRenderer
              field={{
                id: "businessUnit",
                label: "Which team is asking?",
                type: "single_select",
                required: true,
                options: BUSINESS_UNITS.map((u) => ({ value: u, label: u })),
              }}
              value={submission.businessUnit}
              onChange={(v) => set("businessUnit", v as string)}
              error={errors.businessUnit}
            />
            <FieldRenderer
              field={{
                id: "vendor",
                label: "Who supplies it?",
                type: "short_text",
                help: "Leave blank if we would be building it ourselves.",
              }}
              value={submission.vendor}
              onChange={(v) => set("vendor", v as string)}
            />
          </>
        )}

        {step === 1 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Where would it come from?</Label>
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              This is the question that decides what we ask you next. The three
              routes carry genuinely different obligations.
            </p>
            <div className="space-y-2 pt-1">
              {(Object.keys(ORIGIN) as SystemOrigin[]).map((origin) => (
                <button
                  key={origin}
                  type="button"
                  onClick={() => set("origin", origin)}
                  className={cn(
                    "w-full space-y-1 rounded-lg border px-3.5 py-3 text-left transition-colors",
                    submission.origin === origin
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:bg-secondary/40",
                  )}
                >
                  <span className="block text-sm font-medium">{ORIGIN[origin].label}</span>
                  <span className="block text-[0.8125rem] leading-relaxed text-muted-foreground">
                    {ORIGIN[origin].blurb}
                  </span>
                </button>
              ))}
            </div>
            {errors.origin && <p className="text-[0.8125rem] text-critical">{errors.origin}</p>}
          </div>
        )}

        {step === 2 && submission.origin && (
          <>
            <div className="space-y-1 rounded-lg border border-border bg-secondary/20 p-3.5">
              <p className="text-sm font-medium">
                {QUESTION_SETS[submission.origin].label} questions
              </p>
              <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                {QUESTION_SETS[submission.origin].rationale}
              </p>
            </div>
            {QUESTION_SETS[submission.origin].fields.map((field) => (
              <FieldRenderer
                key={field.id}
                field={field as RenderableField}
                value={submission.originAnswers[field.id]}
                onChange={(v) => setOriginAnswer(field.id, v)}
                error={errors[field.id]}
              />
            ))}
          </>
        )}

        {step === 3 && (
          <>
            <FieldRenderer
              field={{
                id: "isGenAi",
                label: "Does it generate content — text, images, code, audio?",
                type: "boolean",
                required: true,
              }}
              value={submission.isGenAi}
              onChange={(v) => set("isGenAi", v as boolean)}
              error={errors.isGenAi}
            />
            <FieldRenderer
              field={{
                id: "dataCategories",
                label: "What data would it touch?",
                type: "multi_select",
                required: true,
                help: "Everything it could see, not only what it is meant to use.",
                options: DATA_OPTIONS,
              }}
              value={submission.dataCategories}
              onChange={(v) => set("dataCategories", v as DataCategory[])}
              error={errors.dataCategories}
            />
            <FieldRenderer
              field={{
                id: "facesCustomers",
                label: "Would customers see it, or its output?",
                type: "boolean",
                required: true,
              }}
              value={submission.facesCustomers}
              onChange={(v) => set("facesCustomers", v as boolean)}
              error={errors.facesCustomers}
            />
            <FieldRenderer
              field={{
                id: "informsDecisionsAboutPeople",
                label: "Would it inform decisions about individual people?",
                type: "boolean",
                required: true,
                help: "Hiring, pricing, credit, prioritisation, performance — anything where the outcome lands on a person.",
              }}
              value={submission.informsDecisionsAboutPeople}
              onChange={(v) => set("informsDecisionsAboutPeople", v as boolean)}
              error={errors.informsDecisionsAboutPeople}
            />
          </>
        )}

        {step === 4 && (
          <dl className="divide-y divide-border/60 border-y border-border">
            <Summary label="Name" value={submission.name} />
            <Summary label="Purpose" value={submission.description} />
            <Summary label="Business unit" value={submission.businessUnit} />
            <Summary label="Vendor" value={submission.vendor || "Built in house"} />
            <Summary
              label="Origin"
              value={submission.origin ? ORIGIN[submission.origin].label : "—"}
            />
            <Summary label="Generates content" value={submission.isGenAi ? "Yes" : "No"} />
            <Summary
              label="Data"
              value={submission.dataCategories.map((d) => DATA_CATEGORY[d].label).join(", ")}
            />
            <Summary label="Customer facing" value={submission.facesCustomers ? "Yes" : "No"} />
            <Summary
              label="Informs decisions about people"
              value={submission.informsDecisionsAboutPeople ? "Yes" : "No"}
            />
            {submission.origin &&
              QUESTION_SETS[submission.origin].fields.map((field) => (
                <Summary
                  key={field.id}
                  label={field.label}
                  value={
                    field.options?.find((o) => o.value === submission.originAnswers[field.id])
                      ?.label ?? String(submission.originAnswers[field.id] ?? "—")
                  }
                />
              ))}
          </dl>
        )}
      </div>

      {failure && (
        /* A submission the server refused has to say so. Without this the
         * spinner simply stops and the form looks like it worked. */
        <p className="mt-4 text-xs text-critical">{failure}</p>
      )}

      <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
        {step > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
            <ArrowLeft aria-hidden />
            Back
          </Button>
        )}
        <Button size="sm" className="ml-auto" onClick={advance}>
          {step === STEPS.length - 1 ? (
            <>
              <Send aria-hidden />
              Submit for triage
            </>
          ) : (
            <>
              Continue
              <ArrowRight aria-hidden />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-0.5 py-2">
      <dt className="w-56 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm">{value || "—"}</dd>
    </div>
  );
}
