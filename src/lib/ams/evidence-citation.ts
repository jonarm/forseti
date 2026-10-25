import { cleanLine } from "@/lib/sanitize";

/**
 * Reading a citation off a request body: one control, and the documents being
 * put against it or taken off it.
 *
 * Shared by `/api/records/evidence/cite` and `./uncite`, which take the same
 * body and differ only in what they do with it — the argument
 * `applicability-claims.ts` makes for the pair it serves. Two copies of a parser
 * is two places a cap, a dedup rule or a sanitiser drifts, and the one that
 * drifts is the one nobody is looking at.
 *
 * **The control is named by framework *and* id**, because applicability is keyed
 * by both: a control id alone does not name a row. One framework ships today
 * against a schema that has been keyed for more since the beginning.
 *
 * **One control, many documents** — the orientation the panel that calls it
 * works in. The inverse (one document, many controls) is what the evidence
 * record page would want, and it is a second entry point rather than a second
 * shape here: a body that accepted either would have two ways to say the same
 * thing and a route that had to branch on which arrived.
 */

/** More than a screenful of ticks is a script, not somebody choosing documents. */
export const MAX_CITATIONS = 200;

export interface Citation {
  frameworkId: string;
  controlId: string;
  evidenceIds: string[];
}

/**
 * A well-formed citation, or the sentence to answer with.
 *
 * Returns the message rather than throwing or filtering: a caller that sent a
 * malformed id has a bug, and silently dropping it would apply *some* of what
 * they asked for and report success.
 */
export function readCitation(value: unknown): Citation | { error: string } {
  if (typeof value !== "object" || value === null) {
    return { error: "Expected a JSON object." };
  }

  const { frameworkId, controlId, evidenceIds } = value as Record<string, unknown>;

  if (typeof frameworkId !== "string" || frameworkId.trim() === "") {
    return { error: "A framework id is required." };
  }
  if (typeof controlId !== "string" || controlId.trim() === "") {
    return { error: "A control id is required." };
  }

  if (!Array.isArray(evidenceIds)) {
    return { error: `Send between 1 and ${MAX_CITATIONS} document ids.` };
  }

  const ids = [
    ...new Set(
      evidenceIds
        .filter((id): id is string => typeof id === "string" && id.trim() !== "")
        .map((id) => cleanLine(id)),
    ),
  ];

  if (ids.length === 0 || ids.length > MAX_CITATIONS) {
    return { error: `Send between 1 and ${MAX_CITATIONS} document ids.` };
  }

  return {
    frameworkId: cleanLine(frameworkId),
    controlId: cleanLine(controlId),
    evidenceIds: ids,
  };
}
