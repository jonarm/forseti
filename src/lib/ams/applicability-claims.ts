import { cleanLine } from "@/lib/sanitize";

/**
 * Reading a set of `(framework, control)` pairs off a request body.
 *
 * Shared by `/api/applicability/claim` and `/api/applicability/unclaim`, which
 * take the same body and differ only in what they do with it. Two copies of a
 * parser is two places a cap, a dedup rule or a sanitiser drifts, and the one
 * that drifts is the one nobody is looking at.
 *
 * **Pairs rather than bare control ids**, because applicability is keyed by
 * framework *and* control: a control id alone does not name a row. One
 * framework ships today against a schema that has been keyed for more since the
 * beginning, so a body shaped around the single-framework case is a migration
 * waiting for the second one.
 */

/** A framework's control count, not a bulk import. */
export const MAX_CLAIMS = 200;

export interface Claim {
  frameworkId: string;
  controlId: string;
}

/**
 * Well-formed pairs, deduplicated, within the cap — or null if the body is not
 * that.
 *
 * Null rather than a thrown error or a filtered list: a caller that sent a
 * malformed entry has a bug, and silently dropping it would apply *some* of
 * what they asked for and report success.
 */
export function readClaims(value: unknown): Claim[] | null {
  if (!Array.isArray(value)) return null;

  const seen = new Set<string>();
  const claims: Claim[] = [];

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { frameworkId, controlId } = entry as Record<string, unknown>;
    if (typeof frameworkId !== "string" || frameworkId.trim() === "") return null;
    if (typeof controlId !== "string" || controlId.trim() === "") return null;

    const claim = {
      frameworkId: cleanLine(frameworkId),
      controlId: cleanLine(controlId),
    };
    /* Serialised rather than joined on a separator: no separator is guaranteed
     * absent from an id, and a collision here would drop a real claim. */
    const key = JSON.stringify([claim.frameworkId, claim.controlId]);
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push(claim);
  }

  if (claims.length === 0 || claims.length > MAX_CLAIMS) return null;
  return claims;
}

/** So a framework's applicability is read once however many of its controls arrived. */
export function groupByFramework(claims: Claim[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const claim of claims) {
    const list = grouped.get(claim.frameworkId) ?? [];
    list.push(claim.controlId);
    grouped.set(claim.frameworkId, list);
  }
  return grouped;
}
