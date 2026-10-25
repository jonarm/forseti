"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/ams/labels";
import { refusalNote } from "@/lib/permissions";
import type { RecordKind } from "@/lib/ams/record-kinds";
import type { TrashItem } from "@/lib/ams/trash-view";
import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";
import { StatusBadge } from "./status-badge";

/**
 * What was removed, from which register, and how long is left to change one's
 * mind.
 *
 * The trash is a governance screen before it is a convenience. A register that
 * quietly shrank is the thing an auditor asks about, so this answers the three
 * questions they would ask — what left, on whose authority, and when it stops
 * being recoverable — rather than just offering an undo button.
 *
 * **One tab per register, and the empty ones stay.** A tab that disappears when
 * its register has nothing removed is a tab nobody can find on the day it
 * matters; the count beside each name is the answer either way.
 *
 * **Selection is per tab.** Restoring is a per-register write — the route takes
 * a kind in its path — so a selection spanning two registers would be one
 * button making two different calls, with half of it able to fail. Switching
 * tabs clears what was ticked, because a selection somebody cannot see is a
 * selection they cannot check.
 *
 * **The countdown arrives as a number**, derived on the server against one
 * instant, so nothing here does date arithmetic and no figure can drift between
 * the server's render and the browser's.
 */

interface KindTab {
  kind: RecordKind;
  title: string;
  plural: string;
}

