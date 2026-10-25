/**
 * How long a removed system stays recoverable, and how long is left.
 *
 * A domain rule with a number attached, so it lives here beside `readiness.ts`
 * and `risk-scale.ts` rather than in the store or in the screen that renders
 * it. Three callers read it and they must not disagree: the trash view labels
 * the window, the countdown column derives from it, and the nightly purge acts
 * on it. A retention period that a screen states and a cron contradicts is
 * worse than an unlabelled one — somebody plans around the screen.
 *
 * Nothing here is stored. The deadline is `deletedAt` plus the window, computed
 * wherever it is needed, which is the same rule every other derived figure in
 * this product follows.
 */
import type { DeletedAISystem } from "./types";

export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a system removed at `deletedAt` stops being recoverable. */
export function purgeDueAt(
  deletedAt: Date,
  retentionDays: number = TRASH_RETENTION_DAYS,
): Date {
  return new Date(deletedAt.getTime() + retentionDays * DAY_MS);
}

/** The cutoff a purge runs against: anything removed before this is overdue. */
export function purgeCutoff(
  now: Date,
  retentionDays: number = TRASH_RETENTION_DAYS,
): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/**
 * Whole days left before a removed system is deleted for good.
 *
 * Rounded up, and floored at zero. Up because "0 days" on a row that still has
 * eleven hours would be a lie in the direction that costs somebody their data;
 * floored because a row the cron has not reached yet is overdue, not negative,
 * and the screen says "any moment" rather than counting into the past.
 */
export function daysUntilPurge(
  deletedAt: string,
  now: Date,
  retentionDays: number = TRASH_RETENTION_DAYS,
): number {
  const due = purgeDueAt(new Date(deletedAt), retentionDays);
  return Math.max(0, Math.ceil((due.getTime() - now.getTime()) / DAY_MS));
}

export type TrashRow = DeletedAISystem & { daysLeft: number };

/**
 * The trash, with its countdown attached.
 *
 * Takes `now` rather than reading the clock, so the page passes one instant and
 * every row is counted against the same one — and so this stays a pure function
 * a Server Component may call.
 */
export function withCountdown(
  rows: DeletedAISystem[],
  now: Date,
  retentionDays: number = TRASH_RETENTION_DAYS,
): TrashRow[] {
  return rows.map((row) => ({
    ...row,
    daysLeft: daysUntilPurge(row.deletedAt, now, retentionDays),
  }));
}
