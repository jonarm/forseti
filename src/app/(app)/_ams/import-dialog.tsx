"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { IMPORT_FILENAME, sampleCsv } from "@/lib/ams/fixtures/import";
import {
  importWorld,
  planImport,
  templateCsv,
  type ImportSpec,
} from "@/lib/ams/import-spec";
import { countOf, type RecordKindDef } from "@/lib/ams/record-kinds";
import type { ColumnMapping, ImportRawRow } from "@/lib/ams/types";
import { useWorkspace } from "@/lib/ams/workspace-context";
import { StatusBadge } from "./status-badge";

/**
 * Import: read the file, plan, then apply — for any register.
 *
 * The whole point of this screen is that it does not import anything until
 * somebody has seen what it would do. Three stages — drop, map, confirm — and
 * the middle one is where the argument lives: the column mapping is *editable*,
 * and every warning on every row is recomputed from the current mapping rather
 * than baked into the file. Repoint a dropdown and the warnings change
 * underneath you, because that is what a real importer has to do.
 *
 * The kind it is handed carries the fields, the header guesses and the rules,
 * so nothing here knows whether it is importing systems, risks or findings.
 * What each register considers a broken row lives in its own `ImportSpec`.
 *
 * **The drop stage is now a real one.** It used to wait 800ms and then preview
 * nine hard-coded rows, which made every stage after it honest and this one a
 * picture of a feature. The file goes to the parse route, which
 * identifies it by its bytes and hands back the headers and rows it found; the
 * sample spreadsheet is uploaded the same way rather than short-circuiting, so
 * the demo cannot pass while the parser is broken.
 *
 * Nothing about the file is held anywhere but this component's state. The parse
 * route stores none of it, so closing the dialog is the end of the copy.
 *
 * Errors and warnings are different promises. An error means we would be
 * inventing the record rather than importing it, so the row is held back and
 * cannot be forced in. A warning states the default it would write, and the
 * person decides whether that default is acceptable. Nothing is coerced
 * silently.
 */

type Stage = "drop" | "parsing" | "map";

/** What the parse route found. Its shape is the route's response, not a parser's internals. */
interface Sheet {
  filename: string;
  columns: string[];
  rows: ImportRawRow[];
  /** The row number each row had in the source file, so a warning is traceable. */
  lines: number[];
}

/** What the server did with each row, once it has done it. */
interface Applied {
  imported: { index: number; id: string; name: string }[];
  rejected: { index: number; name: string; reason: string }[];
}

const NOTHING = "__none__";

/** What the file picker offers. The bytes decide what is actually read. */
const ACCEPT = ".csv,.tsv,.txt,.xlsx,text/csv,text/plain";

