"use client";

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, Printer, Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ErasedColumn } from "@/lib/ams/export-format";
import { countOf, type RecordKindDef } from "@/lib/ams/record-kinds";

/**
 * Export: choose the columns, choose the format, take the file.
 *
 * One dialog for every register. The kind it is handed carries the labels, the
 * column catalogue and the defaults, so nothing here knows whether it is
 * exporting systems or findings — which is also why the route it posts to is
 * `/api/records/[kind]/export` rather than one endpoint per register.
 *
 * **It exports what the table is showing.** The rows arrive as a prop, already
 * filtered, searched and sorted by the screen behind this dialog — and narrowed
 * to a tick selection if there is one. That is the least surprising answer and
 * it is why the count is stated twice: in the description, and on the button
 * somebody actually presses.
 *
 * **The column list is the catalogue, not this file's idea of one.** Labels and
 * ids both come from the registry; the route resolves the values from the same
 * array. A picker with its own copy of the labels is a picker that eventually
 * offers a column the file does not contain.
 *
 * A register is wider than the table that shows it, so the checkboxes are
 * grouped and the columns the table displays are ticked to begin with. Somebody
 * who presses Export without reading gets the list they were looking at.
 */

type Format = "csv" | "xlsx" | "pdf";

export function ExportDialog({
  open,
  onOpenChange,
  def,
  records,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which register this is: its labels, columns and route segment. */
  def: RecordKindDef;
  /** Exactly the rows to export: filtered, or the ticked subset. */
  records: { id: string }[];
  /** How the rows were arrived at, so the dialog can say so plainly. */
  scope: "selection" | "filtered" | "all";
}) {
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(def.defaultColumns),
  );
  const [format, setFormat] = useState<Format>("csv");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** The catalogue, in the order the file lays it out, split into its groups. */
  const groups = useMemo(() => {
    const byGroup = new Map<string, ErasedColumn[]>();
    for (const column of def.columns) {
      const list = byGroup.get(column.group) ?? [];
      list.push(column);
      byGroup.set(column.group, list);
    }
    return [...byGroup.entries()];
  }, [def]);

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Ask the route for the file, and hand it to the browser.
   *
   * The response is bytes rather than JSON, so a failure has to be read out of
   * it before it is treated as a download — otherwise a 403 saves as a
   * spreadsheet containing the word "Refused", which is the kind of bug someone
   * only finds when they open it in front of an auditor.
   */
  async function download() {
    if (busy) return;
    setBusy(true);
    setFailure(null);

    try {
      const response = await fetch(`/api/records/${def.kind}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          columns: def.columns.filter((c) => chosen.has(c.id)).map((c) => c.id),
          ids: records.map((r) => r.id),
        }),
      });

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        setFailure(String(json.error ?? "Nothing was exported."));
        return;
      }

      if (format === "pdf") {
        printDocument(await response.text());
        onOpenChange(false);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      // The route names the file; this reads the name back off the header so
      // the two cannot disagree about the date in it.
      link.download = filenameFrom(response) ?? `${def.title}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);

      onOpenChange(false);
    } catch {
      setFailure("Could not reach the server. Nothing was exported.");
    } finally {
      setBusy(false);
    }
  }

  const count = records.length;
  const counted = countOf(def, count);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[min(46rem,calc(100vw-3rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="gap-1 border-b border-border p-4">
          <DialogTitle className="text-base">Export {def.title.toLowerCase()}</DialogTitle>
          <DialogDescription className="text-xs">
            {scope === "selection"
              ? `The ${counted} you have ticked.`
              : scope === "filtered"
                ? `The ${counted} matching your current search and filters, in the order shown.`
                : `All ${counted} in the register, in the order shown.`}{" "}
            Every export is recorded in the activity trail.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[52vh] space-y-4 overflow-y-auto px-4 py-4">
          <div className="space-y-2">
            <p className="font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground">
              Format
            </p>
            <div className="flex flex-wrap gap-2">
              <FormatChoice
                active={format === "csv"}
                onClick={() => setFormat("csv")}
                icon={<Table2 className="size-3.5" aria-hidden />}
                label="CSV"
                note="Opens anywhere, and re-imports here"
              />
              <FormatChoice
                active={format === "xlsx"}
                onClick={() => setFormat("xlsx")}
                icon={<FileSpreadsheet className="size-3.5" aria-hidden />}
                label="Excel"
                note="Counts stay numbers, header frozen"
              />
              <FormatChoice
                active={format === "pdf"}
                onClick={() => setFormat("pdf")}
                icon={<FileText className="size-3.5" aria-hidden />}
                label="PDF"
                note="Opens your print dialog — choose Save as PDF"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <p className="font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground">
                Columns
              </p>
              <span className="text-xs text-muted-foreground">
                {chosen.size} of {def.columns.length}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setChosen(new Set(def.defaultColumns))}
                >
                  Reset
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setChosen(new Set(def.columns.map((c) => c.id)))
                  }
                >
                  Select all
                </Button>
              </div>
            </div>

            {groups.map(([group, columns]) => (
              <div key={group} className="space-y-1.5 rounded-lg border border-border p-3">
                <p className="text-xs font-medium">{group}</p>
                <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {columns.map((column) => (
                    <label
                      key={column.id}
                      className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Checkbox
                        checked={chosen.has(column.id)}
                        onCheckedChange={() => toggle(column.id)}
                      />
                      {column.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/40 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {failure ? (
              <span className="text-critical">{failure}</span>
            ) : count === 0 ? (
              /* Reachable: the header button is always live, and the current
               * search and filters can leave nothing. Saying so beats a dead
               * Export button with no explanation next to it. */
              `No ${def.plural} match your current search and filters — nothing to export.`
            ) : chosen.size === 0 ? (
              "Choose at least one column."
            ) : (
              <>
                <span className="font-medium text-foreground">{counted}</span>{" "}
                × {chosen.size} column{chosen.size === 1 ? "" : "s"}
              </>
            )}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={download}
              disabled={busy || chosen.size === 0 || count === 0}
            >
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : format === "pdf" ? (
                <Printer aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              {busy
                ? "Preparing…"
                : format === "pdf"
                  ? `Print ${counted}`
                  : `Export ${counted}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Print a document without leaving the page.
 *
 * A hidden same-origin iframe rather than `window.open`: the window would have
 * to be opened after `await fetch`, which is no longer a user gesture, so every
 * popup blocker in use would eat it. An iframe has no such problem and puts the
 * print dialog straight over the inventory, which is where somebody pressing
 * Export is already looking.
 *
 * The document calls `print()` on its own `load` — it knows when its table has
 * been laid out and this side would only be guessing. Cleanup waits for
 * `afterprint`, with a long fallback because a print dialog left open all
 * afternoon must not leak the frame, and a 0×0 iframe removed too early takes
 * the preview with it.
 */
function printDocument(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    frame.remove();
  };

  frame.contentWindow?.addEventListener("afterprint", cleanup);
  window.setTimeout(cleanup, 120_000);

  doc.open();
  doc.write(html);
  doc.close();
}

/** Read the name the route chose, so the download matches the audit entry. */
function filenameFrom(response: Response): string | null {
  const header = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? null;
}

function FormatChoice({
  active,
  onClick,
  icon,
  label,
  note,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-w-52 flex-1 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
        active
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/40 hover:bg-secondary/40",
      )}
    >
      <span className={cn(active ? "text-primary" : "text-muted-foreground")}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{note}</span>
      </span>
    </button>
  );
}
