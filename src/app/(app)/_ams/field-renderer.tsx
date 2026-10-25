"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { FieldOption, FieldType } from "@/lib/ams/types";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * One field, rendered from its config.
 *
 * The intake wizard's origin question sets and the impact assessment's template
 * are the same problem — a typed description of a question, rendered without any
 * screen knowing what the question is. So they share this renderer, and the
 * switch below is on `field.type` and nothing else. Grep this file for any
 * fixture field id and you should find none; that is the property that makes
 * screen 5's "config-driven" claim true rather than decorative.
 *
 * `single_select` deliberately renders as radios below five options and a
 * dropdown above it. A four-way choice where every option carries a line of
 * help is a decision someone should be able to read at a glance, and burying it
 * behind a click is how questionnaires get answered badly.
 */
export interface RenderableField {
  id: string;
  label: string;
  type: FieldType;
  help?: string;
  placeholder?: string;
  options?: FieldOption[];
  required?: boolean;
  columns?: { id: string; label: string; type: FieldType }[];
}

export function FieldRenderer({
  field,
  value,
  onChange,
  error,
}: {
  field: RenderableField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}) {
  const id = `f-${field.id}`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {field.label}
        {field.required && <span className="ml-1 text-muted-foreground/60">*</span>}
      </Label>
      {field.help && (
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{field.help}</p>
      )}

      <Control field={field} id={id} value={value} onChange={onChange} invalid={Boolean(error)} />

      {error && <p className="text-[0.8125rem] text-critical">{error}</p>}
    </div>
  );
}

function Control({
  field,
  id,
  value,
  onChange,
  invalid,
}: {
  field: RenderableField;
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  invalid: boolean;
}) {
  const { people, personById } = useWorkspace();
  switch (field.type) {
    case "long_text":
      return (
        <Textarea
          id={id}
          rows={3}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        />
      );

    case "number":
      return (
        <Input
          id={id}
          type="number"
          value={(value as number | undefined) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          aria-invalid={invalid}
          className="w-40"
        />
      );

    case "date":
      return (
        <Input
          id={id}
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          className="w-48"
        />
      );

    case "boolean":
      return (
        <RadioGroup
          value={value === true ? "yes" : value === false ? "no" : ""}
          onValueChange={(next) => onChange(next === "yes")}
          className="flex gap-5 pt-1"
        >
          <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
            <RadioGroupItem value="yes" /> Yes
          </Label>
          <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
            <RadioGroupItem value="no" /> No
          </Label>
        </RadioGroup>
      );

    case "single_select": {
      const options = field.options ?? [];
      // Few options, or options that carry help text, are worth showing openly.
      const asRadios = options.length <= 5 || options.some((o) => o.help);
      if (asRadios) {
        return (
          <RadioGroup
            value={(value as string) ?? ""}
            onValueChange={(next) => onChange(next)}
            className="space-y-1.5 pt-1"
          >
            {options.map((option) => (
              <Label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors",
                  value === option.value
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:bg-secondary/40",
                )}
              >
                <RadioGroupItem value={option.value} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block text-sm font-normal">{option.label}</span>
                  {option.help && (
                    <span className="block text-[0.75rem] leading-snug text-muted-foreground">
                      {option.help}
                    </span>
                  )}
                </span>
              </Label>
            ))}
          </RadioGroup>
        );
      }
      return (
        <Select value={(value as string) ?? ""} onValueChange={(next) => onChange(next ?? "")}>
          <SelectTrigger className="w-full font-normal" aria-invalid={invalid}>
            <SelectValue>
              {options.find((o) => o.value === value)?.label ?? (
                <span className="text-muted-foreground/60">Choose one</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case "multi_select": {
      const selected = (value as string[]) ?? [];
      return (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {(field.options ?? []).map((option) => {
            const on = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  onChange(
                    on
                      ? selected.filter((v) => v !== option.value)
                      : [...selected, option.value],
                  )
                }
                aria-pressed={on}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[0.8125rem] transition-colors",
                  on
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-secondary/50",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      );
    }

    case "person":
      return (
        <Select value={(value as string) ?? ""} onValueChange={(next) => onChange(next ?? "")}>
          <SelectTrigger className="w-full font-normal" aria-invalid={invalid}>
            <SelectValue>
              {value ? (
                personById(value as string).name
              ) : (
                <span className="text-muted-foreground/60">Choose someone</span>
              )}
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
      );

    case "scale":
      return (
        <div className="flex gap-1.5 pt-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-pressed={value === n}
              className={cn(
                "size-8 rounded-md border text-sm tabular transition-colors",
                value === n
                  ? "border-primary/50 bg-primary/10"
                  : "border-border text-muted-foreground hover:bg-secondary/50",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      );

    case "repeatable_rows": {
      const rows = (value as Record<string, string>[]) ?? [];
      const columns = field.columns ?? [];
      return (
        <div className="space-y-2 pt-1">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              {columns.map((column) => (
                <div key={column.id} className="min-w-40 flex-1 space-y-1">
                  <Label className="text-[0.6875rem] text-muted-foreground">
                    {column.label}
                  </Label>
                  <Input
                    value={row[column.id] ?? ""}
                    onChange={(e) => {
                      const next = [...rows];
                      next[i] = { ...row, [column.id]: e.target.value };
                      onChange(next);
                    }}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-secondary/50"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...rows, {}])}
            className="rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary/40"
          >
            Add row
          </button>
        </div>
      );
    }

    default:
      return (
        <Input
          id={id}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        />
      );
  }
}

/** Shared by both consumers: a field is answered if it holds something. */
export function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
