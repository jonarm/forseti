/**
 * Importing a spreadsheet into any register.
 *
 * The inventory's importer was written for systems and got three things right
 * that are worth having everywhere: it plans before it applies, the same
 * function judges the preview and the apply, and nothing is coerced silently.
 * This is that machinery with the systems taken out of it — a register supplies
 * an `ImportSpec` saying what its fields are, what a bad row looks like and what
 * a good one becomes, and gets the rest.
 *
 * **Errors and warnings are different promises, in every register.** An
 * **error** means we would be inventing the record rather than importing it, so
 * the row is held back and cannot be forced in. A **warning** states the default
 * it would write, and the person decides whether that default is acceptable.
 *
 * **Validation is a function of the mapping and of this organisation's own
 * records.** The known world is a parameter, built by the dialog from
 * `useWorkspace()` and by the route from the store, so the preview and the apply
 * cannot be checking different registers.
 */
import type { ColumnMapping, ImportIssue, ImportRawRow } from "./types";
import type { Workspace } from "./workspace";

export interface ImportField {
  id: string;
  label: string;
  required: boolean;
}

/**
 * What the rows are checked against: the records they are joining.
 *
 * One shape for every register rather than one per kind. A risk import needs
 * the systems to link to and the people to own it; a finding import needs the
 * controls as well; a system import needs none of those and the business units
 * instead. Narrowing it per kind would mean a second builder per kind, and the
 * cost of the wider shape is a few arrays nobody reads.
 */
export interface ImportWorld {
  /** Names already in the register being imported into, for the duplicate check. */
  existingNames: string[];
  people: { id: string; name: string }[];
  businessUnits: string[];
  systems: { id: string; name: string }[];
  controls: { id: string; title: string }[];
}

/** Everything a register has to say about being imported into. */
export interface ImportSpec<T> {
  /** Our fields, in the order the preview table shows them. */
  fields: readonly ImportField[];
  /**
   * The headers a real spreadsheet uses for each field.
   *
   * Only headers that unambiguously mean one thing. Anything needing a
   * judgement is left out on purpose: an unmapped column is a dropdown somebody
   * spends five seconds on, while a wrongly mapped one is a column they have to
   * notice is wrong first.
   */
  headerWords: Record<string, readonly string[]>;
  /** One example row for the downloadable template, in `fields` order. */
  templateExample: readonly string[];
  /** Problems with the mapping itself, true of every row at once. */
  validateMapping(mapping: ColumnMapping): ImportIssue[];
  /** Problems specific to this row. */
  validateRow(
    row: ImportRawRow,
    mapping: ColumnMapping,
    world: ImportWorld,
    alreadySeen: ReadonlySet<string>,
  ): ImportIssue[];
  /** The value the duplicate check compares — usually the name or title. */
  identityOf(row: ImportRawRow, mapping: ColumnMapping): string;
  /** A planned row, become a record. */
  build(
    row: ImportRawRow,
    mapping: ColumnMapping,
    world: ImportWorld,
    now: Date,
  ): T;
}

/** The world a register is imported into, from a workspace both sides share. */
export function importWorld(ws: Workspace, existingNames: string[]): ImportWorld {
  return {
    existingNames,
    people: ws.people.map((p) => ({ id: p.id, name: p.name })),
    businessUnits: [...new Set(ws.people.map((p) => p.businessUnit).filter(Boolean))].sort(),
    systems: ws.systems.map((s) => ({ id: s.id, name: s.name })),
    controls: ws.controls.map((c) => ({ id: c.id, title: c.shortTitle })),
  };
}

/* ----------------------------------------------------------------- mapping */

/**
 * Compare headers the way a person reads them, not the way they are typed.
 *
 * "Uses genAI?" and "uses gen-ai" are the same header wearing different
 * punctuation, and an importer that treated them as different ones would be
 * asking somebody to fix a difference they cannot see.
 */
export function normaliseHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * What the parser guessed, header by header.
 *
 * First match wins and a field is claimed once, matching the rule the mapping
 * control enforces: two columns cannot both be the owner. Every unrecognised
 * header maps to null rather than being dropped — a column we have no field for
 * still has to appear in the table, because "do not import" is a decision
 * somebody should see us making.
 */
export function guessMapping(
  spec: ImportSpec<unknown>,
  columns: readonly string[],
): ColumnMapping {
  const mapping: ColumnMapping = {};
  const claimed = new Set<string>();

  for (const column of columns) {
    const header = normaliseHeader(column);
    const match = spec.fields.find(
      (field) =>
        !claimed.has(field.id) && (spec.headerWords[field.id] ?? []).includes(header),
    );

    if (match) claimed.add(match.id);
    mapping[column] = match?.id ?? null;
  }

  return mapping;
}

