import { createRequire } from "node:module";
import { dirname, sep } from "node:path";

/**
 * PDF → text, locally, without spending a token.
 *
 * PDFs used to go to the Files API intact and reach the model as native
 * `document` blocks. That preserved tables, but a `document` block does not just
 * carry the text layer — the API rasterises **every page to an image** and bills
 * for it, so a twenty-page policy cost roughly three times what its words are
 * worth, on every call. Once the questionnaire copilot started attaching evidence
 * to every question, that multiplied by the number of questions asked.
 *
 * Extracting here removes the page images from the bill permanently. What it
 * costs is layout, which is why this file bothers with coordinates instead of
 * concatenating strings: `getTextContent()` gives every fragment a position, so
 * rows can be rebuilt from the vertical axis and columns from the horizontal
 * gaps. A retention schedule stays a schedule, which was the whole argument for
 * sending PDFs natively in the first place.
 *
 * A PDF with no text layer at all — a scan — extracts to nothing. That is not
 * an error here; `processUpload` reads the empty result and falls back to the
 * Files API for that one file. Native mode survives for exactly the case that
 * needs it.
 */

/**
 * Locate an asset directory inside the installed pdfjs-dist.
 *
 * The font and CMap data ship in the package rather than the JS bundle, and
 * pdf.js resolves them at runtime — which is also why `pdfjs-dist` is in
 * `serverExternalPackages`. Resolving from the package's own `package.json`
 * survives hoisting and nesting in a way a relative path into `node_modules`
 * would not.
 *
 * A plain path with forward slashes, **not** a `file://` URL: pdf.js fetches
 * these, and Node's `fetch` does not implement the file scheme, so a URL here
 * fails at runtime with nothing but a warning to show for it. It also validates
 * the trailing slash, and rejects a Windows backslash for being one.
 */
function packageDir(subdirectory: string): string {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("pdfjs-dist/package.json"));
  return `${root.split(sep).join("/")}/${subdirectory}`;
}

/**
 * Page cap.
 *
 * PDFs are parsed locally for the first time in this step, so they need the
 * guard `zip-guard.ts` gives the ZIP formats. A valid 4MB file can declare tens
 * of thousands of pages, and the per-page work is unbounded — the character cap
 * in `extract.ts` would stop the *output* growing but not the parsing. Real
 * policy documents are far under this.
 */
export const MAX_PDF_PAGES = 200;

/** Points of vertical drift still counted as the same baseline. */
const LINE_TOLERANCE = 2;

/** Horizontal whitespace wide enough to read as a column break rather than a space. */
const COLUMN_GAP = 8;

/** Any measurable gap at all, used to avoid welding two words together. */
const WORD_GAP = 1;

/** The fields of pdf.js's `TextItem` this module actually uses. */
export interface PdfTextItem {
  str: string;
  /** 6-element transform matrix; [4] is x, [5] is y, in PDF user space. */
  transform: number[];
  width: number;
}

interface Positioned {
  str: string;
  x: number;
  y: number;
  width: number;
}

/**
 * One row of fragments → one line, with tabs where the columns were.
 *
 * Two different signals, because PDFs produce both. **pdf.js synthesises a
 * whitespace item to span the space between two fragments**, so a table column
 * usually arrives as `{ str: " ", width: 125 }` rather than as a gap — that
 * width is the measurement to read, and it is why naive gap arithmetic finds
 * nothing and flattens every table. Where no such item is emitted, the distance
 * from the end of one fragment to the start of the next says the same thing.
 *
 * Tabs rather than spaces because that is what the `.xlsx` extractor already
 * emits, so a table reads identically to the model whichever format it arrived
 * in.
 */
