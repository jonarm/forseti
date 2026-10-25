import { NextResponse } from "next/server";

import {
  readWorkspace,
  saveAiFinding,
  saveAiRisk,
  saveAiSystem,
  saveUseCase,
} from "@/lib/ai-store";
import { countOf, recordKind, type RecordKind } from "@/lib/ams/record-kinds";
import { importWorld, planImport } from "@/lib/ams/import-spec";
import { MAX_CELL, MAX_COLUMNS, MAX_ROWS } from "@/lib/ams/import-parse";
import { workspace } from "@/lib/ams/workspace";
import { RECORD_BINDINGS } from "@/lib/records";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { Actor } from "@/lib/audit";
import type { ColumnMapping, ImportRawRow } from "@/lib/ams/types";
import type { PermissionRequest } from "@/lib/permissions";

/**
 * POST /api/records/[kind]/import — apply an import to any register.
 *
 * **Plan first, apply second, and the apply re-plans.** The dialog has already
 * shown somebody every warning and held back every broken row, and none of that
 * is evidence: the preview was computed by a client, against a register as it
 * stood when the file was dropped. Between then and now somebody else may have
 * added a record with one of these names. So the rows arrive here and are
 * judged again by `planImport` — the same function the preview ran — against
 * this organisation's records read a moment ago. One differ, two callers.
 *
 * A file naming one record twice is caught inside `planImport` rather than
 * here: it judges the rows in order and refuses a name an earlier row already
 * claimed. The register check alone could not see that, because the second row
 * is checked against a read taken before the first was written.
 *
 * **The duplicate guard is best-effort, and cannot be otherwise.** The store's
 * reads degrade to empty arrays rather than throwing — that is its contract,
 * and it means a failed read here is indistinguishable from an empty register.
 * In that window every row looks new and every owner resolves to nobody. The
 * writes still fail loudly, so the exposure is a read that fails followed by
 * writes that do not. There is no fix that respects the contract; this is the
 * honest record of it.
 *
 * **Rows are rejected, never repaired.** A row that fails on apply is reported
 * back by name; the rest still land. There is no transaction to hide behind —
 * each store write audits per record — so the response says exactly what
 * happened to each one rather than implying an all-or-nothing the store does
 * not provide. An import that silently dropped three rows of nine would be the
 * worst possible outcome for a register.
 */

/**
 * How each kind writes one imported record.
 *
 * Kept here rather than in `records.ts` because it is a *write* of a freshly
 * built record, not a read or a removal — and because the type it accepts is
 * the one its own spec builds. The cast is contained to this table, where the
 * spec and the writer are named on the same line and cannot be mismatched.
 */
const WRITERS: Partial<
  Record<RecordKind, (org: string, record: never, actor: Actor) => Promise<void>>
> = {
  system: saveAiSystem as never,
  useCase: saveUseCase as never,
  risk: saveAiRisk as never,
  finding: saveAiFinding as never,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const def = recordKind((await params).kind);
  const write = def ? WRITERS[def.kind] : undefined;

  if (!def || def.features.import !== "rows" || !def.importSpec || !write) {
    return NextResponse.json(
      { error: "That register cannot be imported into from a spreadsheet." },
      { status: 404 },
    );
  }

  // First, and before the body is read. Importing creates records, so it is the
  // same statement the register's own create form checks.
  const auth = await requirePermission(
    { [def.resource]: ["create"] } as PermissionRequest,
    `import into the ${def.title.toLowerCase()}`,
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

  const { rows, mapping } = body as { rows?: unknown; mapping?: unknown };

  const fieldIds = def.importSpec.fields.map((f) => f.id);
  const cleanMapping = readMapping(mapping, fieldIds);
  if (!cleanMapping) {
    return NextResponse.json(
      { error: "The column mapping was not something we could read." },
      { status: 400 },
    );
  }

  const cleanRows = readRows(rows);
  if (!cleanRows) {
    return NextResponse.json(
      { error: `Send between 1 and ${MAX_ROWS} rows, each a flat object of text.` },
      { status: 400 },
    );
  }

  /* The register as it stands *now*, not as the preview saw it. This is the
   * whole reason the apply re-validates rather than trusting what it is sent. */
  const ws = workspace(await readWorkspace(organizationId, {}));
  const existing = RECORD_BINDINGS[def.kind]
    .rows(ws)
    .map((row) => identityOf(row))
    .filter(Boolean);

  const world = importWorld(ws, existing);
  const plan = planImport(def.importSpec, cleanRows, cleanMapping, world);

  const mappingError = plan.mappingIssues.find((issue) => issue.level === "error");
  if (mappingError) {
    // Nothing can be imported under this mapping, so nothing is — and the
    // reason is the mapping rather than any row.
    return NextResponse.json({ error: mappingError.message }, { status: 400 });
  }

  const imported: { index: number; id: string; name: string }[] = [];
  const rejected: { index: number; name: string; reason: string }[] = [];
  const now = new Date();

  for (const row of plan.rows) {
    const name = def.importSpec.identityOf(row.raw, cleanMapping) || "(unnamed row)";

    if (row.blocked) {
      const error = row.issues.find((issue) => issue.level === "error");
      rejected.push({
        index: row.index,
        name,
        reason: error?.message ?? "This row could not be imported.",
      });
      continue;
    }

    const record = def.importSpec.build(row.raw, cleanMapping, world, now) as never;
    await write(organizationId, record, { userId });
    imported.push({
      index: row.index,
      id: (record as { id: string }).id,
      name,
    });
  }

  return NextResponse.json(
    { ok: true, kind: def.kind, counted: countOf(def, imported.length), imported, rejected },
    { status: 201 },
  );
}

/** What a stored record is called, for the duplicate check. Registers differ. */
function identityOf(row: { id: string }): string {
  const record = row as Record<string, unknown>;
  for (const field of ["name", "title"]) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/**
 * A mapping we are willing to act on: our column names, this kind's field ids.
 *
 * A target id that is not one of this register's is rejected rather than
 * ignored. Ignoring it would mean a client believing it mapped a column that
 * silently went nowhere, which is the import failure nobody notices until an
 * audit.
 */
function readMapping(value: unknown, fieldIds: string[]): ColumnMapping | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_COLUMNS) return null;

  const mapping: ColumnMapping = {};
  for (const [column, target] of entries) {
    const key = cleanLine(column, 200);
    if (!key) return null;
    if (target === null || target === undefined || target === "") {
      mapping[key] = null;
      continue;
    }
    if (typeof target !== "string" || !fieldIds.includes(target)) return null;
    mapping[key] = target;
  }

  return mapping;
}

/** Rows as flat text, cleaned at the door because this is somebody else's file. */
function readRows(value: unknown): ImportRawRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROWS) return null;

  const rows: ImportRawRow[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > MAX_COLUMNS) return null;

    const row: ImportRawRow = {};
    for (const [column, cell] of entries) {
      const key = cleanLine(column, 200);
      if (!key) continue;
      // Anything a cell is not a string, it is not a cell. Coercing a number or
      // a nested object into text here would be the importer inventing data.
      row[key] = typeof cell === "string" ? cleanLine(cell, MAX_CELL) : "";
    }
    rows.push(row);
  }

  return rows;
}
