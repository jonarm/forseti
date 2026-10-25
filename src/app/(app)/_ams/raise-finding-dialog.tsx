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
import { Textarea } from "@/components/ui/textarea";
import {
  FINDING_SEVERITY,
  FINDING_SOURCE,
} from "@/lib/ams/fixtures/registers";
import { defaultDueDate, FINDING_CREATE_SCHEMA } from "@/lib/ams/finding-create";
import type { Finding } from "@/lib/ams/types";
import { useWorkspace } from "@/lib/ams/workspace-context";
import { ChoiceValue, CreateDialog, Field, useCreateForm } from "./create-dialog";

/**
 * Raising a finding.
 *
 * A finding is something that is already wrong, so this form is short on
 * purpose: what it is, how bad, where it came from, who owns it, and by when.
 * The half that takes work — root cause, corrective action, verification — is
 * deliberately absent, because none of it is known at the moment somebody
 * notices a problem, and a create form that asked for it would train people to
 * invent a root cause to get past the dialog.
 *
 * **Source is asked for and has no default.** The mix of sources is the most
 * useful number the register produces: a register where everything came from an
 * external auditor describes a management system that never finds its own
 * problems. That is only visible if source is a field somebody chose.
 *
 * **The dates are pre-filled and both are editable.** Raised defaults to today
 * because it usually is, and due to a month out because a finding with no
 * deadline is never overdue and therefore never appears in the one view anybody
 * checks.
 *
 * **Raised from a system's own profile, the system stops being a question.**
 * `systemId` fixes it and the select becomes the name in plain text. The
 * organisation-wide option goes with it: a finding raised from the Findings tab
 * of one system is about that system, and leaving the choice open would let it
 * be filed somewhere the tab that offered the button cannot show it.
 */

const SCHEMA = FINDING_CREATE_SCHEMA;

/* The two label maps, widened to plain string keys. The form holds whatever the
 * select last put in it — including "" before anybody chooses — and the schema
 * is what narrows that back to a severity and a source. */
const SEVERITY: Record<string, { label: string }> = FINDING_SEVERITY;
const SOURCE: Record<string, { label: string; blurb: string }> = FINDING_SOURCE;

type Values = z.input<typeof SCHEMA>;

export function RaiseFindingDialog({
  open,
  onOpenChange,
  onRaised,
  systemId: fixedSystemId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the row the server stored, once it is stored. */
  onRaised: (finding: Finding) => void;
  /**
   * The system this finding is against, when the caller already knows it — a
   * system's own profile. Left out on the register, where the finding might be
   * about the management system and choosing is part of the form.
   */
  systemId?: string;
}) {
  const { people, systems, personById, systemById } = useWorkspace();

  /* Read once per opening, and once for both dates so they cannot disagree with
   * each other. `useCreateForm` calls this again every time the dialog opens,
   * which is what keeps "raised today" meaning today rather than whenever the
   * register was last loaded. */
  const blank = useCallback((): Values => {
    const now = new Date();
    return {
      title: "",
      severity: "",
      source: "",
      raisedBy: "",
      raisedAt: now.toISOString().slice(0, 10),
      dueAt: defaultDueDate(now),
      ownerId: "",
      systemId: fixedSystemId ?? "",
      summary: "",
    };
  }, [fixedSystemId]);

  const { values, errors, saving, failure, set, submit } = useCreateForm<Values, Finding>({
    schema: SCHEMA,
    blank,
    open,
    endpoint: "/api/findings/create",
    resultKey: "finding",
    failureNote: "That finding was not raised.",
    onCreated: (finding) => {
      onRaised(finding);
      onOpenChange(false);
    },
  });

  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Raise a finding"
      description="Something that is already wrong. What put it right goes on the finding itself, once somebody knows."
      saving={saving}
      failure={failure}
      submitLabel="Raise finding"
      savingLabel="Raising…"
      onSubmit={submit}
    >
      <Field
        label="Finding"
        error={errors.title}
        help="What is wrong, in a phrase somebody can act on."
        htmlFor="rf-title"
      >
        <Input
          id="rf-title"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Access reviews not run for the last two quarters"
          aria-invalid={Boolean(errors.title)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Severity" error={errors.severity}>
          <Select
            value={values.severity}
            onValueChange={(value) => set("severity", value ?? "")}
          >
            <SelectTrigger className="w-full font-normal">
              <SelectValue>
                <ChoiceValue
                  chosen={values.severity ? SEVERITY[values.severity].label : ""}
                  placeholder="Choose one"
                />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.keys(SEVERITY).map((key) => (
                <SelectItem key={key} value={key}>
                  {SEVERITY[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Source"
          error={errors.source}
          help="How many we find ourselves is what a certification body reads."
        >
          <Select
            value={values.source}
            onValueChange={(value) => set("source", value ?? "")}
          >
            <SelectTrigger className="w-full font-normal">
              <SelectValue>
                <ChoiceValue
                  chosen={values.source ? SOURCE[values.source].label : ""}
                  placeholder="Choose one"
                />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.keys(SOURCE).map((key) => (
                <SelectItem key={key} value={key}>
                  {SOURCE[key].label} — {SOURCE[key].blurb}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Raised by"
          error={errors.raisedBy}
          help="The audit reference or the person — what you would cite."
          htmlFor="rf-raised-by"
        >
          <Input
            id="rf-raised-by"
            value={values.raisedBy}
            onChange={(e) => set("raisedBy", e.target.value)}
            placeholder="IA-2026-04"
            aria-invalid={Boolean(errors.raisedBy)}
          />
        </Field>

        <Field
          label="System"
          error={errors.systemId}
          help={
            fixedSystemId
              ? "This finding is against the system whose profile you raised it from."
              : "Leave as organisation-wide if it is about the management system."
          }
        >
          {fixedSystemId ? (
            <p className="flex h-9 items-center text-sm">
              {systemById(fixedSystemId)?.name ?? fixedSystemId}
            </p>
          ) : (
            <Select
              value={values.systemId}
              onValueChange={(value) => set("systemId", value ?? "")}
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
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Raised" error={errors.raisedAt} htmlFor="rf-raised-at">
          <Input
            id="rf-raised-at"
            type="date"
            value={values.raisedAt}
            onChange={(e) => set("raisedAt", e.target.value)}
            aria-invalid={Boolean(errors.raisedAt)}
          />
        </Field>

        <Field label="Due" error={errors.dueAt} htmlFor="rf-due-at">
          <Input
            id="rf-due-at"
            type="date"
            value={values.dueAt}
            onChange={(e) => set("dueAt", e.target.value)}
            aria-invalid={Boolean(errors.dueAt)}
          />
        </Field>

        <Field label="Owner" error={errors.ownerId} help="Who fixes it.">
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
        label="What happened"
        error={errors.summary}
        help="One or two sentences. This is what a reviewer reads first."
        htmlFor="rf-summary"
      >
        <Textarea
          id="rf-summary"
          rows={3}
          value={values.summary}
          onChange={(e) => set("summary", e.target.value)}
          placeholder="Quarterly access reviews for the three systems holding customer content have not been run since Q4; the standing calendar entry was deleted when the owner changed."
          aria-invalid={Boolean(errors.summary)}
        />
      </Field>

      <p className="text-[0.6875rem] text-muted-foreground">
        It will be raised as open. Closing it needs a root cause, a corrective
        action and a dated verification by somebody other than the owner — all of
        which are recorded on the finding itself.
      </p>
    </CreateDialog>
  );
}