function joinRow(row: Positioned[]): string {
  const sorted = [...row].sort((a, b) => a.x - b.x);

  let line = "";
  let previousEnd: number | null = null;

  for (const item of sorted) {
    const isGapFiller = item.str.trim().length === 0;

    if (isGapFiller) {
      if (item.width > COLUMN_GAP) {
        if (!line.endsWith("\t")) line += "\t";
      } else if (line.length > 0 && !/\s$/.test(line)) {
        line += " ";
      }
    } else {
      if (previousEnd !== null) {
        const gap = item.x - previousEnd;
        if (gap > COLUMN_GAP) {
          if (!line.endsWith("\t")) line += "\t";
        } else if (gap > WORD_GAP && !/\s$/.test(line) && !item.str.startsWith(" ")) {
          line += " ";
        }
      }
      line += item.str;
    }

    previousEnd = item.x + item.width;
  }

  // A row can end on a gap filler; trailing whitespace is never content.
  return line.replace(/\s+$/, "");
}

/**
 * Text fragments → lines, grouped by baseline.
 *
 * Pure and exported so the layout logic can be tested without a PDF — building
 * a document that exercises a specific column gap is far harder than handing
 * this function three items.
 *
 * PDF user space puts the origin at the bottom-left, so descending y is
 * top-to-bottom reading order. Fragments are tolerated a couple of points of
 * drift before they count as a new line: subscripts, kerning and font-size
 * changes all move the baseline slightly without starting a row.
 */
export function groupItemsIntoLines(items: PdfTextItem[]): string[] {
  const positioned: Positioned[] = items
    .filter((item) => item.str.length > 0)
    .map((item) => ({
      str: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width ?? 0,
    }));

  positioned.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: string[] = [];
  let row: Positioned[] = [];
  let baseline: number | null = null;

  for (const item of positioned) {
    if (baseline === null) {
      baseline = item.y;
    } else if (Math.abs(item.y - baseline) > LINE_TOLERANCE) {
      lines.push(joinRow(row));
      row = [];
      baseline = item.y;
    }
    row.push(item);
  }

  if (row.length > 0) lines.push(joinRow(row));

  return lines.filter((line) => line.trim().length > 0);
}

/**
 * Extract every page's text, up to the page cap.
 *
 * Throws on a malformed or encrypted file rather than returning a reason — the
 * caller in `extract.ts` already wraps this in the timeout and the try/catch
 * that turn a parser failure into a message a user can act on, and pdf.js's
 * `PasswordException` lands on exactly the right one.
 *
 * `useSystemFonts` and `disableFontFace` are off because nothing is being
 * rendered: fonts only matter for drawing glyphs, and loading them from an
 * untrusted file to produce text nobody will look at is work and risk for
 * nothing. (pdf.js v6 removed `isEvalSupported` — the eval-based font path it
 * guarded no longer exists, so there is nothing left to switch off.)
 */
export async function extractPdfText(
  buffer: Buffer,
): Promise<{ text: string; truncated: boolean }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const task = pdfjs.getDocument({
    // A copy, not a view: pdf.js transfers the buffer to its worker and the
    // caller's Buffer can be backed by a pooled ArrayBuffer it does not own.
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    // Both are needed even though nothing is drawn. The standard-font metrics
    // give `item.width` its real value, and column detection is entirely a
    // question of how wide the previous fragment was; the CMaps are what make a
    // non-Latin document extract as text rather than as mojibake.
    standardFontDataUrl: packageDir("standard_fonts/"),
    cMapUrl: packageDir("cmaps/"),
    cMapPacked: true,
  });

  const doc = await task.promise;

  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    const lines: string[] = [];

    for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        // `items` also carries marked-content markers, which have no `str`.
        // Narrow to pdf.js's own `TextItem` — it is a superset of what
        // `PdfTextItem` declares, which is only the fields this module reads.
        const text = content.items.filter(
          (item): item is Extract<typeof item, { str: string }> => "str" in item,
        );
        lines.push(...groupItemsIntoLines(text));
      } finally {
        page.cleanup();
      }
    }

    return { text: lines.join("\n"), truncated: doc.numPages > MAX_PDF_PAGES };
  } finally {
    // On the *loading task*, not the document — `PDFDocumentProxy` only offers
    // `cleanup()`, which frees page resources but leaves the worker running.
    // Without this a long-lived server leaks a worker per upload.
    await task.destroy();
  }
}
