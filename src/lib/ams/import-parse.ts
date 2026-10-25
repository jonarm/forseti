/**
 * A spreadsheet somebody actually keeps, turned into rows this app can plan.
 *
 * The import used to open on a fixture: the drop zone waited 800ms and then
 * previewed nine hard-coded rows, so the mapping, the warnings and the apply
 * were all real and the *file* was not. This is the missing half — bytes in,
 * headers and rows out — and it is deliberately the only thing in here. What
 * the rows mean is the register's own `ImportSpec`; where they land is the route.
 *
 * **Nothing is parsed before it has been identified.** The same sequence the
 * evidence pipeline uses, for the same reason: `sniff()` reads magic bytes
 * rather than the filename, and an `.xlsx` goes through `inspectZip()` before
 * exceljs is allowed near it. A 42KB archive that claims to expand to gigabytes
 * is the cheapest way to take a serverless function down, and the upload cap
 * does not catch it.
 *
 * **Over the cap is a rejection, never a truncation.** The apply route refuses
 * more than 500 rows, and a 900-row file that quietly imported the first 500
 * would be the "import that silently dropped rows" its own comment calls the
 * worst possible outcome for a register. So the caps live here, are named in
 * the refusal, and are the same numbers the route enforces on the way back in.
 *
 * **A column is never silently lost.** Real exports have blank headers and
 * repeated ones; `ImportRawRow` is a flat object, so two columns called "Notes"
 * would collapse into one and the second would overwrite the first with nobody
 * told. Blanks are named for their spreadsheet letter and repeats are numbered,
 * which keeps every column addressable and visible in the mapping table.
 *
 * Never throws. A corrupt or hostile file is an expected input to an importer,
 * not an exceptional one, and the route has to answer it with a 400.
 */
import type { ImportRawRow } from "./types";
import { cleanLine } from "../sanitize";
import { sniff } from "../evidence/sniff";
import { inspectZip } from "../evidence/zip-guard";

/**
 * Per-file cap.
 *
 * Deliberately the same 4MB as the evidence pipeline, and for the same reason
 * rather than by sharing its constant: the serverless request-body limit is
 * around 4.5MB, so a larger cap fails at the platform with an unexplained error
 * instead of a message somebody can act on. A 500-row tracker is nowhere near
 * it — this is the bound on nonsense, not on real files.
 */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** A spreadsheet larger than this is a conversation, not a form submission. */
export const MAX_ROWS = 500;
export const MAX_COLUMNS = 60;
export const MAX_CELL = 500;

/** A legitimate tracker parses in well under a second. */
export const PARSE_TIMEOUT_MS = 10_000;

/** How many columns we are willing to read before the cap is applied. */
const READ_WIDTH = MAX_COLUMNS * 4;

export interface ParsedSheet {
  filename: string;
  /** Header names in file order — the keys of every row below. */
  columns: string[];
  rows: ImportRawRow[];
  /**
   * The row number each parsed row had in the source file.
   *
   * Carried rather than derived, because the preview's whole promise is that a
   * warning can be traced back to a line in somebody's own spreadsheet. Blank
   * rows are skipped on the way in, so "header plus index" drifts the moment a
   * file has a spacer row in it — which real ones do.
   */
  lines: number[];
}

export type ParseResult =
  | { ok: true; sheet: ParsedSheet }
  | { ok: false; reason: string };

/** One row as it came out of a parser, before we decide what a header is. */
interface GridRow {
  line: number;
  cells: string[];
}

/**
 * A grid, or the reason the file could not honestly become one.
 *
 * The second case exists because a parser can *succeed* on a broken file and
 * hand back the wrong number of rows, which is worse than throwing.
 */
type GridResult = GridRow[] | { reason: string };

const ACCEPTED = "Upload a CSV or an Excel (.xlsx) spreadsheet.";

/**
 * Bound a parse in wall-clock time.
 *
 * The parser keeps running after a timeout — there is no way to cancel it — but
 * the request stops waiting, so a slow file degrades to a rejected upload rather
 * than a hung route. The same trade `evidence/extract.ts` documents.
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
 * Text, with the byte-order mark Excel writes taken off the front.
 *
 * "CSV UTF-8" is the export a Windows user reaches for, and it prefixes the
 * file with `EF BB BF`. Left in place that becomes part of the first header —
 * `\uFEFFTool` — which reads as "Tool" on screen and matches nothing, so the
 * mapping banner announces that no column is mapped to system name on the
 * commonest input this feature has. Stripped explicitly rather than relying on
 * a `trim()` further down to happen to treat it as whitespace.
 */
