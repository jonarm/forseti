/**
 * Input hardening for anything that reaches a model prompt.
 *
 * Two separate concerns, deliberately kept apart:
 *
 *   - `cleanText` bounds and de-noises a raw string (length cap, control
 *     characters stripped). This is about keeping prompts from being blown out
 *     by a huge or binary paste.
 *   - `asUntrustedBlock` wraps third-party text in a delimiter the text itself
 *     cannot contain, so pasted policy extracts and customer questions can't
 *     close the block early and be read as instructions.
 */

/** Cap on any single free-text field. Matches the limit applied in /api/org. */
export const MAX_TEXT = 20_000;

/** Cap on a short single-line field (a questionnaire question, a title). */
export const MAX_LINE = 2_000;

/**
 * Drop C0/C1 control characters, keeping tab and newline — both are meaningful
 * in a pasted policy extract, the rest is noise at best. Written as an explicit
 * scan rather than a regex literal so the control codes stay readable in source.
 */
function stripControlChars(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl =
      (code <= 0x1f && ch !== "\t" && ch !== "\n") ||
      (code >= 0x7f && code <= 0x9f);
    if (!isControl) out += ch;
  }
  return out;
}

/**
 * Normalise a free-text value: reject non-strings, collapse Windows line
 * endings, strip control characters, trim, and cap the length.
 */
export function cleanText(value: unknown, max: number = MAX_TEXT): string {
  if (typeof value !== "string") return "";
  return stripControlChars(value.replace(/\r\n/g, "\n")).trim().slice(0, max);
}

/** Same as `cleanText` but also flattens whitespace — for single-line fields. */
export function cleanLine(value: unknown, max: number = MAX_LINE): string {
  return cleanText(value, max).replace(/\s+/g, " ");
}

/**
 * Wrap untrusted text so the model can tell data from instructions.
 *
 * The delimiter is a tag the wrapped text cannot contain: any occurrence of it
 * in the input is defanged first, so anything the user pasted stays inside the
 * block instead of closing it early and being read as a directive.
 */
export function asUntrustedBlock(tag: string, text: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const safe = text.split(open).join(`(${tag})`).split(close).join(`(/${tag})`);
  return `${open}\n${safe}\n${close}`;
}
