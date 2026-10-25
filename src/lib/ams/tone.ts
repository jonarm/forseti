/**
 * Status tones, owned locally.
 *
 * These are the same four semantic colours the main app defines in
 * `globals.css`, re-declared here rather than imported. They were originally
 * kept apart from the GDPR toolkit's `score.ts`, which reached the database
 * three hops down; that module is gone, and the separation is still worth its
 * six lines — nothing under `lib/ams/` should have to import a scoring module to
 * pick a badge colour, and this way the import graph is checkable with one grep.
 *
 * `neutral` is the addition, and it is the point of the badge system: most
 * status in this product is not good or bad, it is simply *known*. A tool at
 * pilot stage is not a warning. Reserve colour for the rows someone has to do
 * something about, or every screen turns into a christmas tree and the two
 * genuinely critical rows disappear into it.
 */

export type Tone = "ok" | "warn" | "critical" | "info" | "neutral";

export const TONE_BADGE: Record<Tone, string> = {
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  critical: "border-critical/30 bg-critical/10 text-critical",
  info: "border-brand/30 bg-brand/10 text-brand",
  neutral: "border-border bg-secondary/60 text-muted-foreground",
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  critical: "text-critical",
  info: "text-brand",
  neutral: "text-muted-foreground",
};

export const TONE_FILL: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  critical: "bg-critical",
  info: "bg-brand",
  neutral: "bg-muted-foreground",
};

export const TONE_TRACK: Record<Tone, string> = {
  ok: "bg-ok/15",
  warn: "bg-warn/15",
  critical: "bg-critical/15",
  info: "bg-brand/15",
  neutral: "bg-muted",
};

/** Coverage and readiness percentages band identically everywhere they appear. */
export function coverageTone(percent: number): Tone {
  if (percent >= 80) return "ok";
  if (percent >= 50) return "warn";
  return "critical";
}
