import { toFile } from "@anthropic-ai/sdk";

import { anthropic, FILES_BETA } from "../anthropic";
import { extractText } from "./extract";
import { ACCEPTED_DESCRIPTION, sniff, type EvidenceKind } from "./sniff";
import { inspectZip } from "./zip-guard";

/**
 * The upload pipeline, in the order the checks have to happen.
 *
 * Each step narrows what the next one is allowed to touch, and the ordering is
 * the security property: nothing is parsed before it has been identified, and
 * nothing is decompressed before its declared expansion has been checked.
 *
 *   1. size      — cheapest possible rejection, before anything is read
 *   2. sniff     — what IS this, by its bytes, not its name
 *   3. zip guard — for the ZIP formats, is it a bomb (no decompression yet)
 *   4. extract   — parse under a timeout, cap the output
 *   5. upload    — PDFs only, and only the ones step 4 could not read at all
 *
 * Every failure is a `reason` a user can act on, never a thrown error. A hostile
 * file is an expected input here; a 500 would mean the attacker won something.
 */

/**
 * Per-file cap.
 *
 * Vercel's serverless request-body limit is around 4.5MB, so a larger cap would
 * fail at the platform with an unexplained error instead of a message. Real
 * policy documents are far under this.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * A document the pipeline has accepted, ready for a caller to persist.
 *
 * Exactly one of `extractedText` and `anthropicFileId` is set. Everything is
 * extracted to text at upload and the original bytes discarded; the Files API
 * survives only as the fallback below, for a PDF that yielded no text at all.
 *
 * It carries no owning record. What a document evidences is the caller's to
 * decide and the caller's to store; the pipeline only cares about the bytes.
 */
export interface ProcessedUpload {
  filename: string;
  mediaType: string;
  kind: EvidenceKind;
  sizeBytes: number;
  /** Set for docx/xlsx/text. Null for PDFs. */
  extractedText: string | null;
  /** Set for PDFs. Null otherwise. */
  anthropicFileId: string | null;
}

export type ProcessResult =
  | { ok: true; file: ProcessedUpload; truncated: boolean }
  | { ok: false; reason: string };

/**
 * Make a client-supplied filename safe to store and display.
 *
 * Filenames are attacker-controlled. This one is only ever rendered in the UI
 * and written into the trust package — never used to open anything on disk — so
 * the goal is to keep it recognisable while removing anything that could be
 * read as structure: directory traversal, and control characters that could
 * corrupt a log line or a rendered document.
 */
export function safeFilename(name: string): string {
  // Take the last path segment, so "../../etc/passwd" becomes "passwd".
  const base = name.split(/[\\/]/).pop() ?? "";

  let cleaned = "";
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    if (!isControl) cleaned += ch;
  }

  return cleaned.trim().slice(0, 200) || "document";
}

/** Validate and process one uploaded document. */
export async function processUpload(
  filename: string,
  buffer: Buffer,
): Promise<ProcessResult> {
  if (buffer.length === 0) {
    return { ok: false, reason: "That file is empty." };
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    const mb = (MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0);
    return {
      ok: false,
      reason: `That file is larger than ${mb}MB. Upload the relevant extract rather than the whole document.`,
    };
  }

  const sniffed = sniff(buffer);
  if (!sniffed) {
    return {
      ok: false,
      reason: `That file type isn't supported. Upload a ${ACCEPTED_DESCRIPTION}.`,
    };
  }

  // The ZIP formats get the bomb check before any parser sees them.
  if (sniffed.kind === "docx" || sniffed.kind === "xlsx") {
    const zip = inspectZip(buffer);
    if (!zip.ok) return { ok: false, reason: zip.reason };
  }

  const base = {
    filename: safeFilename(filename),
    mediaType: sniffed.mediaType,
    kind: sniffed.kind,
    sizeBytes: buffer.length,
  };

  const extracted = await extractText(buffer, sniffed.kind, base.filename);

  if (extracted.ok) {
    return {
      ok: true,
      truncated: extracted.truncated,
      file: { ...base, extractedText: extracted.text, anthropicFileId: null },
    };
  }

  /*
   * A PDF that yielded no text is almost always a scan — an image of a document
   * rather than a document. That is the one case local extraction genuinely
   * cannot serve, so it falls back to the Files API and reaches the model as a
   * native `document` block, which can read the page as a picture.
   *
   * Only PDFs, and only on failure. Every other format either extracts or is
   * not evidence, and a native block costs an image of every page — worth it
   * for the alternative being nothing at all, not worth it by default.
   */
  if (sniffed.kind !== "pdf") {
    return { ok: false, reason: extracted.reason };
  }

  const uploaded = await uploadPdf(base.filename, buffer);
  if (!uploaded.ok) return uploaded;

  return {
    ok: true,
    truncated: false,
    file: { ...base, extractedText: null, anthropicFileId: uploaded.fileId },
  };
}

/**
 * Send a PDF to the Files API so it can be referenced as a `document` block.
 *
 * The fallback path only. A native block bills for a rasterised image of every
 * page on top of the text, so this is reserved for the file that has no text to
 * extract — a scan, where the image is the entire document and the alternative
 * is rejecting evidence the user plainly has.
 */
async function uploadPdf(
  filename: string,
  buffer: Buffer,
): Promise<{ ok: true; fileId: string } | { ok: false; reason: string }> {
  try {
    const client = anthropic();
    const uploaded = await client.beta.files.upload({
      file: await toFile(buffer, filename, { type: "application/pdf" }),
      betas: [FILES_BETA],
    });
    return { ok: true, fileId: uploaded.id };
  } catch (err) {
    console.error("[evidence] PDF upload failed", err);
    return { ok: false, reason: "Could not store that PDF. Please try again." };
  }
}

/**
 * Best-effort removal of the Files API copy when evidence is deleted.
 *
 * Deliberately swallows failures: the database row is already gone, so from the
 * user's point of view the document has been removed. A leaked file in the
 * Files API is a cleanup problem, not a reason to fail their delete.
 */
export async function deleteUploadedPdf(fileId: string): Promise<void> {
  try {
    const client = anthropic();
    await client.beta.files.delete(fileId, { betas: [FILES_BETA] });
  } catch (err) {
    console.error("[evidence] Files API delete failed (row already removed)", err);
  }
}

export { MAX_EXTRACTED_CHARS } from "./extract";
export { ACCEPTED_DESCRIPTION } from "./sniff";
