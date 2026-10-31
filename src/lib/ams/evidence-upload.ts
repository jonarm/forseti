/**
 * A file somebody uploaded, become an evidence record.
 *
 * The evidence register's "import" is not the column mapper the other registers
 * use — it is documents, and a document has no columns. What it shares with the
 * mapper is the rule that matters: **nothing is invented.** A field the file
 * cannot answer is left in a state that reads as unanswered rather than filled
 * with something plausible.
 *
 * **The bytes are not kept.** The pipeline extracts text on ingest and discards
 * the file, which is this product's documented behaviour for every upload path.
 * So `href` is empty and the record carries a preview rather than a download —
 * and the register says so, because a document row offering a link that goes
 * nowhere is worse than one that admits it has no copy.
 */
import type { Evidence, EvidenceFileRef, EvidenceType } from "./types";

/** Leave multipart overhead below Vercel's function request-body ceiling. */
export const MAX_UPLOAD_BATCH_BYTES = 4 * 1024 * 1024;

/** The words a filename uses when it is telling you what kind of document it is. */
const TYPE_WORDS: Record<string, EvidenceType> = {
  policy: "policy",
  standard: "policy",
  procedure: "policy",
  screenshot: "screenshot",
  screen: "screenshot",
  config: "configuration_export",
  configuration: "configuration_export",
  export: "configuration_export",
  settings: "configuration_export",
  minutes: "meeting_minutes",
  meeting: "meeting_minutes",
  contract: "contract",
  agreement: "contract",
  dpa: "contract",
  msa: "contract",
  test: "test_result",
  results: "test_result",
  pentest: "test_result",
  training: "training_record",
  certificate: "training_record",
  log: "log_extract",
  logs: "log_extract",
  audit: "log_extract",
};

/**
 * What the filename suggests this is, or null when it suggests nothing.
 *
 * Null rather than a default on purpose: the dialog asks for a type once and
 * applies it to the batch, and seeding that select from a guess is only helpful
 * while the guess is grounded. Defaulting every unrecognised file to "policy"
 * would fill a register with a claim nobody made.
 */
export function guessEvidenceType(filename: string): EvidenceType | null {
  const words = filename.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const word of words) {
    const match = TYPE_WORDS[word];
    if (match) return match;
  }
  return null;
}

/** A title a person would recognise: the filename without its extension. */
export function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[a-z0-9]{1,8}$/i, "");
  const spaced = withoutExtension.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced || filename;
}

function newEvidenceId(title: string, random = Math.random): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "evidence";
  const suffix = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `ev-${slug}-${suffix}`;
}

/** How much of a document's text the record keeps as a preview. */
export const PREVIEW_CHARS = 2_000;

export interface UploadedDocument {
  filename: string;
  mediaType: string;
  kind: "pdf" | "docx" | "xlsx" | "text";
  sizeBytes: number;
  text: string | null;
  truncated: boolean;
}

/**
 * The record a document becomes.
 *
 * **Unverified, always.** Somebody uploading a file is asserting that it exists,
 * not that it has been checked — and verification is what makes a piece of
 * evidence count towards coverage. A register that marked its own uploads
 * verified would raise a score by the act of filing.
 *
 * **Linked to nothing, always.** What a document is offered as proof of is a
 * judgement, and the upload cannot make it: a file called
 * `access-review-q1.pdf` might back three controls or none. It arrives
 * unlinked, which shows on the register as a document backing nothing — the
 * work still to do, visible rather than guessed at.
 */
export function evidenceFromUpload(
  document: UploadedDocument,
  type: EvidenceType,
  ownerId: string,
  now: Date,
  /**
   * The system this document was filed against, when it was uploaded from one
   * system's own Evidence tab rather than the register.
   *
   * The one link an upload can make honestly. What a document *proves* is a
   * judgement — it stays unverified and linked to no control — but which system
   * somebody filed it against is not inferred from the bytes, it is the screen
   * they were standing on. Without it the upload would succeed and the tab that
   * offered the button would still read as having no evidence.
   */
  linkedSystemId?: string,
): Evidence {
  const title = titleFromFilename(document.filename);

  const file: EvidenceFileRef = {
    name: document.filename,
    kind: document.kind === "pdf" ? "pdf" : "text",
    mime: document.mediaType,
    sizeKb: Math.max(1, Math.round(document.sizeBytes / 1024)),
    /* Empty because there is nothing to serve. The bytes were discarded at
     * ingest, and a link that goes nowhere is worse than an admitted absence. */
    href: "",
    ...(document.text
      ? { preview: document.text.slice(0, PREVIEW_CHARS) }
      : {}),
  };

  return {
    id: newEvidenceId(title),
    title,
    type,
    ownerId,
    source: "Uploaded",
    collectedAt: now.toISOString().slice(0, 10),
    expiresAt: null,
    verificationState: "unverified",
    linkedControlIds: [],
    linkedSystemIds: linkedSystemId ? [linkedSystemId] : [],
    file,
  };
}
