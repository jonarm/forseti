"use client";

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
import { ORIGIN } from "@/lib/ams/labels";
import { SYSTEM_CREATE_SCHEMA } from "@/lib/ams/system-create";
import type { AISystem, SystemOrigin } from "@/lib/ams/types";
import { useWorkspace } from "@/lib/ams/workspace-context";
import { ChoiceValue, CreateDialog, Field, useCreateForm } from "./create-dialog";

/**
 * Registering a system you already know about.
 *
 * Deliberately not the intake wizard. Intake is a *requester* proposing
 * something and being triaged; this is a governance lead recording a tool the
 * organisation is already running — usually one they just found in an expense
 * report. Same object at the end, two different jobs, and collapsing them would
 * force the person who owns the register to pretend to be a requester.
 *
 * The form asks the eight things needed to make the row useful in the inventory
 * and nothing else. Everything deeper is the assessment's job, and asking for it
 * here is how a register ends up empty.
 *
 * **The shape is `SYSTEM_CREATE_SCHEMA`, shared with the route that stores it.**
 * A copy here would drift, and it would drift quietly — the form accepting what
 * the route refuses, or asking for less than the route writes.
 *
 * **No optimistic row.** The dialog reports what the server saved and the table
 * picks the row up from the next server render, for the reason `use-system-patch`
 * gives: an inventory that shows a system it did not manage to save is the one
 * failure mode worth a round trip, because the whole argument for the register
 * is that it is what is true.
 */

const SCHEMA = SYSTEM_CREATE_SCHEMA;

type Values = z.input<typeof SCHEMA>;

const EMPTY: Values = {
  name: "",
  vendor: "",
  origin: "" as SystemOrigin,
  isGenAi: "" as "yes" | "no",
  businessUnit: "",
  ownerId: "",
  purpose: "",
};

export function RegisterSystemDialog({
  open,
  onOpenChange,
  onRegistered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the row the server stored, once it is stored. */
  onRegistered: (system: AISystem) => void;
}) {
  const { people, businessUnits, personById } = useWorkspace();
  const { values, errors, saving, failure, set, submit } = useCreateForm<Values, AISystem>({
    schema: SCHEMA,
    blank: () => EMPTY,
    open,
    endpoint: "/api/systems",
    resultKey: "system",
    failureNote: "That system was not registered.",
    onCreated: (system) => {
      onRegistered(system);
      onOpenChange(false);
    },
  });

  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Register an AI system"
      description="For a system already in use. To propose something new, send it through intake so it gets triaged first."
      saving={saving}
      failure={failure}
      submitLabel="Register system"
      savingLabel="Registering…"
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="System name" error={errors.name} htmlFor="rs-name">
          <Input
            id="rs-name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Convene Notetaker"
            aria-invalid={Boolean(errors.name)}
          />
        </Field>

        <Field label="Vendor" error={errors.vendor} htmlFor="rs-vendor">
          <Input
            id="rs-vendor"
            value={values.vendor}
            onChange={(e) => set("vendor", e.target.value)}
            placeholder="Convene Labs"
            aria-invalid={Boolean(errors.vendor)}
          />
        </Field>
      </div>

      <Field
        label="Origin"
        error={errors.origin}
        help="This selects the question set the system answers from here on."
      >
        <RadioGroup
          value={values.origin}
          onValueChange={(value) => set("origin", value as SystemOrigin)}
          className="grid gap-2 sm:grid-cols-3"
        >
          {(Object.keys(ORIGIN) as SystemOrigin[]).map((origin) => (
            <Label
              key={origin}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors",
                values.origin === origin
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:bg-secondary/40",
              )}
            >
              <RadioGroupItem value={origin} className="mt-0.5" />
              <span className="space-y-1">
                <span className="block text-xs font-medium">
                  {ORIGIN[origin].label}
                </span>
                <span className="block text-[0.6875rem] leading-snug text-muted-foreground">
                  {ORIGIN[origin].blurb}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Generates content" error={errors.isGenAi}>
          <RadioGroup
            value={values.isGenAi}
            onValueChange={(value) => set("isGenAi", value as "yes" | "no")}
            className="flex gap-4 pt-1.5"
          >
            <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
              <RadioGroupItem value="yes" /> Yes
            </Label>
            <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
              <RadioGroupItem value="no" /> No
            </Label>
          </RadioGroup>
        </Field>

        <Field label="Business unit" error={errors.businessUnit}>
          <Select
            value={values.businessUnit}
            onValueChange={(value) => set("businessUnit", value ?? "")}
          >
            <SelectTrigger className="w-full font-normal">
              <SelectValue>
                <ChoiceValue chosen={values.businessUnit} placeholder="Choose one" />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {businessUnits.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {unit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Owner" error={errors.ownerId}>
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
        label="What it is used for"
        error={errors.purpose}
        help="One or two sentences. This is what a reviewer reads first."
        htmlFor="rs-purpose"
      >
        <Textarea
          id="rs-purpose"
          rows={3}
          value={values.purpose}
          onChange={(e) => set("purpose", e.target.value)}
          placeholder="Joins external calls to record, transcribe and summarise them for the marketing team."
          aria-invalid={Boolean(errors.purpose)}
        />
      </Field>
    </CreateDialog>
  );
}
