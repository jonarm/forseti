import { cleanText } from "../sanitize";
import { extractPdfText } from "./pdf";
import type { EvidenceKind } from "./sniff";

/**
 * Turning an uploaded document into text the model can read.
 *
 * Every accepted format is parsed here, locally, with a library — no format
 * reaches the model as raw bytes any more. PDFs used to be the exception,
 * shipped to the Files API intact so Claude could read their layout natively,
 * but a native `document` block bills for an image of every page as well as its
 * text. Extracting is several times cheaper and, with `pdf.ts` reconstructing
 * rows from fragment coordinates, gives up much less than it first appears.
 * A scan with no text layer still falls back to native — see `index.ts`.
 *
 * This is also the second and third layers of the bomb defence. `zip-guard.ts`
 * checks what the archive *claims*; these limits contain it if the claim was a
 * lie:
 *
 *   - a wall-clock timeout, because a malicious archive can be slow rather than
 *     large, and a wedged parse holds a serverless function until it is killed;
 *   - a cap on extracted text, because the output is what actually reaches the
 *     prompt, and an unbounded one is a bill as much as a crash.
 */

/** Long enough for a real policy; short enough not to dominate a prompt. */
export const MAX_EXTRACTED_CHARS = 60_000;

/** A legitimate document parses in well under a second. */
export const PARSE_TIMEOUT_MS = 10_000;

export type ExtractResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: string };

/**
 * Bound a parse in wall-clock time.
 *
 * The parser keeps running after a timeout — there is no way to cancel it — but
 * the request stops waiting, so a slow file degrades to a rejected upload rather
 * than a hung route. That is the honest trade available here.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * `alreadyTruncated` carries a cut the parser made before we saw the text — the
 * PDF page cap being the only one today. Without it a 500-page document that
 * stopped at page 200 would report itself complete purely because the 200 pages
 * fitted inside the character budget.
 */
function finalise(raw: string, alreadyTruncated = false): ExtractResult {
  // Same sanitiser every other user-supplied string goes through: control
  // characters out, CRLF normalised. The caller wraps the result in an
  // untrusted block before it reaches a prompt.
  const cleaned = cleanText(raw, MAX_EXTRACTED_CHARS);

  if (!cleaned.trim()) {
    return {
      ok: false,
      reason: "No readable text was found in this document.",
    };
  }

  return {
    ok: true,
    text: cleaned,
    truncated: alreadyTruncated || raw.length > MAX_EXTRACTED_CHARS,
  };
}

/** PDF → text, with rows and columns rebuilt from fragment coordinates. */
async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  const { text, truncated } = await extractPdfText(buffer);
  return finalise(text, truncated);
}

/**
 * CSV → the same tab-separated rows the spreadsheet extractor produces.
 *
 * Without this a CSV still works — `sniff.ts` classifies it as text and it is
 * read raw — but it reaches the model as comma soup, and a retention schedule
 * is exactly the kind of evidence people export as CSV. Aligning it with the
 * `.xlsx` output means a table reads the same whichever way it arrived.
 *
 * Returns null when the file does not parse as delimited data, so the caller can
 * fall back to treating it as the plain text it evidently is.
 */
async function formatCsv(raw: string): Promise<string | null> {
  const Papa = (await import("papaparse")).default;

  const parsed = Papa.parse<string[]>(raw, { skipEmptyLines: true });
  if (parsed.data.length === 0) return null;

  const rows = parsed.data.filter((row) => row.some((cell) => cell.trim()));
  if (rows.length === 0) return null;

  // A single column is not a table; it is a list, and tabs would imply
  // structure that is not there.
  if (rows.every((row) => row.length < 2)) return null;

  return rows.map((row) => row.map((cell) => cell.trim()).join("\t")).join("\n");
}

/** Word document → plain text, via mammoth's raw-text converter. */
async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  const mammoth = await import("mammoth");
  // `extractRawText` rather than `convertToHtml`: the model wants the prose,
  // and HTML would add markup that reads as structure the document may not have.
  const result = await mammoth.extractRawText({ buffer });
  return finalise(result.value);
}

/**
 * Spreadsheet → text, one line per row, sheet names as headers.
 *
 * Cells are joined with a tab so column structure survives — a retention
 * schedule is a table, and "Behavioural events | 90 days" is a finding while
 * the same words unseparated are noise.
 */
async function extractXlsx(buffer: Buffer): Promise<ExtractResult> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  // Uint8Array view rather than the Buffer: exceljs types the argument as an
  // ArrayBuffer-like, and passing a pooled Buffer can hand it a shared backing.
  await workbook.xlsx.load(new Uint8Array(buffer) as unknown as ArrayBuffer);

  const lines: string[] = [];
  let budget = MAX_EXTRACTED_CHARS;

  for (const sheet of workbook.worksheets) {
    lines.push(`--- Sheet: ${sheet.name} ---`);

    // eachRow skips empty rows, which is what we want — a spreadsheet's blank
    // tail is not content.
    sheet.eachRow((row) => {
      if (budget <= 0) return;

      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.text?.trim();
        if (value) cells.push(value);
      });

      if (cells.length > 0) {
        const line = cells.join("\t");
        lines.push(line);
        budget -= line.length;
      }
    });
  }

  return finalise(lines.join("\n"));
}

/** Is this text file a CSV? The only question in this module the bytes cannot answer. */
function looksLikeCsvName(filename: string | undefined): boolean {
  return /\.(csv|tsv)$/i.test(filename ?? "");
}

/**
 * Extract text from a document, or explain why we could not.
 *
 * Never throws. A corrupt or hostile file is an expected input here, not an
 * exceptional one, and the route must be able to answer it with a 400 rather
 * than a 500.
 *
 * `filename` is a **deliberate exception** to `sniff.ts`'s rule that the name is
 * never trusted. It selects a formatter and nothing else: the bytes have already
 * been confirmed as text, so a lie about the extension changes how a table is
 * spaced and cannot change what gets parsed or whether it is safe to parse.
 */
export async function extractText(
  buffer: Buffer,
  kind: EvidenceKind,
  filename?: string,
): Promise<ExtractResult> {
  if (kind === "text") {
    const raw = buffer.toString("utf8");

    if (looksLikeCsvName(filename)) {
      try {
        const table = await withTimeout(formatCsv(raw), PARSE_TIMEOUT_MS);
        if (table) return finalise(table);
      } catch (err) {
        // Fall through to raw text: this is a formatting nicety, and a file we
        // can already read should never be rejected because it did not happen
        // to be a well-formed table.
        console.error("[evidence] CSV formatting failed, using raw text", err);
      }
    }

    return finalise(raw);
  }

  try {
    const work =
      kind === "pdf"
        ? extractPdf(buffer)
        : kind === "docx"
          ? extractDocx(buffer)
          : extractXlsx(buffer);
    const result = await withTimeout(work, PARSE_TIMEOUT_MS);

    if (result === null) {
      return {
        ok: false,
        reason:
          "This document took too long to read. It may be corrupt or unusually complex.",
      };
    }

    return result;
  } catch (err) {
    // Malformed input reaches here as a throw from the parser. Log for
    // diagnosis; tell the user something they can act on.
    console.error(`[evidence] ${kind} extraction failed`, err);
    return {
      ok: false,
      reason: "This document could not be read. It may be corrupt or password-protected.",
    };
  }
}
