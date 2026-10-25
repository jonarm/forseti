"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, Link2, Loader2, Plus, Trash2, Upload, X } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { countOf, type RecordKindDef } from "@/lib/ams/record-kinds";
import { refusalNote } from "@/lib/permissions";
import { usePermissions } from "@/lib/ams/workspace-context";
import { ExportDialog } from "./export-dialog";
import type { Selection } from "./use-selection";

/**
 * Everything a register does to a set of ticked rows.
 *
 * The inventory grew a selection bar, a confirmation that names what it will
 * remove, and an export dialog. Six more registers want the same three, so they
 * live here once: a register mounts this beside its table and gets the whole
 * surface, gated by the kind's own permissions and pointed at the generic
 * routes by the kind's own id.
 *
 * **Two placements, so two components.** `<RegisterExportButton>` belongs in the
 * page header and is available whether or not anything is ticked;
 * `<RegisterActions>` is the bar and the dialogs, and the bar appears only once
 * something is ticked — a permanent one reading "0 selected" is a row of chrome
 * above every register for the sake of an action nobody has started. The
 * register owns the one boolean between them, which is what lets the button sit
 * in a header the bar is not in.
 *
 * **The tick boxes stay live for a caller who cannot delete.** Selection is
 * unpersisted local state and this codebase deliberately does not gate that; the
 * refusal belongs on the write, which is why the Remove button is disabled and
 * explained rather than absent.
 */

/** What to call a record in a confirmation. Registers name their rows differently. */
function nameOf(row: { id: string }): string {
  const record = row as Record<string, unknown>;
  for (const field of ["name", "title", "filename", "reference"]) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return row.id;
}

