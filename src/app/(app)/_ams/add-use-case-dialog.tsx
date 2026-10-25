"use client";

import { useCallback } from "react";
import type { z } from "zod";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DATA_CATEGORY, OVERSIGHT, RISK_TIER, USE_CASE_STATUS } from "@/lib/ams/labels";
import { TONE_TEXT } from "@/lib/ams/tone";
import { USE_CASE_CREATE_SCHEMA } from "@/lib/ams/use-case-create";
import type {
  AIUseCase,
  DataCategory,
  OversightLevel,
  RiskTier,
  UseCaseStatus,
} from "@/lib/ams/types";
import { useWorkspace } from "@/lib/ams/workspace-context";
import { ChoiceValue, CreateDialog, Field, useCreateForm } from "./create-dialog";

/**
 * Recording what a tool is actually being used for.
 *
 * **The two questions are the form.** Everything else here is description; those
 * two checkboxes are what decide how much scrutiny this use gets — the second
 * pulls a whole fairness and adverse-impact section into any assessment opened
 * against it. So they are not buried among the fields: they sit together, worded
 * as questions rather than as attribute names, each with the consequence written
 * underneath. Somebody ticking "informs decisions about people" should know what
 * they have just committed to before they save, not discover it at the next
 * assessment.
 *
 * **The tier is asked for and never defaulted.** A form that pre-selected
 * minimal would produce a register where the tier column means "nobody chose",
 * and the whole argument for a use case having its own tier is that a
 * limited-risk system can carry a high-risk use.
 *
 * **Added from a system's own profile, that system is pre-selected and cannot
 * be removed.** It stays a list rather than becoming plain text, because a use
 * case can reach several systems and the profile is only asserting one of them —
 * the same call the risk dialog makes, and for a stronger reason: a use case has no
 * organisation-wide form to be filed away into, so a select there could only
 * ever move it somewhere the tab that offered the button cannot show it.
 */

const SCHEMA = USE_CASE_CREATE_SCHEMA;

type Values = z.input<typeof SCHEMA>;

/**
 * A label out of a vocabulary the form is still holding as a string.
 *
 * `labels.ts` keys its maps by the real unions — `Record<RiskTier, Vocab>` — and
 * that is right: it is what stops a screen rendering a tier that does not exist.
 * A form in progress holds `""` until somebody chooses, so the narrowing happens
 * here rather than by loosening the map for every other reader.
 */
function labelOf<K extends string>(
  vocab: Record<K, { label: string }>,
  key: string,
): string {
  return key ? (vocab[key as K]?.label ?? "") : "";
}

const EMPTY: Values = {
  name: "",
  systemIds: [],
  description: "",
  businessUnit: "",
  ownerId: "",
  riskTier: "",
  oversightLevel: "",
  oversightSummary: "",
  status: "",
  facesCustomers: false,
  informsDecisionsAboutPeople: false,
  dataCategories: [],
  approxUsers: 0,
};

