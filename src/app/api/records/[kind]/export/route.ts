import { NextResponse } from "next/server";

import { readWorkspace, writeAudit } from "@/lib/ai-store";
import { countOf, recordKind, type RecordKindDef } from "@/lib/ams/record-kinds";
import {
  chosenColumns,
  exportFilename,
  exportRow,
  toCsv,
  toPrintableHtml,
  type ErasedColumn,
  type ExportValue,
} from "@/lib/ams/export-format";
import { workspace } from "@/lib/ams/workspace";
import { RECORD_BINDINGS } from "@/lib/records";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { PermissionRequest } from "@/lib/permissions";

/**
 * POST /api/records/[kind]/export — any register as a file, and a record of it.
 *
 * One route for eight registers. The kind in the path resolves to a registry
 * entry that carries the permission resource, the column catalogue and the
 * labels, so nothing here knows what a risk or a finding is — and a new
 * register becomes exportable by gaining an entry rather than a route. The
 * alternative was one near-identical handler per register, which is eight places
 * to forget the tenant check and eight copies of the audit call.
 *
 * **A route rather than a Blob in the browser, because the export is the
 * auditable act.** Every row is already on the client; building the file there
 * would be faster, simpler and would leave no trace whatever. In a product
 * whose proposition is that governance decisions are answerable, "who took a
 * copy of the risk register, and when, and how much of it" should have an
 * answer — so the file is built here and `writeAudit` records it.
 *
 * **The audit entry is not a diff, because nothing changed.** `before` is null
 * and `after` carries the summary. Shaping it as a change would misrepresent a
 * read as an edit in a trail whose whole value is that those look different.
 *
 * **The client sends ids and the route trusts none of them.** "What is on
 * screen" is the product of a search, several filters and a tick selection, and
 * re-deriving that here would mean a second copy of a predicate that lives in
 * each register's component. So the client says which rows it means and the
 * route intersects them with what this organisation actually has.
 *
 * **An empty workspace against a non-empty request is a failure, not an
 * export.** `readWorkspace` degrades to empty arrays rather than throwing, so a
 * database that is down produces a well-formed spreadsheet in which every
 * derived figure is zero. That file is worse than an error: it looks like an
 * answer.
 */

/** No register is bigger than this, and a request claiming otherwise is not a person. */
const MAX_IDS = 5_000;

const FORMATS = ["csv", "xlsx", "pdf"] as const;
type Format = (typeof FORMATS)[number];