export function ImportDialog({
  open,
  onOpenChange,
  def,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which register this is: its labels, its spec, its route segment. */
  def: RecordKindDef;
  /** Called with the ids the server stored, once it has stored them. */
  onImported: (ids: string[]) => void;
}) {
  const ws = useWorkspace();
  const [stage, setStage] = useState<Stage>("drop");
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** Set once the route has answered, and only when it refused some rows. */
  const [applied, setApplied] = useState<Applied | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  /** The spec is required to render at all; a register without one has no import. */
  const spec = def.importSpec as ImportSpec<unknown> | undefined;

  /**
   * The register these rows are joining — **this organisation's**, not a
   * fixture. The route builds the same thing from the store and re-checks every
   * row against it, so what the preview promises is what gets applied.
   */
  const world = useMemo(
    () => importWorld(ws, existingNames(def, ws)),
    [ws, def],
  );

  const plan = useMemo(
    () =>
      spec
        ? planImport(spec, sheet?.rows ?? [], mapping, world)
        : { mappingIssues: [], rows: [] },
    [spec, sheet, mapping, world],
  );
  const mappingIssues = sheet ? plan.mappingIssues : [];
  const rows = plan.rows;

  const importable = rows.filter((r) => !r.blocked && !excluded.has(r.index));
  const blockedCount = rows.filter((r) => r.blocked).length;
  const warningCount = rows.filter(
    (r) => !r.blocked && r.issues.length > 0,
  ).length;

  function reset() {
    setStage("drop");
    setSheet(null);
    setReading(null);
    setMapping({});
    setExcluded(new Set());
    setDragging(false);
    setFailure(null);
    setApplied(null);
  }

  /**
   * Read a file: upload it, and take what comes back as the file's contents.
   *
   * A parse failure returns to the drop stage holding its reason rather than
   * leaving the spinner running, which is what the old fake could not fail at.
   * The reason is the route's — "that is a PDF, which has no columns to map" —
   * because a generic "could not read that file" leaves somebody re-exporting
   * a file that was never going to work.
   */
  async function read(file: File) {
    setStage("parsing");
    setReading(file.name);
    setFailure(null);
    setApplied(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const response = await fetch(`/api/records/${def.kind}/import/parse`, {
        method: "POST",
        body: form,
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFailure(String(json.error ?? "That file could not be read."));
        setStage("drop");
        return;
      }

      const parsed = json as Sheet;
      setSheet(parsed);
      // The route's guess, and only until somebody touches a dropdown.
      setMapping((json as { mapping: ColumnMapping }).mapping ?? {});
      setExcluded(new Set());
      setStage("map");
    } catch {
      setFailure("Could not reach the server. Nothing was read.");
      setStage("drop");
    }
  }

  /**
   * The sample, uploaded as the file it is rather than injected as rows.
   *
   * Only the inventory has one — it is a specific messy procurement tracker
   * rather than a generic example, and inventing one per register would be
   * three more fixtures to keep true.
   */
  function readSample() {
    void read(new File([sampleCsv()], IMPORT_FILENAME, { type: "text/csv" }));
  }

  /**
   * Hand over a blank file in our own headers.
   *
   * Built in the browser from `TARGET_FIELDS` rather than served from `/public`,
   * so it cannot drift from the fields we actually read — a static template that
   * still listed a column we removed is a support ticket nobody can reproduce.
   *
   * The object URL is revoked on the next tick: the click has already started
   * the download by then, and holding it keeps the blob alive for the life of
   * the document.
   */
  function downloadTemplate() {
    if (!spec) return;
    const url = URL.createObjectURL(
      new Blob([templateCsv(spec)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `Forseti ${def.title.toLowerCase()} template.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /**
   * Apply: send the rows, and say what came back.
   *
   * The rows go up rather than the systems they would become, because deciding
   * what a row becomes is the route's job — it re-checks each one against the
   * register as it stands now, and a client that had already built the records
   * would be asking the server to rubber-stamp a decision made a minute ago.
   *
   * The dialog closes only on a clean apply. If the route refused a row, it
   * stays open holding the reason: an import that closed on a partial result
   * would leave somebody believing nine rows landed when seven did.
   */
  async function confirm() {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    setApplied(null);

    try {
      const response = await fetch(`/api/records/${def.kind}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapping,
          rows: importable.map((r) => r.raw),
        }),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFailure(String(json.error ?? "Nothing was imported."));
        return;
      }

      const result = json as Applied;
      onImported(result.imported.map((r) => r.id));

      if (result.rejected.length > 0) {
        setApplied(result);
        return;
      }

      onOpenChange(false);
      // Reset after the close animation so the dialog does not flicker back to
      // the drop state while it is still visible.
      window.setTimeout(reset, 200);
    } catch {
      setFailure("Could not reach the server. Nothing was imported.");
    } finally {
      setSaving(false);
    }
  }

  /** Which of our fields are already claimed, so a column cannot be mapped twice. */
  const claimed = new Set(Object.values(mapping).filter(Boolean) as string[]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) window.setTimeout(reset, 200);
      }}
    >
      <DialogContent className="max-h-[88vh] w-[min(72rem,calc(100vw-3rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="gap-1 border-b border-border p-4">
          <DialogTitle className="text-base">
            Import into {def.title.toLowerCase()}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Nothing is written until you confirm. Every row is checked against
            your existing records, users and systems first.
          </DialogDescription>
        </DialogHeader>

        {stage === "drop" && (
          <div className="space-y-3 p-6">
            <input
              ref={picker}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Cleared so picking the same file twice fires again — which is
                // exactly what somebody does after fixing a rejected export.
                e.target.value = "";
                if (file) void read(file);
              }}
            />
            <button
              type="button"
              onClick={() => picker.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void read(file);
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 transition-colors",
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border bg-secondary/20 hover:border-muted-foreground/40 hover:bg-secondary/40",
              )}
            >
              <UploadCloud className="size-7 text-muted-foreground" aria-hidden />
              <div className="space-y-1 text-center">
                <p className="text-sm font-medium">
                  Drop a spreadsheet, or click to choose one
                </p>
                <p className="text-xs text-muted-foreground">
                  XLSX or CSV. Any column layout — you map them on the next step.
                </p>
              </div>
            </button>

            {failure && (
              <p className="flex items-start gap-2 text-xs leading-snug text-critical">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>{failure}</span>
              </p>
            )}

            {/* Both are for the person who has nothing to drop, and they are
                different answers: one shows what the mapping screen does to a
                messy real file, the other is a blank file in our own headers. */}
            <p className="text-center text-xs text-muted-foreground">
              No spreadsheet to hand?{" "}
              {def.kind === "system" && (
                <>
                  <button
                    type="button"
                    onClick={readSample}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Try it with a sample one
                  </button>{" "}
                  or{" "}
                </>
              )}
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
              >
                <Download className="size-3" aria-hidden />
                download a CSV template
              </button>
              .
            </p>
          </div>
        )}

        {stage === "parsing" && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-24">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Reading {reading ?? "your spreadsheet"}…
            </p>
          </div>
        )}

        {stage === "map" && sheet && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-secondary/20 px-4 py-2.5">
              <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-xs font-medium">{sheet.filename}</span>
              <span className="text-xs text-muted-foreground">
                {sheet.rows.length} rows · {sheet.columns.length} columns detected
              </span>
              <div className="ml-auto flex items-center gap-2">
                {blockedCount > 0 && (
                  <StatusBadge
                    tone="critical"
                    label={`${blockedCount} blocked`}
                    title="Rows that cannot be imported without a fix in the source file"
                  />
                )}
                {warningCount > 0 && (
                  <StatusBadge tone="warn" label={`${warningCount} with warnings`} />
                )}
                <StatusBadge tone="ok" label={`${importable.length} ready`} />
              </div>
            </div>

            {mappingIssues.length > 0 && (
              <ul className="space-y-1.5 border-b border-border px-4 py-3">
                {mappingIssues.map((issue, i) => (
                  <li
                    key={i}
                    className={cn(
                      "flex items-start gap-2 text-xs leading-snug",
                      issue.level === "error" ? "text-critical" : "text-warn",
                    )}
                  >
                    <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                    <span>
                      <span className="font-medium">{issue.column}:</span>{" "}
                      {issue.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="max-h-[52vh] overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-popover">
                  <tr>
                    <th className="w-9 border-b border-border px-3 py-2" />
                    <th className="w-10 border-b border-border px-2 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground">
                      Row
                    </th>
                    {sheet.columns.map((column) => (
                      <th
                        key={column}
                        className="min-w-44 border-b border-border px-3 pt-2 pb-2 text-left align-top"
                      >
                        <div className="space-y-1.5">
                          <p className="truncate font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground">
                            {column}
                          </p>
                          <ColumnMapSelect
                            fields={def.importSpec?.fields ?? []}
                            value={mapping[column] ?? null}
                            claimed={claimed}
                            onChange={(next) =>
                              setMapping((m) => ({ ...m, [column]: next }))
                            }
                          />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const skipped = excluded.has(row.index);
                    // The row's number in the person's own file, carried out of
                    // the parser — a blank spacer row makes any derivation wrong.
                    const line = sheet.lines[row.index] ?? row.index + 2;
                    return (
                      <tr
                        key={row.index}
                        className={cn(
                          "align-top",
                          row.blocked && "bg-critical/[0.04]",
                          skipped && "opacity-40",
                        )}
                      >
                        <td className="border-b border-border px-3 py-2">
                          <Checkbox
                            checked={!row.blocked && !skipped}
                            disabled={row.blocked}
                            onCheckedChange={() =>
                              setExcluded((prev) => {
                                const next = new Set(prev);
                                if (next.has(row.index)) next.delete(row.index);
                                else next.add(row.index);
                                return next;
                              })
                            }
                            aria-label={`Include row ${line}`}
                          />
                        </td>
                        <td className="border-b border-border px-2 py-2 font-mono text-xs text-muted-foreground/60">
                          {line}
                        </td>
                        {sheet.columns.map((column, i) => {
                          const value = row.raw[column] ?? "";
                          const unmapped = !mapping[column];
                          // Issues hang off the first cell so a row reads left
                          // to right: what came in, then what we make of it.
                          const showIssues = i === 0 && row.issues.length > 0;
                          return (
                            <td
                              key={column}
                              className={cn(
                                "border-b border-border px-3 py-2",
                                unmapped && "text-muted-foreground/35 line-through",
                              )}
                            >
                              <div className="space-y-1.5">
                                <span className="block max-w-64 truncate">
                                  {value || (
                                    <span className="text-muted-foreground/40">—</span>
                                  )}
                                </span>
                                {showIssues && (
                                  <ul className="space-y-1">
                                    {row.issues.map((issue, j) => (
                                      <li
                                        key={j}
                                        className={cn(
                                          "flex max-w-72 items-start gap-1.5 whitespace-normal text-[0.6875rem] leading-snug",
                                          issue.level === "error"
                                            ? "text-critical"
                                            : "text-warn",
                                        )}
                                      >
                                        <AlertTriangle
                                          className="mt-px size-3 shrink-0"
                                          aria-hidden
                                        />
                                        <span>{issue.message}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {applied && (
              /* The route refused rows the preview had cleared, which means the
               * register moved underneath this screen. Naming them is the whole
               * point: a count would leave somebody re-reading nine rows. */
              <div className="space-y-1.5 border-t border-border bg-critical/[0.06] px-4 py-3">
                <p className="text-xs font-medium">
                  {applied.imported.length} imported.{" "}
                  {applied.rejected.length} refused when it was applied — the
                  inventory had changed since this preview was built.
                </p>
                <ul className="space-y-1">
                  {applied.rejected.map((row) => (
                    <li
                      key={row.index}
                      className="flex items-start gap-1.5 text-[0.6875rem] leading-snug text-critical"
                    >
                      <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                      <span>
                        <span className="font-medium">{row.name}:</span> {row.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/40 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {failure ? (
                  <span className="text-critical">{failure}</span>
                ) : importable.length === 0 ? (
                  "No rows can be imported with the current mapping."
                ) : (
                  <>
                    <span className="font-medium text-foreground">
                      {importable.length} of {sheet.rows.length} rows
                    </span>{" "}
                    will be added as {countOf(def, importable.length)}.
                    {blockedCount > 0 &&
                      ` ${blockedCount} held back — fix the source file and re-upload.`}
                  </>
                )}
              </p>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => onOpenChange(false)}
                >
                  {applied ? "Close" : "Cancel"}
                </Button>
                <Button
                  size="sm"
                  onClick={confirm}
                  disabled={saving || importable.length === 0}
                >
                  {saving ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <CheckCircle2 aria-hidden />
                  )}
                  {saving ? "Importing…" : `Import ${countOf(def, importable.length)}`}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The mapping control.
 *
 * A field already claimed by another column is disabled rather than hidden, so
 * the list of our fields stays the same length every time it opens and the
 * person can see *why* the option they wanted is unavailable.
 */
function ColumnMapSelect({
  fields,
  value,
  claimed,
  onChange,
}: {
  fields: readonly { id: string; label: string; required: boolean }[];
  value: string | null;
  claimed: Set<string>;
  onChange: (value: string | null) => void;
}) {
  const current = fields.find((f) => f.id === value);

  return (
    <Select
      value={value ?? NOTHING}
      onValueChange={(next) => onChange(next === NOTHING || next === null ? null : next)}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          "w-full font-normal",
          !current && "text-muted-foreground/50",
        )}
      >
        <SelectValue>{current ? current.label : "Do not import"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOTHING}>Do not import</SelectItem>
        {fields.map((field) => (
          <SelectItem
            key={field.id}
            value={field.id}
            disabled={field.id !== value && claimed.has(field.id)}
          >
            {field.label}
            {field.required ? " *" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The names already in the register being imported into.
 *
 * Read from the workspace the screen is already holding, so the duplicate
 * warning in the preview is computed against exactly what the route will
 * compute it against a moment later.
 */
function existingNames(
  def: RecordKindDef,
  ws: ReturnType<typeof useWorkspace>,
): string[] {
  const rows =
    def.kind === "system"
      ? ws.systems.map((s) => s.name)
      : def.kind === "risk"
        ? ws.risks.map((r) => r.title)
        : def.kind === "finding"
          ? ws.findings.map((f) => f.title)
          : [];
  return rows.filter(Boolean);
}