function decodeText(buffer: Buffer): string {
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

/** A1-style column letters, so a blank header can be named the way a spreadsheet names it. */
export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/**
 * Header cells, become names that are unique and non-empty.
 *
 * Both repairs are visible on purpose. A column called "Column D" tells somebody
 * their header row has a gap in it; a second "Notes (2)" tells them they have
 * two of those. Rejecting the file instead would be defensible, but a header row
 * with one blank cell is an ordinary export, not a broken one.
 */
function headerNames(cells: string[]): string[] {
  // Trailing empties are the spreadsheet's blank tail, not columns.
  let width = cells.length;
  while (width > 0 && !cells[width - 1]?.trim()) width--;

  const names: string[] = [];
  const used = new Map<string, number>();

  for (let i = 0; i < width; i++) {
    const base = cleanLine(cells[i], 200) || `Column ${columnLetter(i)}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    names.push(seen === 0 ? base : `${base} (${seen + 1})`);
  }

  return names;
}

/**
 * The delimiters a one-column sheet might really be hiding.
 *
 * Tried in order and scored, rather than guessed once: this runs precisely when
 * whatever produced the file already failed to work the delimiter out.
 */
const RESPLIT_DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * A sheet whose every row is one long cell, split back into columns.
 *
 * The file that prompted this was an `.xlsx` holding a CSV: fifteen headers and
 * twenty-six fields per row, all of it sitting in column A because nothing had
 * ever split it. Excel does this to a comma file opened under a semicolon
 * locale, and pasting CSV into a sheet does it too. The parser was right that
 * the sheet had one column, and being right was useless — the mapping screen
 * said no column is mapped to system name while the person could plainly read
 * their own headers in the cell.
 *
 * The repair is narrow on purpose. It only runs when *every* row is empty past
 * the first cell, it only accepts a delimiter that yields more than one field on
 * essentially every row, and it refuses if the split changes the row count —
 * which is what a quoted newline would do, and the one way this could invent
 * rows that are not in the file. A genuine single-column list of tool names has
 * no delimiter that qualifies, so it passes through untouched.
 *
 * Line numbers are carried across from the rows they came from, because the
 * split changes what a row contains and not where it lives.
 */
async function resplitSingleColumn(grid: GridRow[]): Promise<GridRow[]> {
  const content = grid.filter((row) => row.cells.some((cell) => cell.trim()));
  if (content.length < 2) return grid;

  // Anything in a second column means the sheet is already split.
  if (content.some((row) => row.cells.slice(1).some((cell) => cell.trim()))) {
    return grid;
  }

  const text = content.map((row) => row.cells[0] ?? "").join("\n");
  const Papa = (await import("papaparse")).default;

  let best: { cells: string[][]; width: number } | null = null;

  for (const delimiter of RESPLIT_DELIMITERS) {
    const parsed = Papa.parse<string[]>(text, { delimiter });
    if (parsed.errors.some((error) => error.type === "Quotes")) continue;

    const rows = parsed.data;
    // A quoted newline would make the split disagree with the sheet about how
    // many rows there are. We do not guess which reading is right; we decline.
    if (rows.length !== content.length) continue;

    const splitEverywhere = rows.every((row) => row.length > 1);
    if (!splitEverywhere) continue;

    const width = Math.max(...rows.map((row) => row.length));
    if (!best || width > best.width) best = { cells: rows, width };
  }

  if (!best) return grid;

  return content.map((row, i) => ({
    line: row.line,
    cells: best.cells[i].slice(0, READ_WIDTH).map(String),
  }));
}

/**
 * A grid, judged as a spreadsheet: first row of content is the header.
 *
 * Leading blank rows are skipped rather than treated as an empty header, because
 * an export with a title row above the table is common and the alternative is
 * rejecting a file whose header is plainly visible one line further down.
 */
function toSheet(grid: GridRow[], filename: string): ParseResult {
  const content = grid.filter((row) => row.cells.some((cell) => cell.trim()));

  if (content.length === 0) {
    return { ok: false, reason: "That file has no rows in it." };
  }

  const [header, ...body] = content;
  const columns = headerNames(header.cells);

  if (columns.length === 0) {
    return {
      ok: false,
      reason: "The first row of that file is empty, so there are no column headers to map.",
    };
  }
  if (columns.length > MAX_COLUMNS) {
    return {
      ok: false,
      reason: `That file has ${columns.length} columns; we read at most ${MAX_COLUMNS}. Remove the columns you do not need and upload it again.`,
    };
  }
  if (body.length === 0) {
    return {
      ok: false,
      reason: "That file has a header row and nothing under it.",
    };
  }
  if (body.length > MAX_ROWS) {
    return {
      ok: false,
      reason: `That file has ${body.length} rows; we import at most ${MAX_ROWS} at a time. Split it and upload the parts separately — importing the first ${MAX_ROWS} and dropping the rest silently is not something we will do to a register.`,
    };
  }

  const rows = body.map((row) => {
    const record: ImportRawRow = {};
    columns.forEach((column, i) => {
      record[column] = cleanLine(row.cells[i] ?? "", MAX_CELL);
    });
    return record;
  });

  return {
    ok: true,
    sheet: { filename, columns, rows, lines: body.map((row) => row.line) },
  };
}

/**
 * CSV → a grid.
 *
 * `skipEmptyLines: false` because a blank line still occupies a row number, and
 * the number is what somebody looks for when they go back to their file. The
 * blanks are dropped in `toSheet`, after they have been counted.
 *
 * The delimiter is detected rather than assumed: exports arrive comma, tab and
 * semicolon separated, and papaparse already knows how to tell.
 */
async function csvGrid(raw: string): Promise<GridResult> {
  const Papa = (await import("papaparse")).default;

  const parsed = Papa.parse<string[]>(raw, { skipEmptyLines: false });

  /*
   * The one papaparse complaint we refuse on.
   *
   * A single unterminated quote makes it swallow the rest of the file into one
   * field, and it says so in `errors` while still returning data — so a 200-row
   * tracker comes back as three rows and the preview reports "3 rows detected"
   * with complete confidence. That is the silent loss this whole module exists
   * to prevent, arriving through the parser rather than around it.
   *
   * `FieldMismatch` is deliberately not refused: rows shorter or longer than
   * the header are ordinary in a hand-kept spreadsheet, and `toSheet` fills the
   * gaps with blanks. Rejecting those would turn away real files to no purpose.
   */
  const quotes = parsed.errors.find((error) => error.type === "Quotes");
  if (quotes) {
    const line = typeof quotes.row === "number" ? quotes.row + 1 : null;
    return {
      reason: `There is an unclosed quotation mark${line ? ` around line ${line}` : ""} of that file, so we cannot tell where its rows end. Fix the quote and upload it again — reading it as-is would drop most of the file without saying so.`,
    };
  }

  return parsed.data.map((cells, i) => ({
    line: i + 1,
    cells: (Array.isArray(cells) ? cells : []).slice(0, READ_WIDTH).map(String),
  }));
}

/**
 * XLSX → a grid, from the first sheet that has anything in it.
 *
 * One sheet rather than all of them: an inventory is a table, and stacking three
 * sheets with different headers into one row set would invent a file nobody
 * uploaded. The first populated sheet is the one a person means when they say
 * "my tracker".
 *
 * `row.number` is the true sheet row, which is why the line numbers survive a
 * file with blank rows in the middle — `eachRow` skips those.
 */
async function xlsxGrid(buffer: Buffer): Promise<GridRow[]> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  // Uint8Array view rather than the Buffer: exceljs types the argument as an
  // ArrayBuffer-like, and passing a pooled Buffer can hand it a shared backing.
  await workbook.xlsx.load(new Uint8Array(buffer) as unknown as ArrayBuffer);

  const sheet =
    workbook.worksheets.find((s) => s.rowCount > 0) ?? workbook.worksheets[0];
  if (!sheet) return [];

  const width = Math.min(Math.max(sheet.columnCount, 1), READ_WIDTH);
  const grid: GridRow[] = [];

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) {
      cells.push(row.getCell(c).text ?? "");
    }
    grid.push({ line: row.number, cells });
  });

  return grid;
}

/**
 * An uploaded file, become a sheet — or a reason it is not one.
 *
 * `filename` is used for display and nothing else. What the file *is* comes from
 * its bytes, so renaming a PDF to `.csv` changes the label on the dialog and
 * cannot change which parser runs.
 */
export async function parseInventoryFile(
  filename: string,
  buffer: Buffer,
): Promise<ParseResult> {
  if (buffer.length === 0) {
    return { ok: false, reason: "That file is empty." };
  }
  if (buffer.length > MAX_IMPORT_BYTES) {
    const mb = (MAX_IMPORT_BYTES / 1024 / 1024).toFixed(0);
    return {
      ok: false,
      reason: `That file is larger than ${mb}MB. Export just the inventory sheet and upload that.`,
    };
  }

  const sniffed = sniff(buffer);
  if (!sniffed) {
    return { ok: false, reason: `We could not read that file. ${ACCEPTED}` };
  }

  /*
   * Both are documents we can read perfectly well and cannot import from. A
   * table needs columns, and "the first line of this PDF" is not one — so this
   * says what is wrong rather than handing prose to a mapping screen.
   */
  if (sniffed.kind === "pdf" || sniffed.kind === "docx") {
    const what = sniffed.kind === "pdf" ? "a PDF" : "a Word document";
    return {
      ok: false,
      reason: `That is ${what}, which has no columns to map. ${ACCEPTED}`,
    };
  }

  if (sniffed.kind === "xlsx") {
    // The bomb check, before exceljs sees it and while nothing is decompressed.
    const zip = inspectZip(buffer);
    if (!zip.ok) return { ok: false, reason: zip.reason };
  }

  try {
    const work =
      sniffed.kind === "xlsx"
        ? xlsxGrid(buffer)
        : csvGrid(decodeText(buffer));

    const grid = await withTimeout<GridResult>(work, PARSE_TIMEOUT_MS);

    if (grid === null) {
      return {
        ok: false,
        reason:
          "That file took too long to read. It may be corrupt or unusually complex.",
      };
    }

    if (!Array.isArray(grid)) return { ok: false, reason: grid.reason };

    // A sheet that arrived as one long column per row is split back out here,
    // where both parsers' output meets and the repair only has to exist once.
    return toSheet(await resplitSingleColumn(grid), filename);
  } catch (err) {
    // Malformed input reaches here as a throw from the parser. Log for
    // diagnosis; tell the person something they can act on.
    console.error(`[import] ${sniffed.kind} parse failed`, err);
    return {
      ok: false,
      reason:
        "That file could not be read. It may be corrupt or password-protected.",
    };
  }
}
