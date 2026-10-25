"use client";

import { useCallback } from "react";
import type { z } from "zod";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ASSESSMENT_CREATE_SCHEMA,
  defaultAssessmentDue,
  SIGN_OFF_STAGES,
} from "@/lib/ams/assessment-create";
import { IMPACT_TEMPLATE } from "@/lib/ams/fixtures/assessment-template";
import type { AssessmentInstance } from "@/lib/ams/types";
import { useWorkspace } from "@/lib/ams/workspace-context";
import { ChoiceValue, CreateDialog, Field, useCreateForm } from "./create-dialog";

/**
 * Opening an impact assessment.
 *
 * The one create form that does not ask for any content, and that is the shape
 * of the thing: an assessment is a template answered inside the product, so what
 * this collects is the frame around the answers — which system it covers, by
 * when, and the three people who have to sign it.
 *
 * **The chain is asked for rather than assumed.** There is no "the governance
 * lead" a create route could look up: sponsors and reviewers are assignments
 * here, not database roles, and the demo tenant's constants are demo data. So
 * the form names all three, pre-filling the first from the system's own owner
 * because the register already knows who that is — and the schema refuses to let
 * one person both endorse and approve, because those are different judgements
 * about different things.
 *
 * **Nothing is signed on the way in.** The document opens with the owner's stage
 * current and the other two pending. A signature is an act somebody performs on
 * the assessment, never a state a record is created in.
 *
 * **Opened from a system's own profile, the system stops being a question.**
 * `systemId` fixes it, and the select becomes the name in plain text rather than
 * a dropdown defaulted to it. A dropdown there is a trap: somebody standing on
 * one system's Assessment tab could switch it, create, and land back on a tab
 * that still says the system was never assessed — the record went somewhere
 * else, and the screen that offered the button has no way of saying so.
 */

const SCHEMA = ASSESSMENT_CREATE_SCHEMA;

type Values = z.input<typeof SCHEMA>;

export function OpenAssessmentDialog({
  open,
  onOpenChange,
  onOpened,
  systemId: fixedSystemId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the record the server stored, once it is stored. */
  onOpened: (assessment: AssessmentInstance) => void;
  /**
   * The system this assessment covers, when the caller already knows it — a
   * system's own profile. Left out on the register, where choosing it is the
   * first question the form asks.
   */
  systemId?: string;
}) {
  const { people, systems, personById, systemById, getUseCasesForSystem } = useWorkspace();

  /* Read once per opening. `useCreateForm` calls this again each time the dialog
   * opens, so the due date is a month from now rather than a month from whenever
   * the register was last loaded. */
  const blank = useCallback(
    (): Values => ({
      systemId: fixedSystemId ?? "",
      useCaseId: "",
      dueAt: defaultAssessmentDue(new Date()),
      /* Pre-filled here for the same reason `chooseSystem` fills it below: the
       * register already knows who owns the system, so the owner stage starts
       * on the person the inventory names. Still editable — somebody else
       * sometimes writes it. */
      ownerId: fixedSystemId ? systemById(fixedSystemId)?.ownerId ?? "" : "",
      endorserId: "",
      approverId: "",
    }),
    [fixedSystemId, systemById],
  );

  const { values, errors, saving, failure, set, submit } = useCreateForm<
    Values,
    AssessmentInstance
  >({
    schema: SCHEMA,
    blank,
    open,
    endpoint: "/api/assessments/create",
    resultKey: "assessment",
    failureNote: "That assessment was not opened.",
    onCreated: (assessment) => {
      onOpened(assessment);
      onOpenChange(false);
    },
  });

  const useCases = values.systemId ? getUseCasesForSystem(values.systemId) : [];

  /**
   * Choosing the system fills in its owner and clears any use case.
   *
   * The owner is a suggestion, not a rule — an assessment is sometimes written
   * by somebody other than the person who owns the tool, and the select stays
   * editable. The use case has to clear: the ones on offer belong to the system
   * that was chosen before, and leaving a stale one selected would attach the
   * assessment to a use case of a different system.
   */
  function chooseSystem(systemId: string) {
    set("systemId", systemId);
    set("useCaseId", "");
    set("ownerId", systemId ? systemById(systemId)?.ownerId ?? "" : "");
  }

  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Open an impact assessment"
      description={`Against ${IMPACT_TEMPLATE.name} v${IMPACT_TEMPLATE.version}. The questions are answered on the assessment itself.`}
      saving={saving}
      failure={failure}
      submitLabel="Open assessment"
      savingLabel="Opening…"
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="System"
          error={errors.systemId}
          help={
            fixedSystemId
              ? "This assessment covers the system whose profile you opened it from."
              : "Which questions get asked depends on where this system came from."
          }
        >
          {fixedSystemId ? (
            /* Text rather than a disabled select. A greyed-out dropdown reads as
             * a permission refusal — something you are not allowed to change —
             * when this is simply not a question on this screen. */
            <p className="flex h-9 items-center text-sm">
              {systemById(fixedSystemId)?.name ?? fixedSystemId}
            </p>
          ) : (
            <Select
              value={values.systemId}
              onValueChange={(value) => chooseSystem(value ?? "")}
            >
              <SelectTrigger className="w-full font-normal">
                <SelectValue>
                  <ChoiceValue
                    chosen={values.systemId ? systemById(values.systemId)?.name : ""}
                    placeholder="Choose one"
                  />
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {systems.map((system) => (
                  <SelectItem key={system.id} value={system.id}>
                    {system.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>

        <Field
          label="Use case"
          error={errors.useCaseId}
          help={
            values.systemId && useCases.length === 0
              ? "This system has no use cases recorded, so the assessment covers it as a whole."
              : "Leave blank to assess the system as a whole."
          }
        >
          <Select
            value={values.useCaseId}
            onValueChange={(value) => set("useCaseId", value ?? "")}
            disabled={useCases.length === 0}
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
      </div>

      <Field
        label="Due"
        error={errors.dueAt}
        help="The register sorts by this, overdue first — that is the one an auditor asks for."
        htmlFor="oa-due"
      >
        <Input
          id="oa-due"
          type="date"
          value={values.dueAt}
          onChange={(e) => set("dueAt", e.target.value)}
          aria-invalid={Boolean(errors.dueAt)}
          className="sm:w-56"
        />
      </Field>

      <Field
        label="Sign-off chain"
        error={errors.ownerId ?? errors.endorserId ?? errors.approverId}
        help="Three stages, always in this order. They are separate because they are different judgements by different people."
      >
        <div className="space-y-2">
          {(
            [
              { key: "ownerId", stage: 0 },
              { key: "endorserId", stage: 1 },
              { key: "approverId", stage: 2 },
            ] as const
          ).map(({ key, stage }) => (
            <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-56 shrink-0 text-xs text-muted-foreground">
                {SIGN_OFF_STAGES[stage].label}
              </span>
              <Select
                value={values[key]}
                onValueChange={(value) => set(key, value ?? "")}
              >
                <SelectTrigger size="sm" className="min-w-56 flex-1 font-normal">
                  <SelectValue>
                    <ChoiceValue
                      chosen={values[key] ? personById(values[key]).name : ""}
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
            </div>
          ))}
        </div>
      </Field>

      <p className="text-[0.6875rem] text-muted-foreground">
        It opens unanswered, with the owner&rsquo;s stage current and nothing signed.
        {fixedSystemId
          ? " The owner stage starts on the person who owns the system; change it if somebody else is writing this one."
          : " Choosing the system fills in its owner; change it if somebody else is writing this one."}
      </p>
    </CreateDialog>
  );
}
