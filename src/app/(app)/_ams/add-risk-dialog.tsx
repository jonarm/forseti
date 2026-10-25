"use client";

import { useCallback } from "react";
import type { z } from "zod";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { riskScore } from "@/lib/ams/fixtures/registers";
import { RISK_CREATE_SCHEMA } from "@/lib/ams/risk-create";
import { riskBand, TREATMENT } from "@/lib/ams/risk-scale";
import { TONE_TEXT } from "@/lib/ams/tone";
import type { Risk } from "@/lib/ams/types";
import { useWorkspace } from "@/lib/ams/workspace-context";
import { ChoiceValue, CreateDialog, Field, useCreateForm } from "./create-dialog";

/**
 * Adding a risk by hand.
 *
 * The counterpart to the importer, and the one people actually use: a risk log
 * arrives as a spreadsheet once, and after that risks turn up one at a time, in
 * a meeting, from somebody who has just realised something.
 *
 * **It asks for both ratings, and it shows both scores while you set them.** The
 * four numbers are the whole point of a risk register and they are also the part
 * people fill in carelessly — so the form renders the product as it changes,
 * with the band's colour, exactly as the register will. Somebody who rates
 * inherent 5×5 and residual 5×5 sees two identical severe scores and a note
 * saying the treatment has not moved the number, which is a conversation worth
 * having before the row is saved rather than at the next review.
 *
 * **Nobody accepts anything here.** The form has no acceptance field: accepting
 * a residual risk names somebody senior enough to carry it and demands a written
 * reason, which is a separate act on the risk's own page. `risk-create.ts` has
 * the full argument.
 *
 * **Raised from a system's own profile, the system stops being a question.**
 * `systemId` fixes it and the select becomes the name in plain text. The
 * organisation-wide option goes with it: a risk raised from the Risks tab of one
 * system is about that system, and leaving the choice open would let it be
 * filed somewhere the tab that offered the button cannot show it.
 */

const SCHEMA = RISK_CREATE_SCHEMA;

type Values = z.input<typeof SCHEMA>;

const EMPTY: Values = {
  title: "",
  systemId: "",
  useCaseId: "",
  ownerId: "",
  treatment: "",
  treatmentSummary: "",
  inherentLikelihood: 0,
  inherentImpact: 0,
  residualLikelihood: 0,
  residualImpact: 0,
};

/** The scale, as the register renders it. Both ends are named so a 3 is not a
 *  different 3 to different people. */
const SCALE = [1, 2, 3, 4, 5];