export function AddUseCaseDialog({
  open,
  onOpenChange,
  onAdded,
  systemId: fixedSystemId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the row the server stored, once it is stored. */
  onAdded: (useCase: AIUseCase) => void;
  /**
   * The system this use case belongs to, when the caller already knows it — a
   * system's own profile. Left out on the register, where choosing is part of
   * the form.
   */
  systemId?: string;
}) {
  const { people, systems, businessUnits, personById } = useWorkspace();

  /* Spread rather than mutated: `EMPTY` is a module constant shared by every
   * dialog this component renders, and writing the fixed system into it would
   * leak one profile's system into the register's own blank form. */
  const blank = useCallback(
    (): Values => ({ ...EMPTY, systemIds: fixedSystemId ? [fixedSystemId] : [] }),
    [fixedSystemId],
  );

  const { values, errors, saving, failure, set, submit } = useCreateForm<
    Values,
    AIUseCase
  >({
    schema: SCHEMA,
    blank,
    open,
    endpoint: "/api/use-cases/create",
    resultKey: "useCase",
    failureNote: "That use case was not added.",
    onCreated: (useCase) => {
      onAdded(useCase);
      onOpenChange(false);
    },
  });

  const toggleCategory = (category: DataCategory) => {
    const held = values.dataCategories as DataCategory[];
    set(
      "dataCategories",
      held.includes(category)
        ? held.filter((c) => c !== category)
        : [...held, category],
    );
  };

  /* The pairing the register exists to surface, said before the row is saved
   * rather than at the next review. */
  const unwatched =
    values.oversightLevel === "none" &&
    (values.riskTier === "high" || values.riskTier === "unacceptable");

  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a use case"
      description="A job this tool is actually doing, its own risk tier, and who is watching the output."
      saving={saving}
      failure={failure}
      submitLabel="Add use case"
      savingLabel="Adding…"
      onSubmit={submit}
    >
      <Field
        label="Use case"
        error={errors.name}
        help="The job, not the tool. “Summarising customer support calls”, not “Otter.ai”."
        htmlFor="auc-name"
      >
        <Input
          id="auc-name"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Summarising customer support calls"
          aria-invalid={Boolean(errors.name)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Systems"
          error={errors.systemIds}
          help={
            fixedSystemId
              ? "The profile you added it from is already ticked. Add others if the same job is done in more than one place."
              : "Every tool that does this job. Most use cases have one; some have several."
          }
        >
          {/* A list of tick boxes rather than a multi-select: there are fifteen
            * systems, the names are short, and a control that hides its options
            * behind a click is a control somebody ticks one thing in. The fixed
            * system is checked and disabled — the profile you came from is an
            * assertion, not a suggestion. */}
          <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
            {systems.map((system) => {
              const fixed = system.id === fixedSystemId;
              const checked = values.systemIds.includes(system.id);
              return (
                <div key={system.id} className="flex items-center gap-2.5">
                  <Checkbox
                    id={`uc-system-${system.id}`}
                    checked={checked}
                    disabled={fixed}
                    onCheckedChange={(next) =>
                      set(
                        "systemIds",
                        next === true
                          ? [...values.systemIds, system.id]
                          : values.systemIds.filter((id) => id !== system.id),
                      )
                    }
                  />
                  <Label
                    htmlFor={`uc-system-${system.id}`}
                    className={cn(
                      "text-[0.8125rem] font-normal",
                      fixed ? "cursor-not-allowed" : "cursor-pointer",
                    )}
                  >
                    {system.name}
                  </Label>
                </div>
              );
            })}
          </div>
        </Field>

        <Field label="Owner" error={errors.ownerId} help="Who is answerable for this use.">
          <Select
            value={values.ownerId}
            onValueChange={(value) => set("ownerId", value ?? "")}
          >
            <SelectTrigger className="w-full font-normal">
              <SelectValue>
                <ChoiceValue
                  chosen={values.ownerId ? personById(values.ownerId).name : ""}
                  placeholder="Choose one"
                />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name} — {person.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field
        label="What it does"
        error={errors.description}
        help="A sentence somebody outside the team would understand."
        htmlFor="auc-description"
      >
        <Textarea
          id="auc-description"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          rows={3}
          placeholder="Transcribes and summarises recorded support calls for the account team."
          aria-invalid={Boolean(errors.description)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Business unit"
          error={errors.businessUnit}
          help="Who uses it."
          htmlFor="auc-unit"
        >
          <Input
            id="auc-unit"
            value={values.businessUnit}
            onChange={(e) => set("businessUnit", e.target.value)}
            list="auc-units"
            placeholder="Sales"
          />
          {/* The units already in use, offered rather than enforced — a new team
            * adopting a tool is exactly when this register gets a row. */}
          <datalist id="auc-units">
            {businessUnits.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
        </Field>

        <Field label="Risk tier" error={errors.riskTier} help="This use, not the system.">
          <Select
            value={values.riskTier}
            onValueChange={(value) => set("riskTier", value ?? "")}
          >
            <SelectTrigger className="w-full font-normal">
              <SelectValue>
                <ChoiceValue
                  chosen={labelOf(RISK_TIER, values.riskTier)}
                  placeholder="Choose one"
                />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RISK_TIER) as RiskTier[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {RISK_TIER[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Status" error={errors.status} help="Where it is in its life.">
          <Select
            value={values.status}
            onValueChange={(value) => set("status", value ?? "")}
          >
            <SelectTrigger className="w-full font-normal">
              <SelectValue>
                <ChoiceValue
                  chosen={labelOf(USE_CASE_STATUS, values.status)}
                  placeholder="Choose one"
                />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(USE_CASE_STATUS) as UseCaseStatus[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {USE_CASE_STATUS[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Human oversight" error={errors.oversightLevel}>
        <Select
          value={values.oversightLevel}
          onValueChange={(value) => set("oversightLevel", value ?? "")}
        >
          <SelectTrigger className="w-full font-normal">
            <SelectValue>
              <ChoiceValue
                chosen={labelOf(OVERSIGHT, values.oversightLevel)}
                placeholder="Choose one"
              />
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(OVERSIGHT) as OversightLevel[]).map((key) => (
              <SelectItem key={key} value={key}>
                {OVERSIGHT[key].label} — {OVERSIGHT[key].blurb}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {unwatched && (
          <p className={cn("text-[0.6875rem]", TONE_TEXT.critical)}>
            A use case at this tier with nobody watching the output is a finding.
            It can be saved — the register is for what is true — but expect it at
            the top of the list.
          </p>
        )}
      </Field>

      <Field
        label="How the oversight works"
        error={errors.oversightSummary}
        help="What the person actually does, not that there is a policy."
        htmlFor="auc-oversight"
      >
        <Textarea
          id="auc-oversight"
          value={values.oversightSummary}
          onChange={(e) => set("oversightSummary", e.target.value)}
          rows={2}
          placeholder="The account manager reads every summary before it reaches the CRM."
          aria-invalid={Boolean(errors.oversightSummary)}
        />
      </Field>

      {/*
       * The two questions, together and worded as questions. They carry most of
       * the regulatory weight and they are the two things the person filling
       * this in actually knows — so the consequence is written under each rather
       * than left to be discovered at the next assessment.
       */}
      <Field label="The two questions">
        <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-3">
          <Question
            id="auc-customers"
            checked={values.facesCustomers}
            onChange={(next) => set("facesCustomers", next)}
            question="Does it face customers?"
            note="Determines whether a wrong output reaches someone outside the organisation."
          />
          <Question
            id="auc-decisions"
            checked={values.informsDecisionsAboutPeople}
            onChange={(next) => set("informsDecisionsAboutPeople", next)}
            question="Does it inform decisions about people?"
            note="A yes pulls a whole fairness and adverse-impact section into the assessment."
          />
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Data touched"
          error={errors.dataCategories}
          help="What goes into it. Leave empty if nothing here fits."
        >
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {(Object.keys(DATA_CATEGORY) as DataCategory[]).map((category) => (
              <label
                key={category}
                className="flex cursor-pointer items-center gap-1.5 text-[0.8125rem]"
              >
                <Checkbox
                  checked={(values.dataCategories as DataCategory[]).includes(category)}
                  onCheckedChange={() => toggleCategory(category)}
                />
                {DATA_CATEGORY[category].label}
              </label>
            ))}
          </div>
        </Field>

        <Field
          label="Users"
          error={errors.approxUsers}
          help="Roughly how many people use it. Zero if it is not in use yet."
          htmlFor="auc-users"
        >
          <Input
            id="auc-users"
            type="number"
            min={0}
            value={String(values.approxUsers)}
            onChange={(e) => set("approxUsers", Number(e.target.value) || 0)}
            aria-invalid={Boolean(errors.approxUsers)}
          />
        </Field>
      </div>
    </CreateDialog>
  );
}

/** One of the two questions: the tick, the question, and what a yes costs. */
function Question({
  id,
  checked,
  onChange,
  question,
  note,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  question: string;
  note: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <div className="space-y-0.5">
        <Label htmlFor={id} className="cursor-pointer text-[0.8125rem] font-medium">
          {question}
        </Label>
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">{note}</p>
      </div>
    </div>
  );
}
