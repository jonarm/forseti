import { NextResponse } from "next/server";

import { recordKind } from "@/lib/ams/record-kinds";
import { guessMapping } from "@/lib/ams/import-spec";
import { MAX_IMPORT_BYTES, parseInventoryFile } from "@/lib/ams/import-parse";
import { safeFilename } from "@/lib/evidence";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/session";
import type { PermissionRequest } from "@/lib/permissions";

/**
 * POST /api/records/[kind]/import/parse — read an uploaded spreadsheet, write
 * nothing.
 *
 * The generic form of what the inventory had. The parser was never
 * system-specific — a file is columns and rows whatever register it is bound
 * for — so all the kind decides is which permission is checked and whose
 * headers the guess is made against.
 *
 * **The one route in an import that touches a file, and the one that cannot
 * change anything.** It answers what columns and rows are in here and hands
 * them back for the mapping screen to argue about. Everything deciding what a
 * row *becomes* stays where it was: the spec judges, the apply writes, and both
 * re-run over the rows they are eventually sent.
 *
 * The permission is the kind's `create`, the same statement the apply checks.
 * Reading a spreadsheet writes nothing, so a narrower gate would be defensible
 * — but the only reason to be on this screen is to import, and a parse endpoint
 * anyone with a session can point a file at is free CPU for whoever finds it.
 *
 * The bytes are discarded here. Nothing is stored, not the file and not the
 * rows: the response is the only copy and it lives in the dialog's state until
 * somebody confirms.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const def = recordKind((await params).kind);

  if (!def || def.features.import !== "rows" || !def.importSpec) {
    /* Both halves have to agree: the registry says this register takes rows,
     * and a spec exists to judge them. A flag without a spec is a screen
     * offering an import nothing can apply. */
    return NextResponse.json(
      { error: "That register cannot be imported into from a spreadsheet." },
      { status: 404 },
    );
  }

  const auth = await requirePermission(
    { [def.resource]: ["create"] } as PermissionRequest,
    `import into the ${def.title.toLowerCase()}`,
  );
  if (!auth.ok) return auth.response;

  // Before the body is read, because reading it is the expensive part.
  const limit = await checkRateLimit("inventoryImport", auth.ctx.organizationId);
  if (!limit.allowed) return rateLimitResponse(limit, "reading spreadsheets");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "No file was attached to that request." },
      { status: 400 },
    );
  }

  /* The declared size, checked before the bytes are pulled into memory. The
   * parser checks the real length too — this one just avoids buffering 4MB to
   * find out it is 40. */
  if (file.size > MAX_IMPORT_BYTES) {
    const mb = (MAX_IMPORT_BYTES / 1024 / 1024).toFixed(0);
    return NextResponse.json(
      {
        error: `That file is larger than ${mb}MB. Export just the sheet you need and upload that.`,
      },
      { status: 400 },
    );
  }

  const filename = safeFilename(file.name);
  const parsed = await parseInventoryFile(
    filename,
    Buffer.from(await file.arrayBuffer()),
  );

  // A file we cannot read is an expected input, not an error.
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason }, { status: 400 });
  }

  const { columns, rows, lines } = parsed.sheet;

  return NextResponse.json({
    filename,
    columns,
    rows,
    lines,
    mapping: guessMapping(def.importSpec, columns),
  });
}
