/**
 * Turning any register into a file, whatever kind of record it holds.
 *
 * Split out of `inventory-export.ts` when the second register wanted the same
 * three formats. Nothing here knows what a system, a risk or a finding is: it
 * takes a list of columns and a list of rows and writes CSV, a workbook or a
 * printable page. What each column *means* lives beside the records it
 * describes, in that kind's own catalogue.
 *
 * **Values are typed, not stringified by the caller.** A resolver returns a
 * number for a count and a string for a label, so the workbook writer can
 * produce cells that sort and sum as numbers. Flattening to text earlier would
 * push that decision somewhere it cannot be undone, and "42" as text in Excel
 * is a support ticket.
 */
import type { Workspace } from "./workspace";

/** What a cell can be. Dates stay strings — ISO days sort correctly as text. */
export type ExportValue = string | number;

/** The five headings a picker groups its checkboxes under. */
export type ColumnGroup =
  | "Register"
  | "Governance"
  | "Deployment"
  | "Vendor"
  | "Record";

export interface ExportColumn<T> {
  id: string;
  label: string;
  group: ColumnGroup;
  /** Derived on read through the workspace, never from a stored figure. */
  resolve: (row: T, ws: Workspace) => ExportValue;
}

/**
 * A column whose row type has been forgotten.
 *
 * `resolve` is a function of the row, and functions are contravariant in their
 * arguments, so `ExportColumn<Risk>` is assignable to this while
 * `ExportColumn<unknown>` would not be. That is what lets one registry hold the
 * catalogues of eight different record types without `any` anywhere — at the
 * cost of one cast in `exportRow`, which is where the row and its columns are
 * known to belong together and nowhere else can be.
 */
export type ErasedColumn = ExportColumn<never>;

/** The chosen columns, in catalogue order rather than the order they were ticked. */
export function chosenColumns<C extends { id: string }>(
  catalogue: readonly C[],
  ids: readonly string[],
): C[] {
  const wanted = new Set(ids);
  return catalogue.filter((column) => wanted.has(column.id));
}

/**
 * One row's cells, in the order the columns were given.
 *
 * The cast is the single place the erasure above is undone. It is sound because
 * a kind's rows and its columns come from the same registry entry and cannot be
 * mixed: the caller reads both from one `RecordKindDef`.
 */
export function exportRow(
  row: unknown,
  columns: readonly ErasedColumn[],
  ws: Workspace,
): ExportValue[] {
  return columns.map((column) =>
    (column.resolve as (row: unknown, ws: Workspace) => ExportValue)(row, ws),
  );
}

/**
 * CSV, quoted to RFC 4180.
 *
 * Wrap when the value holds a delimiter, a quote or a newline, and double any
 * quote inside. A description field with a comma in it is the common case, and
 * getting this wrong shifts every column after it by one — silently, in a file
 * somebody then builds a board report from.
 */
export function toCsv(
  columns: readonly { label: string }[],
  rows: readonly ExportValue[][],
): string {
  const escape = (value: ExportValue) => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    columns.map((column) => escape(column.label)).join(","),
    ...rows.map((row) => row.map(escape).join(",")),
  ].join("\n");
}

/**
 * A filename somebody can find again in their downloads folder.
 *
 * Dated, because an export is a snapshot of a register that changes and two
 * files called `risks.csv` are indistinguishable a week later. UTC
 * deliberately: the server does not know what day it is where the caller is,
 * and a name that differs between two colleagues is worse than one that is
 * consistently the server's.
 */
export function exportFilename(
  what: string,
  extension: string,
  now: Date,
): string {
  return `${what} ${now.toISOString().slice(0, 10)}.${extension}`;
}

/**
 * Escape for HTML.
 *
 * A record's title is whatever somebody typed, and the printable export is
 * rendered in an iframe on our own origin — so an unescaped `<script>` in a
 * vendor field would execute with our cookies. Everything that reaches the
 * document goes through here, including the headers, because a column label is
 * only trusted until somebody adds a configurable one.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A register as a page a browser can turn into a PDF.
 *
 * **Print-styled HTML rather than a generated PDF, and deliberately.** Making a
 * real PDF means a new dependency whose font data is a known failure mode under
 * a serverless bundler — a runtime failure, in the one environment that cannot
 * be tested from a laptop. The browser already contains a PDF writer that every
 * reader trusts; this hands it a document and gets out of the way.
 *
 * It is a whole, standalone document on purpose: no external stylesheet, no
 * font to fetch, nothing that could still be loading when the print dialog
 * opens and leave somebody with an unstyled table. It also means the file is
 * still readable if it is saved as HTML instead.
 *
 * `@page landscape` because a register is wide. `thead` repeats on every page —
 * a fourteen-page table whose headings appear once is a table nobody can read
 * past page one.
 */
export function toPrintableHtml(
  columns: readonly { label: string }[],
  rows: readonly ExportValue[][],
  meta: { title: string; subtitle: string },
): string {
  const head = columns
    .map((column) => `<th>${escapeHtml(column.label)}</th>`)
    .join("");

  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`,
    )
    .join("");

  /* The document prints itself. The alternative is the host page guessing when
   * the iframe is ready, and a document knows that about itself — `load` fires
   * after the table is laid out, which is what the print dialog measures. */
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(meta.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 11px/1.4 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111;
    background: #fff;
  }
  header { margin-bottom: 10px; border-bottom: 1px solid #111; padding-bottom: 6px; }
  h1 { margin: 0; font-size: 15px; letter-spacing: -0.01em; }
  .sub { margin-top: 2px; font-size: 10px; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  /* Repeat the headings on every page. Without this a long register is
     unreadable after the first sheet. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td {
    border: 0.5px solid #bbb;
    padding: 3px 5px;
    text-align: left;
    vertical-align: top;
    word-break: break-word;
  }
  th { background: #eee; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em; }
  footer { margin-top: 8px; font-size: 9px; color: #666; }
  @media print { footer { position: fixed; bottom: 0; } }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(meta.title)}</h1>
  <p class="sub">${escapeHtml(meta.subtitle)}</p>
</header>
<table>
  <thead><tr>${head}</tr></thead>
  <tbody>${body}</tbody>
</table>
<footer>Generated from Forseti. Save as PDF from your browser&#39;s print dialog.</footer>
<script>
  window.addEventListener("load", function () {
    window.focus();
    window.print();
  });
</script>
</body>
</html>`;
}