const MEDIA_TYPE: Record<Format, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  /* "pdf" is what the person chose and what they end up with; what crosses the
   * wire is the document their browser prints into one. Generating a real PDF
   * would mean a library whose font data is a known failure mode under a
   * serverless bundler — a runtime failure in the environment hardest to test —
   * and every reader already has a PDF writer built into their browser. */
  pdf: "text/html; charset=utf-8",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const def = recordKind((await params).kind);

  /* Resolved before the permission check, because the permission *is* the
   * kind's — there is nothing to ask about an unknown register. 404 rather
   * than 400: the path segment is the resource, and it does not exist. */
  if (!def || !def.features.export) {
    return NextResponse.json(
      { error: "That register cannot be exported." },
      { status: 404 },
    );
  }

  const auth = await requirePermission(
    { [def.resource]: ["export"] } as PermissionRequest,
    `export the ${def.title.toLowerCase()}`,
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { format, columns, ids } = body as {
    format?: unknown;
    columns?: unknown;
    ids?: unknown;
  };

  if (typeof format !== "string" || !FORMATS.includes(format as Format)) {
    return NextResponse.json(
      { error: `Choose a format: ${FORMATS.join(", ")}.` },
      { status: 400 },
    );
  }

  const wantedIds = readIds(ids);
  if (!wantedIds) {
    return NextResponse.json(
      { error: `Send between 1 and ${MAX_IDS} ids.` },
      { status: 400 },
    );
  }

  const chosen = chosenColumns(def.columns, readColumnIds(columns));
  if (chosen.length === 0) {
    return NextResponse.json(
      { error: "Choose at least one column to export." },
      { status: 400 },
    );
  }

  /* The whole workspace rather than one kind's query: every register's derived
   * figures come from these accessors, so the number in the file and the one on
   * the row it came from cannot differ. */
  const data = await readWorkspace(organizationId, {});
  const ws = workspace(data);
  const all = RECORD_BINDINGS[def.kind].rows(ws);

  if (all.length === 0) {
    // Either the register is genuinely empty — in which case there were no rows
    // to tick and this request could not have been made — or the read failed
    // and degraded. Both mean this is not an export.
    return NextResponse.json(
      { error: "Could not read that register just now. Nothing was exported." },
      { status: 503 },
    );
  }

  const wanted = new Set(wantedIds);
  const records = all.filter((row) => wanted.has(row.id));

  if (records.length === 0) {
    return NextResponse.json(
      { error: `None of those ${def.plural} are in your ${def.title.toLowerCase()}.` },
      { status: 404 },
    );
  }

  const rows = records.map((record) => exportRow(record, chosen, ws));
  const now = new Date();
  const filename = exportFilename(def.title, format, now);

  await recordExport(organizationId, userId, def, chosen, records.length, filename);

  const file = await render(format as Format, chosen, rows, {
    sheetName: def.title,
    title: filename.replace(/\.[a-z]+$/i, ""),
    subtitle: `${countOf(def, records.length)} · exported ${now.toISOString().slice(0, 10)}`,
  });

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": MEDIA_TYPE[format as Format],
      /* No attachment for the printable one: it is opened and printed rather
       * than saved, and a download prompt for an .html file is not what
       * somebody who asked for a PDF expects. The filename is ours rather than
       * the caller's, so the quotes are all the escaping it needs. */
      ...(format === "pdf"
        ? {}
        : { "Content-Disposition": `attachment; filename="${filename}"` }),
      "Content-Length": String(file.length),
      // A register changes; a cached copy of one is a wrong answer delivered well.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Note the export in the trail.
 *
 * `subjectKind: "organization"` because the subject is the register itself
 * rather than any one record — an entry per exported row would bury the trail
 * of actual changes under a hundred identical lines. The filename is in the
 * summary because it is the only handle tying a file in somebody's downloads
 * folder back to the entry recording that it left.
 */
async function recordExport(
  organizationId: string,
  userId: string,
  def: RecordKindDef,
  columns: readonly ErasedColumn[],
  count: number,
  filename: string,
): Promise<void> {
  const summary = [
    countOf(def, count),
    filename,
    `columns: ${columns.map((column) => column.label).join(", ")}`,
  ].join(" · ");

  try {
    await writeAudit(organizationId, { userId }, [
      {
        subjectKind: "organization",
        subjectId: organizationId,
        action: `exported the ${def.title}`,
        field: null,
        // Nothing changed, so there is no "before". The summary is the fact.
        before: null,
        after: summary,
      },
    ]);
  } catch (err) {
    console.error("[export] could not record the export in the trail", err);
  }
}

/** One format's bytes. Split out so the handler reads as a sequence of checks. */
async function render(
  format: Format,
  columns: readonly ErasedColumn[],
  rows: ExportValue[][],
  meta: { sheetName: string; title: string; subtitle: string },
): Promise<Buffer> {
  if (format === "csv") return Buffer.from(toCsv(columns, rows), "utf8");
  if (format === "pdf") {
    return Buffer.from(toPrintableHtml(columns, rows, meta), "utf8");
  }
  return toXlsx(columns, rows, meta.sheetName);
}

/** A real workbook, so the counts arrive in Excel as numbers rather than text. */
async function toXlsx(
  columns: readonly ErasedColumn[],
  rows: readonly ExportValue[][],
  sheetName: string,
): Promise<Buffer> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  // Excel refuses a sheet name over 31 characters or containing []:*?/\ — the
  // title is ours, but it is long enough to hit the first of those.
  const sheet = workbook.addWorksheet(sheetName.replace(/[[\]:*?/\\]/g, " ").slice(0, 31));

  sheet.columns = columns.map((column) => ({
    header: column.label,
    key: column.id,
    // Wide enough for the header, and for a vendor name that is not "IBM".
    width: Math.min(Math.max(column.label.length + 4, 16), 44),
  }));

  sheet.getRow(1).font = { bold: true };
  // The header stays put while somebody scrolls a two-hundred-row register.
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) sheet.addRow(row);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function readIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IDS) {
    return null;
  }

  const ids = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const id = cleanLine(raw, 200);
    if (!id) return null;
    ids.add(id);
  }

  return [...ids];
}

/** Column ids as sent. Unknown ones are dropped by `chosenColumns`, not here. */
function readColumnIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
}
