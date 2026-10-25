/**
 * Taking a document into the evidence register.
 *
 * The upload pipeline's first three steps and deliberately not its fourth.
 * `processUpload` ends by sending a PDF with no text layer to the Files API so
 * a *model* can read it as a picture; nothing in the evidence register asks a
 * model anything, so that step would spend money on a file id this product has
 * nowhere to put — `Evidence` has no field for one.
 *
 * So a scan is **accepted with no preview** rather than rejected or uploaded. A
 * scanned certificate is still evidence: the register's job is to record that
 * the document exists, who collected it and what it backs. Refusing it because
 * we could not read its text would be the register refusing the commonest form
 * real evidence arrives in.
 *
 * The hardening order is the one every upload path here follows and is the
 * security property: nothing is parsed before it has been identified by its
 * bytes, and nothing is decompressed before its declared expansion has been
 * checked.
 *
 *   1. size      — cheapest possible rejection, before anything is read
 *   2. sniff     — what IS this, by its bytes, not its name
 *   3. zip guard — for the ZIP formats, is it a bomb (no decompression yet)
 *   4. extract   — parse under a timeout, cap the output
 *
 * Every failure is a `reason` a person can act on, never a thrown error. A
 * hostile file is an expected input here; a 500 would mean the attacker won.
 */
import { extractText } from "./extract";
import { ACCEPTED_DESCRIPTION, sniff, type EvidenceKind } from "./sniff";
import { inspectZip } from "./zip-guard";
import { MAX_UPLOAD_BYTES, safeFilename } from "./index";

export interface IngestedDocument {
  filename: string;
  mediaType: string;
  kind: EvidenceKind;
  sizeBytes: number;
  /**
   * What the document says, or null when it had no text to give.
   *
   * Null means a scan — an image of a document rather than a document. The
   * record still stands; it simply carries no preview, and the register says
   * so rather than showing an empty box that reads as a bug.
   */
  text: string | null;
  /** True when the extractor stopped early. The preview is a prefix, not the whole. */
  truncated: boolean;
}

export type IngestResult =
  | { ok: true; document: IngestedDocument }
  | { ok: false; reason: string };

export async function ingestDocument(
  filename: string,
  buffer: Buffer,
): Promise<IngestResult> {
  if (buffer.length === 0) {
    return { ok: false, reason: "That file is empty." };
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    const mb = (MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0);
    return {
      ok: false,
      reason: `Larger than ${mb}MB. Upload the relevant extract rather than the whole document.`,
    };
  }

  const sniffed = sniff(buffer);
  if (!sniffed) {
    return {
      ok: false,
      reason: `Not a file type we accept. Upload a ${ACCEPTED_DESCRIPTION}.`,
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
      document: { ...base, text: extracted.text, truncated: extracted.truncated },
    };
  }

  /*
   * A PDF that yielded nothing is a scan, and a scan is evidence. Every other
   * format failing extraction means the file is corrupt or password-protected —
   * that we do refuse, because an unreadable .docx is not a document somebody
   * meant to file.
   */
  if (sniffed.kind === "pdf") {
    return { ok: true, document: { ...base, text: null, truncated: false } };
  }

  return { ok: false, reason: extracted.reason };
}
