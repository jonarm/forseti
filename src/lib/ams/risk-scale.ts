/**
 * The risk scale, in one place.
 *
 * Likelihood and impact are both 1–5, so the product runs 1–25. The bands below
 * are deliberately coarse: the difference between 11 and 12 is noise, and a
 * register that renders four shades of amber invites arguments about a number
 * that was a judgement in the first place. Three bands is as much precision as
 * the underlying estimate can carry.
 *
 * Tones come from the app's existing status tokens rather than a new heat
 * palette. A risk matrix in green-to-red is the conventional form and also the
 * conventional mistake — it introduces a second colour language into a product
 * that already has one, and it puts a hue at every cell so nothing stands out.
 * Here the low band is neutral, and colour appears only where somebody has to
 * act. Every surface that shows a band also shows the number, so colour is
 * never carrying the meaning alone.
 */
import type { Tone } from "./tone";

export function riskBand(score: number): { label: string; tone: Tone } {
  if (score >= 15) return { label: "Severe", tone: "critical" };
  if (score >= 8) return { label: "Elevated", tone: "warn" };
  return { label: "Low", tone: "neutral" };
}

export const TREATMENT: Record<string, { label: string; blurb: string }> = {
  mitigate: {
    label: "Mitigate",
    blurb: "Reduce the likelihood or the impact by doing something about it.",
  },
  accept: {
    label: "Accept",
    blurb: "Carry it deliberately, with somebody senior enough named against it.",
  },
  transfer: {
    label: "Transfer",
    blurb: "Move the consequence elsewhere — insurance, or a contractual term.",
  },
  avoid: {
    label: "Avoid",
    blurb: "Stop doing the thing that creates it.",
  },
};

export const RISK_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "warn" },
  treated: { label: "Treated", tone: "ok" },
  accepted: { label: "Accepted", tone: "info" },
  closed: { label: "Closed", tone: "neutral" },
};
