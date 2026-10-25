/**
 * What a file actually is, by its bytes.
 *
 * The filename and the browser-supplied Content-Type are both attacker
 * controlled — renaming `payload.exe` to `policy.pdf` costs nothing — so
 * neither is trusted for anything but display. Every accepted format has an
 * unambiguous magic number, and a file that does not start with one is rejected
 * before any parser touches it.
 *
 * This does not make a file safe. It narrows what we are willing to hand to a
 * parser, which is a different and more achievable goal: see `zip-guard.ts` for
 * what happens once we know something is a ZIP.
 */

export type EvidenceKind = "pdf" | "docx" | "xlsx" | "text";

export interface SniffResult {
  kind: EvidenceKind;
  /** The media type we will store and, for PDFs, send to the Files API. */
  mediaType: string;
}

/** `%PDF-` — the only valid start of a PDF. */
const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

/**
 * `PK\x03\x04` — a local file header, i.e. a non-empty ZIP.
 *
 * `.docx` and `.xlsx` are both ZIP containers, so the magic number alone cannot
 * tell them apart; the entry names inside can. The two empty-archive variants
 * (`PK\x05\x06`, `PK\x07\x08`) are deliberately not accepted — an evidence
 * document with no entries is not evidence.
 */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Entry names that identify which Office format a ZIP contains. */
const DOCX_MARKER = "word/";
const XLSX_MARKER = "xl/";

export const MEDIA_TYPES: Record<EvidenceKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  text: "text/plain",
};

function startsWith(buffer: Buffer, magic: Buffer): boolean {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic);
}

/**
 * Is this plausibly UTF-8 text a human wrote?
 *
 * Deliberately conservative. A NUL byte means binary; a high proportion of
 * control characters means binary wearing a `.txt` extension. Text evidence is
 * a convenience (pasted policies, exported Markdown), so refusing an unusual
 * file costs little and accepting a binary one costs a confused prompt.
 */
function looksLikeText(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return false;

  let control = 0;
  for (const byte of sample) {
    // Tab, newline and carriage return are expected; the rest of C0 is not.
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) control++;
  }
  return control / sample.length < 0.01;
}

/**
 * Identify a ZIP as .docx or .xlsx by looking for a known entry name.
 *
 * Reads the raw bytes rather than parsing the archive: at this point the file is
 * still untrusted, and the question ("which of two formats is this?") does not
 * justify decompressing anything. Both markers appear in the first entries of a
 * well-formed Office file, so a bounded scan of the head is enough.
 */
function classifyZip(buffer: Buffer): EvidenceKind | null {
  const head = buffer.subarray(0, Math.min(buffer.length, 64 * 1024)).toString("latin1");
  if (head.includes(DOCX_MARKER)) return "docx";
  if (head.includes(XLSX_MARKER)) return "xlsx";
  return null;
}

/**
 * Determine the kind of an uploaded file from its content.
 *
 * Returns null when the bytes match nothing we accept — the caller turns that
 * into a rejection naming the formats we do take.
 */
export function sniff(buffer: Buffer): SniffResult | null {
  if (startsWith(buffer, PDF_MAGIC)) {
    return { kind: "pdf", mediaType: MEDIA_TYPES.pdf };
  }

  if (startsWith(buffer, ZIP_MAGIC)) {
    const kind = classifyZip(buffer);
    return kind ? { kind, mediaType: MEDIA_TYPES[kind] } : null;
  }

  if (looksLikeText(buffer)) {
    return { kind: "text", mediaType: MEDIA_TYPES.text };
  }

  return null;
}

/** Human-readable list for error messages, kept next to the thing it describes. */
export const ACCEPTED_DESCRIPTION =
  "PDF, Word (.docx), Excel (.xlsx), CSV, or plain text";