export function AddRiskDialog({
  open,
  onOpenChange,
  onAdded,
  systemId: fixedSystemId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the row the server stored, once it is stored. */
  onAdded: (risk: Risk) => void;
  /**
   * The system this risk is against, when the caller already knows it — a
   * system's own profile. Left out on the register, where the risk might be
   * organisation-wide and choosing is part of the form.
   */
  systemId?: string;
}) {
  const { people, systems, personById, systemById, getUseCasesForSystem } =
    useWorkspace();

  /* Spread rather than mutated: `EMPTY` is a module constant shared by every
   * dialog this component renders, and writing the fixed system into it would
   * leak one profile's system into the register's own blank form. */
  const blank = useCallback(
    (): Values => ({ ...EMPTY, systemId: fixedSystemId ?? "" }),
    [fixedSystemId],
  );

  const { values, errors, saving, failure, set, submit } = useCreateForm<Values, Risk>({
    schema: SCHEMA,
    blank,
    open,
    endpoint: "/api/risks/create",
    resultKey: "risk",
    failureNote: "That risk was not added.",
    onCreated: (risk) => {
      onAdded(risk);
      onOpenChange(false);
    },
  });

  /* Scoped to the chosen system, so the picker cannot offer a pair the route
   * would refuse. Empty until a system is chosen, which is what disables it. */
  const useCases = values.systemId ? getUseCasesForSystem(values.systemId) : [];

  const inherent = riskScore(values.inherentLikelihood, values.inherentImpact);
  const residual = riskScore(values.residualLikelihood, values.residualImpact);
  /* Both rated, and the treatment has bought nothing. Worth saying now — the
   * register has a lens for exactly this and it is the least-read one. */
  const treatmentIdle = inherent > 0 && residual >= inherent;

  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a risk"
      description="Something that could go wrong, what is being done about it, and what is left afterwards."
      saving={saving}
      failure={failure}
      submitLabel="Add risk"
      savingLabel="Adding…"
      onSubmit={submit}
    >
      <Field
        label="Risk"
        error={errors.title}
        help="What could go wrong, not what control is missing."
        htmlFor="ar-title"
      >
        <Input
          id="ar-title"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Vendor trains on our customer data"
          aria-invalid={Boolean(errors.title)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="System"
          error={errors.systemId}
          help={
            fixedSystemId
              ? "This risk is against the system whose profile you raised it from."
              : "Leave as organisation-wide if it is about our use of AI generally."
          }
        >
          {fixedSystemId ? (
            <p className="flex h-9 items-center text-sm">
              {systemById(fixedSystemId)?.name ?? fixedSystemId}
            </p>
          ) : (
            <Select
              value={values.systemId}
              onValueChange={(value) => {
                /* Clearing the use case with the system it belonged to: a
                 * stale one left selected would file the risk against a purpose
                 * the new system does not implement, which the route refuses —
                 * after the person has filled in the rest of the form. */
                set("systemId", value ?? "");
                set("useCaseId", "");
              }}
            >
              <SelectTrigger className="w-full font-normal">
                <SelectValue>
                  <ChoiceValue
                    chosen={
                      values.systemId
                        ? systems.find((s) => s.id === values.systemId)?.name
                        : ""
                    }
                    placeholder="Organisation-wide"
                  />
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Organisation-wide</SelectItem>
                {systems.map((system) => (
                  <SelectItem key={system.id} value={system.id}>
                    {system.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>

        {/* Offered only once a system is chosen, and scoped to that system's
          * purposes. A risk about a use case is a risk about that use case *on
          * a system* — the route refuses the pair otherwise — and a picker
          * listing every purpose in the organisation would invite exactly the
          * mismatch it refuses. */}
        <Field
          label="Use case"
          error={errors.useCaseId}
          help={
            values.systemId
              ? "Leave empty if the risk is about the system however it is used."
              : "Choose a system first."
          }
        >
          <Select
            value={values.useCaseId}
            onValueChange={(value) => set("useCaseId", value ?? "")}
            disabled={!values.systemId || useCases.length === 0}
          >
            <SelectTrigger className="w-full font-normal">
              <SelectValue>
                <ChoiceValue
                  chosen={
                    values.useCaseId
                      ? useCases.find((u) => u.id === values.useCaseId)?.name
                      : ""
                  }
                  placeholder="The system as a whole"
                />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">The system as a whole</SelectItem>
              {useCases.map((useCase) => (
                <SelectItem key={useCase.id} value={useCase.id}>
                  {useCase.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Owner" error={errors.ownerId} help="Who runs the treatment.">
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
        label="Before treatment"
        error={errors.inherentLikelihood ?? errors.inherentImpact}
        help="What it would be if nobody did anything about it."
      >
        <Ratings
          likelihood={values.inherentLikelihood}
          impact={values.inherentImpact}
          onLikelihood={(n) => set("inherentLikelihood", n)}
          onImpact={(n) => set("inherentImpact", n)}
        />
      </Field>

      <Field label="Treatment" error={errors.treatment}>
        <Select
          value={values.treatment}
          onValueChange={(value) => set("treatment", value ?? "")}
        >
          <SelectTrigger className="w-full font-normal">
            <SelectValue>
              <ChoiceValue
                chosen={values.treatment ? TREATMENT[values.treatment].label : ""}
                placeholder="Choose one"
              />
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.keys(TREATMENT).map((key) => (
              <SelectItem key={key} value={key}>
                {TREATMENT[key].label} — {TREATMENT[key].blurb}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="What is being done"
        error={errors.treatmentSummary}
        help="A sentence somebody could check against reality."
        htmlFor="ar-treatment"
      >
        <Textarea
          id="ar-treatment"
          rows={2}
          value={values.treatmentSummary}
          onChange={(e) => set("treatmentSummary", e.target.value)}
          placeholder="Contract amended; data processing agreement signed and training opt-out confirmed in writing."
          aria-invalid={Boolean(errors.treatmentSummary)}
        />
      </Field>

      <Field
        label="After treatment"
        error={errors.residualLikelihood ?? errors.residualImpact}
        help="What we are actually carrying. This is what the register sorts on."
      >
        <Ratings
          likelihood={values.residualLikelihood}
          impact={values.residualImpact}
          onLikelihood={(n) => set("residualLikelihood", n)}
          onImpact={(n) => set("residualImpact", n)}
        />
      </Field>

      {inherent > 0 && residual > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
          <Score label="Inherent" value={inherent} muted />
          <Score label="Residual" value={residual} />
          {treatmentIdle && (
            <p className="text-[0.6875rem] text-warn">
              The treatment has not moved the number. That is allowed — the
              register has a lens for it — but it is worth being deliberate about.
            </p>
          )}
        </div>
      )}

      <p className="text-[0.6875rem] text-muted-foreground">
        It will be added as open, with nobody recorded as having accepted the
        residue. Accepting it is a separate decision, made on the risk itself,
        and it asks for a reason.
      </p>
    </CreateDialog>
  );
}

/** Likelihood and impact side by side, because they are rated together. */
function Ratings({
  likelihood,
  impact,
  onLikelihood,
  onImpact,
}: {
  likelihood: number;
  impact: number;
  onLikelihood: (n: number) => void;
  onImpact: (n: number) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Scale label="Likelihood" value={likelihood} onChange={onLikelihood} />
      <Scale label="Impact" value={impact} onChange={onImpact} />
    </div>
  );
}

/**
 * One 1–5 rating, as five boxes rather than a dropdown.
 *
 * A dropdown hides four of the five options and makes rating four numbers a
 * sixteen-click job. The whole scale is five characters wide; showing it costs
 * nothing and makes the two rows comparable at a glance, which is the thing
 * being judged.
 *
 * **A real radio group underneath.** The boxes look like buttons and behave like
 * one choice, and `RadioGroup` is what makes those two agree: one tab stop,
 * arrow keys between the options, and the checked state announced. Five
 * `<button>`s wearing `role="radio"` would announce a group and then hand a
 * screen-reader user five separate tab stops with no arrow-key movement — a
 * control that lies about what it is. The radio itself is `sr-only`; the label
 * around it is the box, and it takes the focus ring through `has-[:focus-visible]`
 * so keyboard focus is still visible.
 */
function Scale({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[0.6875rem] text-muted-foreground">{label}</span>
      <RadioGroup
        /* `null` rather than 0 before anybody chooses: 0 is not on the scale,
         * and passing it would have the group looking for an option to check. */
        value={value || null}
        onValueChange={(next) => onChange(Number(next))}
        aria-label={label}
        className="flex gap-1"
      >
        {SCALE.map((n) => (
          <Label
            key={n}
            className={cn(
              "flex h-8 flex-1 cursor-pointer items-center justify-center rounded-md border text-xs tabular font-normal transition-colors",
              "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              value === n
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-secondary/60",
            )}
          >
            <RadioGroupItem value={n} className="sr-only" />
            {n}
          </Label>
        ))}
      </RadioGroup>
    </div>
  );
}

/** The product, banded exactly as the register bands it. */
function Score({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  const band = riskBand(value);
  return (
    <p className="text-xs text-muted-foreground">
      {label}{" "}
      <span className={cn("tabular", muted ? "text-muted-foreground" : TONE_TEXT[band.tone])}>
        {value} of 25
      </span>{" "}
      <span className="text-muted-foreground/60">— {band.label}</span>
    </p>
  );
}
