/**
 * What raising a finding takes, and what the record starts as.
 *
 * The dialog and the route parse the *same* schema — `system-create.ts` has the
 * argument for why a second copy in the client is worse than it looks.
 *
 * **The closure fields are not on the wire.** `rootCause`, `correctiveAction`,
 * `verifiedById`, `verifiedAt`, `verificationNote` and `closedAt` are all forced
 * null here, and `status` starts `open` rather than being asked for. That is the
 * whole gate: a finding closes only with a root cause, a corrective action and
 * an independent dated verification by somebody other than the owner, and a
 * create route that accepted those fields would let a caller post a finding
 * already closed and self-verified — arriving past the one check the register
 * exists to make, and looking exactly like a properly closed one afterwards.
 *
 * **`source` is asked for and not defaulted.** The mix of sources is the most
 * useful number on the register: a register where everything was raised by an
 * external auditor describes a management system that never finds its own
 * problems, which is itself a nonconformity — and one that can only be spotted
 * if source is a field somebody chose rather than a default nobody read.
 *
 * **A finding that names no system is organisation-level**, the same as a risk.
 * Plenty of real nonconformities are about the management system rather than
 * about a tool.
 */
import { z } from "zod";

import { FINDING_SEVERITY, FINDING_SOURCE } from "./fixtures/registers";
import { recordId } from "./record-id";
import type { Finding } from "./types";

/** An ISO day, as `<input type="date">` and the store both hold one. */
const isoDay = (what: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Give the ${what} as a date.`);

export const FINDING_CREATE_SCHEMA = z
  .object({
    title: z
      .string()
      .trim()
      .min(4, "Say what is wrong, in a phrase somebody can act on.")
      .max(300),
    severity: z.enum(
      Object.keys(FINDING_SEVERITY) as [string, ...string[]],
      { message: "Say how bad it is." },
    ),
    source: z.enum(
      Object.keys(FINDING_SOURCE) as [string, ...string[]],
      { message: "Say where it came from — the mix is what the register is read for." },
    ),
    raisedBy: z
      .string()
      .trim()
      .min(2, "Name the audit reference or the person who raised it — what you would cite.")
      .max(200),
    raisedAt: isoDay("date it was raised"),
    dueAt: isoDay("date it is due"),
    ownerId: z
      .string()
      .trim()
      .min(1, "An unowned finding is one nobody is fixing.")
      .max(200),
    /* Empty means organisation-level, not missing. */
    systemId: z.string().trim().max(200),
    summary: z
      .string()
      .trim()
      .min(20, "Describe it in a sentence or two — at least 20 characters.")
      .max(20_000),
  })
  .strict();

export type FindingCreateInput = z.output<typeof FINDING_CREATE_SCHEMA>;

/**
 * A newly raised finding: open, with nothing yet claimed about the fix.
 *
 * `controlId` starts null rather than being asked for. Which clause a finding
 * lands against is a judgement made with the framework open, on the finding's
 * own page — not one anybody makes accurately from a dropdown at the moment
 * they are writing down what went wrong.
 */
export function newFinding(id: string, input: FindingCreateInput): Finding {
  return {
    id,
    title: input.title,
    severity: input.severity as Finding["severity"],
    status: "open",
    source: input.source as Finding["source"],
    raisedBy: input.raisedBy,
    raisedAt: input.raisedAt,
    dueAt: input.dueAt,
    ownerId: input.ownerId,
    systemId: input.systemId || null,
    controlId: null,
    summary: input.summary,
    rootCause: null,
    correctiveAction: null,
    verifiedById: null,
    verifiedAt: null,
    verificationNote: null,
    closedAt: null,
  };
}

/** A finding id. See `recordId` for why the suffix is there. */
export function newFindingId(title: string, random = Math.random): string {
  return recordId("fnd", title, "finding", random);
}

/** How long a freshly raised finding has before it is late, if nobody says. */
export const DEFAULT_FINDING_DAYS = 30;

/** The due date a dialog offers before anybody changes it. */
export function defaultDueDate(now: Date): string {
  return new Date(now.getTime() + DEFAULT_FINDING_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