/** The value a target field resolves to under the current mapping. */
export function cellFor(
  row: ImportRawRow,
  mapping: ColumnMapping,
  fieldId: string,
): string {
  const column = Object.keys(mapping).find((c) => mapping[c] === fieldId);
  return column ? (row[column] ?? "").trim() : "";
}

/** Whether a field has a column pointed at it. */
export function isMapped(mapping: ColumnMapping, fieldId: string): boolean {
  return Object.values(mapping).includes(fieldId);
}

/**
 * The mapping issue every register has: the required fields.
 *
 * Registers add their own on top — the inventory warns that an unmapped origin
 * will default to procured SaaS — but "nothing can be imported without a name"
 * is the same sentence everywhere and is generated from `fields` rather than
 * written out per spec.
 */
export function requiredFieldIssues(
  spec: ImportSpec<unknown>,
  mapping: ColumnMapping,
): ImportIssue[] {
  return spec.fields
    .filter((field) => field.required && !isMapped(mapping, field.id))
    .map((field) => ({
      level: "error" as const,
      column: field.label,
      message: `No column is mapped to ${field.label.toLowerCase()}. Nothing can be imported until one is.`,
    }));
}

/* ------------------------------------------------------------------ plan */

export interface PlannedRow {
  index: number;
  raw: ImportRawRow;
  issues: ImportIssue[];
  /** True when this row cannot come in at all — its own error, or the mapping's. */
  blocked: boolean;
}

export interface ImportPlan {
  mappingIssues: ImportIssue[];
  rows: PlannedRow[];
}

/**
 * The whole file, judged in order.
 *
 * In order because the duplicate-within-a-file rule needs a first occurrence to
 * point at, and "the first one wins" is the only version of that rule somebody
 * can predict from looking at their own spreadsheet.
 *
 * The dialog plans the file it is showing; the route plans the rows it was
 * actually asked to import. That can make the preview stricter than the server
 * — exclude the first of two identical names and the preview still flags the
 * second — and stricter is the safe direction for a screen whose whole promise
 * is that nothing arrives which somebody did not see.
 */
export function planImport(
  spec: ImportSpec<unknown>,
  rows: readonly ImportRawRow[],
  mapping: ColumnMapping,
  world: ImportWorld,
): ImportPlan {
  const mappingIssues = spec.validateMapping(mapping);
  const mappingBlocks = mappingIssues.some((issue) => issue.level === "error");
  const seen = new Set<string>();

  const planned = rows.map((raw, index) => {
    const issues = spec.validateRow(raw, mapping, world, seen);
    const blocked = mappingBlocks || issues.some((issue) => issue.level === "error");

    const identity = spec.identityOf(raw, mapping).toLowerCase();
    if (!blocked && identity) seen.add(identity);

    return { index, raw, issues, blocked };
  });

  return { mappingIssues, rows: planned };
}

/* ----------------------------------------------------- shared coercions */

const TRUTHY = new Set(["yes", "y", "true", "1"]);
const FALSY = new Set(["no", "n", "false", "0"]);

export function coerceBoolean(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return false;
}

/** A vocabulary lookup that falls back rather than throwing. */
export function coerceWord<T extends string>(
  value: string,
  words: Record<string, string>,
  fallback: T,
): T {
  return (words[value.trim().toLowerCase()] ?? fallback) as T;
}

/** 1–5, clamped. A spreadsheet holding "7" means "as bad as it gets", not a crash. */
export function coerceScale(value: string, fallback: number): number {
  const n = Number(value.trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function matchPerson(value: string, world: ImportWorld): string | null {
  const wanted = value.trim().toLowerCase();
  if (!wanted) return null;
  return world.people.find((p) => p.name.toLowerCase() === wanted)?.id ?? null;
}

export function matchSystem(value: string, world: ImportWorld): string | null {
  const wanted = value.trim().toLowerCase();
  if (!wanted) return null;
  return world.systems.find((s) => s.name.toLowerCase() === wanted)?.id ?? null;
}

/** Lowercased set, for the case-insensitive comparisons every spec makes. */
export function lower(values: readonly string[]): Set<string> {
  return new Set(values.map((v) => v.toLowerCase()));
}

/* -------------------------------------------------------------- template */

/**
 * A blank file in the shape a register reads best.
 *
 * Offered alongside the mapping screen rather than instead of it: the importer
 * exists because people already keep a spreadsheet with their own column names,
 * and a template implying they should re-type it into ours first would be
 * arguing with the feature. It is for the person who has no spreadsheet yet.
 *
 * The headers are the spec's own labels, so `guessMapping` resolves every one
 * and the file lands on the mapping screen with nothing left to do.
 */
export function templateCsv(spec: ImportSpec<unknown>): string {
  const escape = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  return [
    spec.fields.map((field) => escape(field.label)).join(","),
    spec.templateExample.map(escape).join(","),
  ].join("\n");
}