export function TrashTable({
  items,
  kinds,
  retentionDays,
}: {
  items: Record<RecordKind, TrashItem[]>;
  kinds: KindTab[];
  retentionDays: number;
}) {
  const { personForAccount } = useWorkspace();
  const { viewTrash } = usePermissions();
  const router = useRouter();

  /** Open on the first register that actually has something in it. */
  const [active, setActive] = useState<RecordKind>(
    () => kinds.find((k) => (items[k.kind] ?? []).length > 0)?.kind ?? kinds[0].kind,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /* Memoised because the `?? []` would be a fresh array on every render, which
   * makes the selection below recompute for no reason. */
  const rows = useMemo(() => items[active] ?? [], [items, active]);
  const total = kinds.reduce((sum, k) => sum + (items[k.kind] ?? []).length, 0);

  /* Derived from the rows, never counted from the tick set — the same rule the
   * registers follow, and for the same reason. */
  const chosen = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );

  const allShown = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someShown = rows.some((row) => selected.has(row.id));

  function switchTo(kind: RecordKind) {
    setActive(kind);
    // A selection somebody cannot see is a selection they cannot check.
    setSelected(new Set());
    setFailure(null);
  }

  /**
   * Put the ticked records back.
   *
   * No confirmation. Restoring is the reversible direction — the register gains
   * rows it used to have, and anybody who did it by accident can remove them
   * again from the screen they came from. A dialog in front of an undo is a
   * dialog people learn to dismiss without reading, which is the habit the
   * delete confirmation needs them not to have.
   */
  async function restore() {
    if (restoring || chosen.length === 0) return;
    setRestoring(true);
    setFailure(null);

    try {
      const response = await fetch(`/api/records/${active}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chosen.map((row) => row.id) }),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFailure(String(json.error ?? "Nothing was restored."));
        return;
      }

      if (json.refused?.length > 0) {
        setFailure(
          `${json.restored.length} restored. ${json.refused.length} could not be — the trash had changed since this page loaded.`,
        );
      }

      setSelected(new Set());
      router.refresh();
    } catch {
      setFailure("Could not reach the server. Nothing was restored.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-6 py-5">
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ArrowLeft className="size-3" aria-hidden />
          Back to the inventory
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Trash</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Everything removed from a register, across the whole product.{" "}
          <span className="text-foreground">
            {total} record{total === 1 ? "" : "s"}
          </span>{" "}
          waiting. Each is permanently deleted{" "}
          <span className="text-foreground">
            {retentionDays} days after it was removed
          </span>
          , along with whatever hung off it. The record of who removed it stays
          in the activity trail either way.
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-border px-6 py-2">
        {kinds.map((tab) => {
          const count = (items[tab.kind] ?? []).length;
          return (
            <button
              key={tab.kind}
              type="button"
              onClick={() => switchTo(tab.kind)}
              aria-current={active === tab.kind ? "page" : undefined}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                active === tab.kind
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )}
            >
              {tab.title}
              <span
                className={cn(
                  "ml-1.5 tabular",
                  count === 0 ? "text-muted-foreground/40" : "text-muted-foreground",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-secondary/30 px-6 py-2.5">
          <p className="text-xs font-medium">{chosen.length} selected</p>
          <Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
          {failure && <p className="text-xs text-critical">{failure}</p>}
          <div className="ml-auto">
            <RestoreButton
              allowed={viewTrash}
              count={chosen.length}
              busy={restoring}
              onClick={restore}
            />
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-24 text-center">
          <Trash2 className="size-7 text-muted-foreground/50" aria-hidden />
          <p className="text-sm font-medium">
            Nothing removed from{" "}
            {kinds.find((k) => k.kind === active)?.title.toLowerCase()}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            Records you remove wait here for {retentionDays} days before they are
            deleted for good.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={TH}>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={allShown}
                      indeterminate={!allShown && someShown}
                      onCheckedChange={() =>
                        setSelected(
                          allShown ? new Set() : new Set(rows.map((r) => r.id)),
                        )
                      }
                      aria-label={
                        allShown ? "Deselect everything" : "Select everything"
                      }
                    />
                    Record
                  </div>
                </th>
                <th className={TH}>Removed by</th>
                <th className={cn(TH, "text-right")}>Removed</th>
                <th className={cn(TH, "text-right")}>Deleted for good</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                /* The same two-space lookup the activity panel does: the id is
                 * a Better Auth account, which may or may not be linked to a
                 * person somebody has heard of. */
                const remover = personForAccount(row.deletedBy)?.name ?? row.deletedBy;
                const day = row.deletedAt.slice(0, 10);

                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border/60 transition-colors hover:bg-secondary/40",
                      selected.has(row.id) && "bg-secondary/60",
                    )}
                  >
                    <td className={cn(TD, "border-b border-border/60")}>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(row.id)}
                          onCheckedChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.id)) next.delete(row.id);
                              else next.add(row.id);
                              return next;
                            })
                          }
                          aria-label={`Select ${row.label}`}
                        />
                        <div className="min-w-0">
                          {/* Not a link. Every register's detail page reads the
                            * live record, and a removed one is not in it. */}
                          <span className="block font-medium">{row.label}</span>
                          {row.detail && (
                            <span className="block text-[0.75rem] text-muted-foreground/70">
                              {row.detail}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={cn(TD, "border-b border-border/60 text-muted-foreground")}>
                      {remover ?? (
                        <span className="text-muted-foreground/50">Not recorded</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        TD,
                        "border-b border-border/60 text-right text-muted-foreground tabular",
                      )}
                    >
                      {formatDate(day)}
                    </td>
                    <td className={cn(TD, "border-b border-border/60 text-right")}>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="cursor-help">
                              <StatusBadge
                                label={
                                  row.daysLeft === 0
                                    ? "Any moment"
                                    : `${row.daysLeft} ${row.daysLeft === 1 ? "day" : "days"}`
                                }
                                /* Red only at the end. A row with three weeks
                                 * left is not a warning, and colouring every
                                 * one is how the row with a day left stops
                                 * being visible. */
                                tone={row.daysLeft <= 3 ? "critical" : "neutral"}
                              />
                            </span>
                          }
                        />
                        <TooltipContent className="max-w-72">
                          Removed {formatDate(day)}. The nightly job deletes it{" "}
                          {retentionDays} days after that, along with whatever
                          hung off it.
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TH =
  "sticky top-0 z-10 bg-background px-3 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap border-b border-border";
const TD = "px-3 py-2 whitespace-nowrap";

/**
 * Restore, refused or not.
 *
 * Gated on `viewTrash`, which is the flag that lets this page render at all and
 * derives from the same `role: ["update"]` the restore route checks. Asking the
 * one question in both places is what stops the screen and the route drifting
 * apart — gating on each register's own `create` would read more naturally and
 * would be a different question from the one the server asks.
 *
 * The refused rendering is unreachable while the page itself is gated on the
 * same flag, and stays anyway: the day the view is widened before the write is,
 * it is what shows a reader why the button is dead.
 */
function RestoreButton({
  allowed,
  count,
  busy,
  onClick,
}: {
  allowed: boolean;
  count: number;
  busy: boolean;
  onClick: () => void;
}) {
  const label = `Restore ${count} record${count === 1 ? "" : "s"}`;

  if (allowed) {
    return (
      <Button size="sm" disabled={busy} onClick={onClick}>
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <RotateCcw aria-hidden />
        )}
        {busy ? "Restoring…" : label}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span tabIndex={0} className="inline-flex">
            <Button size="sm" aria-disabled className="pointer-events-none opacity-50">
              <RotateCcw aria-hidden />
              {label}
            </Button>
          </span>
        }
      />
      <TooltipContent>{refusalNote("restore a record from the trash")}</TooltipContent>
    </Tooltip>
  );
}