export function RegisterActions<T extends { id: string }>({
  def,
  selection,
  /** What the current search and filters left, for the "export everything shown" case. */
  shown,
  /** How many rows the register holds unfiltered, so the dialog can say "all". */
  total,
  /** Extra sentence in the confirmation: what else goes when these do. */
  deleteNote,
  exportOpen,
  onExportOpenChange,
}: {
  def: RecordKindDef;
  selection: Selection<T>;
  shown: readonly T[];
  total: number;
  deleteNote?: string;
  /** Owned by the register, so its Export button can live in the header. */
  exportOpen: boolean;
  onExportOpenChange: (open: boolean) => void;
}) {
  const { records } = usePermissions();
  const router = useRouter();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const may = records[def.kind];
  const chosen = selection.records;

  /**
   * Remove the ticked records, then re-read the register.
   *
   * Nothing is removed from the table optimistically — the rows are the
   * server's answer, and a list that hid a row the delete then failed on would
   * be lying in the most expensive direction a register can.
   */
  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setFailure(null);

    try {
      const response = await fetch(`/api/records/${def.kind}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chosen.map((row) => row.id) }),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFailure(String(json.error ?? "Nothing was removed."));
        return;
      }

      if (json.refused?.length > 0) {
        /* The register moved underneath this screen. Naming the count is enough
         * here because the confirmation already named every row: the person
         * knows what they asked for. */
        setFailure(
          `${json.deleted.length} removed. ${json.refused.length} could not be — the register had changed since this page loaded.`,
        );
      } else {
        setConfirmOpen(false);
      }

      selection.clear();
      router.refresh();
    } catch {
      setFailure("Could not reach the server. Nothing was removed.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-secondary/30 px-6 py-2.5">
          <p className="text-xs">
            <span className="font-medium">{chosen.length} selected</span>
            {selection.hidden > 0 && (
              /* Said out loud, because the alternative is somebody removing a
               * row their current filter is hiding from them. */
              <span className="text-muted-foreground">
                {" "}
                — {selection.hidden} outside the current filters
              </span>
            )}
          </p>
          <Button variant="ghost" size="xs" onClick={selection.clear}>
            <X aria-hidden />
            Clear selection
          </Button>
          {failure && !confirmOpen && (
            <p className="text-xs text-critical">{failure}</p>
          )}

          <div className="ml-auto flex items-center gap-2">
            {def.features.delete && (
              <Gated
                allowed={may.delete}
                action={`remove a ${def.singular} from the ${def.title.toLowerCase()}`}
                onClick={() => {
                  setFailure(null);
                  setConfirmOpen(true);
                }}
                icon={<Trash2 aria-hidden />}
                label={`Remove ${countOf(def, chosen.length)}`}
                variant="destructive"
              />
            )}
          </div>
        </div>
      )}

      {def.features.export && (
        <ExportDialog
          open={exportOpen}
          onOpenChange={onExportOpenChange}
          def={def}
          /* Exactly what the screen is showing: the ticked rows if there are
           * any, otherwise everything the search and filters left. */
          records={chosen.length > 0 ? chosen : [...shown]}
          scope={
            chosen.length > 0 ? "selection" : shown.length === total ? "all" : "filtered"
          }
        />
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (deleting) return;
          setConfirmOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {countOf(def, chosen.length)} from the{" "}
              {def.title.toLowerCase()}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteNote ? `${deleteNote} ` : ""}
              This cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Named, never counted. Somebody who ticked eight rows across two
            * filters can only check this against what they meant if the names
            * are here — and the list is the same one the button acts on. */}
          <ul className="max-h-52 space-y-1 overflow-auto rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs">
            {chosen.map((row) => (
              <li key={row.id} className="truncate">
                {nameOf(row)}
              </li>
            ))}
          </ul>

          {failure && <p className="text-xs text-critical">{failure}</p>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={remove}
            >
              {deleting ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Trash2 aria-hidden />
              )}
              {deleting ? "Removing…" : `Remove ${countOf(def, chosen.length)}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * The Export button, for a register's own header.
 *
 * Its own component because the bar it belongs to is not always on screen: a
 * person opens a register meaning to export it, without ticking anything first,
 * and a button that only appeared after a selection would be a feature they
 * could not find. Reads the kind's permission itself so a caller cannot forget
 * to gate it.
 */
export function RegisterExportButton({
  def,
  onClick,
}: {
  def: RecordKindDef;
  onClick: () => void;
}) {
  const { records } = usePermissions();
  if (!def.features.export) return null;

  return (
    <Gated
      allowed={records[def.kind].export}
      action={`export the ${def.title.toLowerCase()}`}
      onClick={onClick}
      icon={<Download aria-hidden />}
      label="Export"
      variant="outline"
    />
  );
}

/**
 * The "add one of these" button, for a register's own header.
 *
 * Gated on the kind's own `create`, read here rather than passed in so a caller
 * cannot forget it — the same reason the Export button reads its own statement.
 * The wording is the caller's, because it is the one thing that genuinely
 * differs: a system is registered, a finding is raised, an assessment is opened,
 * and a register whose primary action says "New record" is a register nobody
 * recognises their own work in. `action` is the phrase the route's own
 * `requirePermission` call passes, so the sentence somebody reads before
 * clicking is the sentence they would get after.
 */
export function RegisterCreateButton({
  def,
  label,
  action,
  onClick,
}: {
  def: RecordKindDef;
  label: string;
  action: string;
  onClick: () => void;
}) {
  const { records } = usePermissions();

  return (
    <Gated
      allowed={records[def.kind].create}
      action={action}
      onClick={onClick}
      icon={<Plus aria-hidden />}
      label={label}
    />
  );
}

/**
 * The "attach one that already exists" button, for a system profile's tabs.
 *
 * The counterpart to `RegisterCreateButton` and deliberately its own component
 * rather than a second mode on it: creating and attaching are different acts on
 * different routes with different statements, and a button that did both would
 * be the seam where one of the two gates goes missing.
 *
 * **The wording is not the caller's, and that is the difference from create.**
 * A system is registered, a finding is raised, an assessment is opened — the
 * create verb genuinely differs per register, which is why that button takes
 * the label. Attaching does not: it is the same act on every tab that offers
 * it, and four tabs each inventing a phrase for it would be four phrases for
 * one thing. The dialog carries what the act costs on that particular register;
 * the button just opens it.
 *
 * **Absent, not disabled, where the register has no link style.** A refusal is
 * aimed at a person — "you may not do this" — and is therefore disabled and
 * explained. A use case having no organisation-level form is a property of the
 * register, true for every role including the platform admin, so there is
 * nothing to explain to anybody and no button to explain it on. That is the
 * same call `RegisterImportButton` makes for a register with no importer.
 *
 * The statement follows the style rather than being passed in, so a caller
 * cannot pick the wrong one: `attach` gates on `create` because the `evidence`
 * resource has no `update` statement to check, and `file` gates on `update`
 * because it changes a column on a record that already exists. `record-kinds.ts`
 * has the full argument.
 */
export function RegisterLinkButton({
  def,
  action,
  onClick,
}: {
  def: RecordKindDef;
  /** The phrase the route's own `requirePermission` call passes. */
  action: string;
  onClick: () => void;
}) {
  const { records } = usePermissions();
  const style = def.features.link;
  if (!style) return null;

  return (
    <Gated
      allowed={style === "attach" ? records[def.kind].create : records[def.kind].update}
      action={action}
      onClick={onClick}
      icon={<Link2 aria-hidden />}
      label="Link existing"
      variant="outline"
    />
  );
}

/**
 * The Import button, for a register's own header.
 *
 * Gated on the kind's own `create` and not on a statement of its own: importing
 * a spreadsheet is adding nine records at once, it is the same route-level
 * check, and there is no coherent role that may do one and not the other. Absent
 * — not disabled — for a register that cannot be imported into at all, because
 * that is a property of the register rather than a refusal aimed at the person
 * reading it.
 */
export function RegisterImportButton({
  def,
  action,
  onClick,
}: {
  def: RecordKindDef;
  action: string;
  onClick: () => void;
}) {
  const { records } = usePermissions();
  if (def.features.import !== "rows") return null;

  return (
    <Gated
      allowed={records[def.kind].create}
      action={action}
      onClick={onClick}
      icon={<Upload aria-hidden />}
      label="Import"
      variant="outline"
    />
  );
}

/**
 * A button that says why it is refused.
 *
 * Refused means **disabled and explained**, never absent — a missing button
 * reads as a product that cannot do the thing, and the person then goes looking
 * for a feature rather than for an admin. The button is `aria-disabled` rather
 * than `disabled` because a genuinely disabled control fires no pointer events,
 * so the tooltip would never open and the refusal would be unreadable.
 *
 * **Exported** for the affordances that are not a register's. A system profile's
 * Controls tab claims controls against the system, gated on the Statement of
 * Applicability rather than on a `RecordKind` — controls are not a register and
 * have no entry in `record-kinds.ts`. A second copy of this would be a second
 * refusal treatment, and the two would drift on the day one of them learns
 * something.
 */
export function Gated({
  allowed,
  action,
  onClick,
  icon,
  label,
  variant,
}: {
  allowed: boolean;
  action: string;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  variant?: "outline" | "destructive";
}) {
  if (allowed) {
    return (
      <Button variant={variant} size="sm" onClick={onClick}>
        {icon}
        {label}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span tabIndex={0} className="inline-flex">
            <Button
              variant={variant}
              size="sm"
              aria-disabled
              className="pointer-events-none opacity-50"
            >
              {icon}
              {label}
            </Button>
          </span>
        }
      />
      <TooltipContent>{refusalNote(action)}</TooltipContent>
    </Tooltip>
  );
}
