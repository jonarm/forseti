"use client";

import { useMemo, useState } from "react";

/**
 * Tick boxes over a filtered table, for any register.
 *
 * Lifted out of the inventory when the second register wanted the same
 * behaviour. Three rules were learned there and are worth keeping in one place
 * rather than re-deriving per screen:
 *
 * **Selection is held as ids and the records are derived.** The rows arrive
 * fresh from the server on every refresh, so a set holding stale copies would
 * compare unequal to what is on screen the moment anybody edited one — and a
 * count taken from the id set would show a phantom selection after a delete
 * that nothing on screen explains. Deriving also makes the count in the bar and
 * the list in the confirmation the same list, which is the property that
 * matters: a bar reading "8 selected" over a dialog naming three is how
 * somebody deletes five records they never saw.
 *
 * **Selection survives filtering.** A row ticked before a filter was applied is
 * still selected and still going; filtering is a way of looking at a register,
 * not a way of deselecting. `hidden` counts how much of the selection is out of
 * view so the screen can admit to it.
 *
 * **The header box acts on the filtered rows only.** Unticking it removes what
 * is visible without touching a row somebody ticked under a different filter —
 * clearing those is what the bar's own Clear is for, and doing it silently here
 * would lose a selection deliberately built across two searches.
 */
export interface Selection<T extends { id: string }> {
  /** The ticked records, derived from `all` — never a stale copy. */
  records: T[];
  /** Ticked but filtered out of view: the number the bar has to admit to. */
  hidden: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** True when every row currently in view is ticked. */
  allShown: boolean;
  /** True when some but not all are — the header box's indeterminate state. */
  someShown: boolean;
  toggleAllShown: () => void;
  clear: () => void;
}

export function useSelection<T extends { id: string }>(
  /** Everything the register holds, unfiltered. */
  all: readonly T[],
  /** What the current search and filters left, in display order. */
  shown: readonly T[],
): Selection<T> {
  const [ids, setIds] = useState<Set<string>>(new Set());

  const records = useMemo(
    () => all.filter((row) => ids.has(row.id)),
    [all, ids],
  );

  const shownSelected = shown.filter((row) => ids.has(row.id)).length;
  const allShown = shown.length > 0 && shownSelected === shown.length;

  return {
    records,
    hidden: records.length - shownSelected,
    isSelected: (id) => ids.has(id),
    allShown,
    someShown: shownSelected > 0,
    toggle: (id) =>
      setIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    toggleAllShown: () =>
      setIds((prev) => {
        const next = new Set(prev);
        for (const row of shown) {
          if (allShown) next.delete(row.id);
          else next.add(row.id);
        }
        return next;
      }),
    clear: () => setIds(new Set()),
  };
}
