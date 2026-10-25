/**
 * Minting an id for a record somebody just created.
 *
 * Written once because it was written three times: the inventory, the risk
 * importer and the finding importer each carried the same slug-plus-suffix
 * function with a different prefix and a different fallback word, and adding a
 * create flow to three more registers would have made six. The copies had
 * already started to matter — they are the reason an id is safe to hand to an
 * upsert at all, and a rule enforced in six places is a rule that holds in five.
 *
 * **The slug is legibility; the suffix is the id.** Every store write upserts on
 * `(organizationId, id)` and an upsert onto an existing row is an ordinary
 * update, not a failure — so a purely name-derived id would mean the second
 * person to register "Convene Notetaker" silently overwrote the first, and
 * nobody would be told. Six base-36 characters put a collision at roughly one in
 * a hundred thousand registrations of the same title, and the routes still
 * re-read before writing to close the sliver that leaves.
 *
 * `random` is a parameter so a test can pin the suffix. Nothing in the app
 * passes it.
 */

/** How much of the title survives into the id. Long enough to recognise, short
 *  enough to read out over a call. */
const SLUG_LENGTH = 48;

export function recordId(
  /** `sys`, `risk`, `fnd`, `asmt` — what the id says it is at a glance. */
  prefix: string,
  /** The title or name the record was created under. May be empty. */
  text: string,
  /** What the slug becomes when the text yields nothing usable. */
  fallback: string,
  random: () => number = Math.random,
): string {
  const slug =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_LENGTH) || fallback;
  const suffix = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `${prefix}-${slug}-${suffix}`;
}
