import { NextResponse } from "next/server";

import { readAiSystem, saveAiEvidence } from "@/lib/ai-store";
import { evidenceFromUpload, guessEvidenceType } from "@/lib/ams/evidence-upload";
import { ingestDocument } from "@/lib/evidence/ingest";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { cleanLine } from "@/lib/sanitize";
import { requirePermission } from "@/lib/session";
import type { EvidenceType } from "@/lib/ams/types";

/**
 * POST /api/records/evidence/upload — file documents into the evidence register.
 *
 * The evidence register's version of an import, and the reason `record-kinds`
 * distinguishes `import: "files"` from `import: "rows"`. There are no columns to
 * map: what arrives is documents, and what has to happen to each of them is the
 * hardening sequence rather than a validation pass.
 *
 * **One file's failure is not the batch's.** Somebody drops twelve documents and
 * one is a password-protected PDF; the eleven still file, and the response names
 * the twelfth and why. Refusing the batch would make a person find the bad file
 * by bisection, which is how they learn to upload one at a time.
 *
 * **Per-file and per-batch caps.** Each document is bounded by the pipeline's
 * own 4MB limit, and the batch is bounded here — a serverless function reading
 * two hundred files into memory to extract text from each is the way this route
 * takes the app down.
 *
 * **The bytes are discarded.** Extraction happens on ingest and the file is
 * dropped, which is this product's documented behaviour for every upload path.
 * The record carries a preview and admits it has no downloadable copy.
 *
 * **An optional `systemId` links the batch to one system, and it is read before
 * anything is written.** The field is set when the upload came from a system's
 * own Evidence tab, and it is the only claim an upload makes on a document's
 * behalf — everything else it might assert (that the document is verified, that
 * it satisfies a control) is a judgement the bytes cannot support. It is checked
 * the same way `/api/assessments/create` checks its own: `systemId` becomes a
 * foreign key the profile page renders through, so an id borrowed from another
 * organisation would file a document against a system this tenant cannot see.
 * `readAiSystem` filters by `organizationId`, so an id from elsewhere is simply
 * not found — and the batch is refused rather than mislinked.
 */

/** More than this in one drop is a migration, and wants a conversation first. */
const MAX_FILES = 25;

/** Total across the batch, so twenty-five 4MB files cannot be read at once. */
const MAX_BATCH_BYTES = 25 * 1024 * 1024;

const TYPES: EvidenceType[] = [
  "policy",
  "screenshot",
  "configuration_export",
  "meeting_minutes",
  "contract",
  "test_result",
  "training_record",
  "log_extract",
];

export async function POST(request: Request) {
  const auth = await requirePermission(
    { evidence: ["create"] },
    "upload evidence",
  );
  if (!auth.ok) return auth.response;
  const { organizationId, userId, personId } = auth.ctx;

  // Before the body is read: extracting text from a batch is the expensive part.
  const limit = await checkRateLimit("inventoryImport", organizationId);
  if (!limit.allowed) return rateLimitResponse(limit, "uploading evidence");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "No files were attached to that request." },
      { status: 400 },
    );
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Upload at most ${MAX_FILES} documents at a time.` },
      { status: 400 },
    );
  }

  /* The declared sizes, summed before any bytes are pulled into memory. The
   * per-file cap is the pipeline's; this one is what stops the batch. */
  const declared = files.reduce((total, file) => total + file.size, 0);
  if (declared > MAX_BATCH_BYTES) {
    const mb = (MAX_BATCH_BYTES / 1024 / 1024).toFixed(0);
    return NextResponse.json(
      { error: `That is more than ${mb}MB in one go. Upload them in smaller batches.` },
      { status: 400 },
    );
  }

  /* Untrusted: it arrives in the form body like any other field. Resolved
   * against this organisation's inventory before a single document is stored,
   * so a bad id costs nothing rather than filing the batch against a system
   * that is not this tenant's. */
  const askedSystem = form.get("systemId");
  const wantedSystemId =
    typeof askedSystem === "string" && askedSystem.trim()
      ? cleanLine(askedSystem)
      : null;

  if (wantedSystemId && !(await readAiSystem(organizationId, wantedSystemId))) {
    return NextResponse.json(
      { error: "That system is not in this organisation's inventory." },
      { status: 400 },
    );
  }

  const asked = form.get("type");
  const chosenType =
    typeof asked === "string" && TYPES.includes(asked as EvidenceType)
      ? (asked as EvidenceType)
      : null;

  const stored: { id: string; title: string; filename: string; hasText: boolean }[] = [];
  const refused: { filename: string; reason: string }[] = [];
  const now = new Date();

  for (const file of files) {
    const result = await ingestDocument(
      file.name,
      Buffer.from(await file.arrayBuffer()),
    );

    if (!result.ok) {
      refused.push({ filename: file.name, reason: result.reason });
      continue;
    }

    /* The batch's type, or what the filename says, or policy. The dialog makes
     * the person choose, so the fallbacks are for a caller that did not — and
     * a filename saying "dpa" is better evidence of its own type than a
     * default is. */
    const type =
      chosenType ?? guessEvidenceType(result.document.filename) ?? "policy";

    const record = evidenceFromUpload(
      result.document,
      type,
      /* The person behind the account, or nobody. Whoever uploaded it is the
       * obvious owner, and inventing one would put a name on a document they
       * never handled. */
      personId ?? "",
      now,
      wantedSystemId ?? undefined,
    );

    await saveAiEvidence(organizationId, record, { userId });

    stored.push({
      id: record.id,
      title: record.title,
      filename: result.document.filename,
      // The register shows a scan differently: no preview, and it says why.
      hasText: result.document.text !== null,
    });
  }

  return NextResponse.json({ ok: true, stored, refused }, { status: 201 });
}
