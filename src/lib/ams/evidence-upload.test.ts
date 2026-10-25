import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";

/**
 * Filing documents into the evidence register.
 *
 * The evidence "import" is documents rather than rows, so what is worth testing
 * is not a mapping but what the register refuses to claim on a document's
 * behalf, and what it does with a file it cannot read:
 *
 *   - **everything arrives unverified and linked to no control.** Verification
 *     is what makes evidence count towards coverage, so a register that marked
 *     its own uploads verified would raise a score by the act of filing;
 *   - **the one link it will make is the system the caller named**, and only
 *     after resolving that id inside the caller's own organisation — it becomes
 *     a foreign key the profile page renders through;
 *   - **a scan is filed, not refused.** A PDF with no text layer is still
 *     evidence — the register's job is to record that the document exists;
 *   - **one bad file does not fail the batch**, or a person learns to upload
 *     one at a time;
 *   - **the bytes are gone.** The record carries a preview and admits it has no
 *     copy, which is this product's documented behaviour for every upload path.
 */

let testDb: TestDb;
let close: () => Promise<void>;

vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
  get schema() {
    return undefined;
  },
}));

const ORG_A = "org-aaaa";
const ORG_B = "org-bbbb";

const caller = {
  organizationId: ORG_A,
  userId: "user-a",
  personId: "p-devi",
  role: "governance_lead",
};
let permitted = true;

const requirePermission = vi.fn(async () =>
  permitted
    ? { ok: true as const, ctx: { ...caller } }
    : {
        ok: false as const,
        response: Response.json({ error: "Refused." }, { status: 403 }),
      },
);

vi.mock("@/lib/session", () => ({
  requirePermission: (...args: unknown[]) =>
    (requirePermission as unknown as (...a: unknown[]) => unknown)(...args),
  requireOrgForApi: vi.fn(async () => ({ ok: true as const, ctx: { ...caller } })),
}));

const { organization } = await import("@/db/auth-schema");
const { aiPerson } = await import("@/db/schema");
const { readAiEvidence, saveAiSystem } = await import("@/lib/ai-store");
const { guessEvidenceType, titleFromFilename } = await import(
  "@/lib/ams/evidence-upload"
);
const { POST } = await import("@/app/api/records/evidence/upload/route");

/** A text document, which the pipeline reads without any parser at all. */
const textFile = (name: string, body: string) =>
  new File([body], name, { type: "text/plain" });

/** `%PDF-` and nothing readable after it — what a scan looks like to the extractor. */
const scannedPdf = (name: string) =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a])], name, {
    type: "application/pdf",
  });

/** The least a system needs to exist, so an upload has something to link to. */
async function makeSystem(organizationId: string, id: string) {
  await saveAiSystem(
    organizationId,
    {
      id,
      name: id,
      vendor: "Somebody",
      origin: "procured_saas",
      isGenAi: true,
      businessUnit: "Technology",
      ownerId: "",
      lifecycleStage: "production",
      riskTier: "minimal",
      assessmentStatus: "not_started",
      purpose: "",
      deploymentModel: "vendor_multi_tenant",
      hostingRegions: [],
      dataResidency: "EU",
      userGroups: [],
      approxUsers: 0,
      dataCategories: [],
      characteristics: [],
      vendorDetail: {
        name: "Somebody",
        subProcessors: [],
        modelProvider: null,
        contractType: "click_through",
        dataProcessingAgreement: false,
        certifications: [],
        trainsOnCustomerData: false,
        renewalDate: null,
      },
      registeredAt: "2026-01-01",
      nextReviewDate: "2026-12-15",
      discoveredVia: null,
    },
    { userId: "seed" },
  );
}

function upload(files: File[], type?: string, systemId?: string) {
  const form = new FormData();
  if (type) form.append("type", type);
  if (systemId) form.append("systemId", systemId);
  for (const file of files) form.append("files", file);

  return POST(
    new Request("http://localhost/api/records/evidence/upload", {
      method: "POST",
      body: form,
    }),
  );
}

beforeAll(async () => {
  const made = await createTestDb();
  testDb = made.db;
  close = made.close;
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  permitted = true;
  await testDb.delete(organization);
  await testDb.insert(organization).values([
    { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
    { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
  ]);
  await testDb.insert(aiPerson).values([
    {
      id: "p-devi",
      organizationId: ORG_A,
      name: "S. Devi",
      role: "Head of Technology",
      businessUnit: "Technology",
    },
  ]);
});

describe("filing a document", () => {
  it("stores it with a title, a preview and no copy of the file", async () => {
    const response = await upload(
      [textFile("access-review-q1.txt", "Reviewed all admin accounts on 14 May.")],
      "log_extract",
    );
    expect(response.status).toBe(201);

    const { stored, refused } = await response.json();
    expect(refused).toEqual([]);
    expect(stored).toHaveLength(1);
    expect(stored[0].hasText).toBe(true);

    const [doc] = await readAiEvidence(ORG_A);
    expect(doc.title).toBe("access review q1");
    expect(doc.type).toBe("log_extract");
    expect(doc.file?.preview).toContain("Reviewed all admin accounts");
    /* Empty because there is nothing to serve: the bytes were discarded at
     * ingest, and a link that goes nowhere is worse than an admitted absence. */
    expect(doc.file?.href).toBe("");
  });

  it("claims nothing on the document's behalf", async () => {
    await upload([textFile("ai-policy.txt", "Our AI policy.")], "policy");

    const [doc] = await readAiEvidence(ORG_A);
    /* Verification is what makes evidence count towards coverage. A register
     * that verified its own uploads would raise a score by the act of filing. */
    expect(doc.verificationState).toBe("unverified");
    // What a document proves is a judgement an upload cannot make.
    expect(doc.linkedControlIds).toEqual([]);
    expect(doc.linkedSystemIds).toEqual([]);
    expect(doc.expiresAt).toBeNull();
    // Whoever uploaded it is the obvious owner.
    expect(doc.ownerId).toBe("p-devi");
  });

  it("files a scan rather than refusing it", async () => {
    const { stored, refused } = await (await upload([scannedPdf("certificate.pdf")])).json();

    /* A scanned certificate is still evidence: the register's job is to record
     * that the document exists, not to be able to read it. */
    expect(refused).toEqual([]);
    expect(stored).toHaveLength(1);
    expect(stored[0].hasText).toBe(false);

    const [doc] = await readAiEvidence(ORG_A);
    // No preview, rather than an empty one that reads as a bug.
    expect(doc.file?.preview).toBeUndefined();
    expect(doc.file?.kind).toBe("pdf");
  });

  it("files the ones it can and names the ones it cannot", async () => {
    const { stored, refused } = await (
      await upload([
        textFile("good.txt", "Readable."),
        // Not a type the sniffer accepts: no magic number, and binary.
        new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], "mystery.bin"),
        textFile("also-good.txt", "Also readable."),
      ])
    ).json();

    /* Refusing the batch would make somebody find the bad file by bisection,
     * which is how they learn to upload one at a time. */
    expect(stored).toHaveLength(2);
    expect(refused).toHaveLength(1);
    expect(refused[0].filename).toBe("mystery.bin");
    expect(await readAiEvidence(ORG_A)).toHaveLength(2);
  });

  it("refuses an empty request and a caller without the statement", async () => {
    expect((await upload([])).status).toBe(400);

    permitted = false;
    expect((await upload([textFile("x.txt", "y")])).status).toBe(403);
    expect(await readAiEvidence(ORG_A)).toEqual([]);
  });

  it("checks the evidence create statement", async () => {
    requirePermission.mockClear();
    await upload([textFile("x.txt", "y")]);

    expect(requirePermission).toHaveBeenCalledWith(
      { evidence: ["create"] },
      expect.any(String),
    );
  });
});

describe("filing a document against one system", () => {
  it("links the batch to the system the caller named", async () => {
    await makeSystem(ORG_A, "sys-churnlens");

    const response = await upload(
      [textFile("dpa.txt", "Data processing agreement.")],
      "contract",
      "sys-churnlens",
    );
    expect(response.status).toBe(201);

    const [doc] = await readAiEvidence(ORG_A);
    /* The one claim an upload can make honestly: not what the document proves,
     * but which system somebody was standing on when they filed it. Without
     * this the profile tab that offered the button stays empty. */
    expect(doc.linkedSystemIds).toEqual(["sys-churnlens"]);
    // Everything else it still refuses to assert.
    expect(doc.verificationState).toBe("unverified");
    expect(doc.linkedControlIds).toEqual([]);
  });

  it("refuses a system belonging to another organisation", async () => {
    await makeSystem(ORG_B, "sys-elsewhere");

    const response = await upload(
      [textFile("dpa.txt", "Data processing agreement.")],
      "contract",
      "sys-elsewhere",
    );

    /* `systemId` becomes a foreign key the profile renders through, so an id
     * borrowed from another tenant would file a document against a system this
     * organisation cannot see. Refused before a single document is stored. */
    expect(response.status).toBe(400);
    expect(await readAiEvidence(ORG_A)).toEqual([]);
  });

  it("files for the organisation when no system is named", async () => {
    const response = await upload([textFile("ai-policy.txt", "Our policy.")], "policy");
    expect(response.status).toBe(201);

    const [doc] = await readAiEvidence(ORG_A);
    expect(doc.linkedSystemIds).toEqual([]);
  });
});

describe("what a filename gives away", () => {
  it("reads the type out of the name when the name says one", () => {
    expect(guessEvidenceType("vendor-dpa.pdf")).toBe("contract");
    expect(guessEvidenceType("Q1 meeting minutes.docx")).toBe("meeting_minutes");
    expect(guessEvidenceType("pentest-results-2026.pdf")).toBe("test_result");
    expect(guessEvidenceType("okta_config_export.csv")).toBe("configuration_export");
  });

  it("says nothing rather than guessing when the name gives nothing", () => {
    /* Null rather than a default: the dialog asks once and applies it to the
     * batch, and defaulting every unrecognised file to "policy" would fill a
     * register with a claim nobody made. */
    expect(guessEvidenceType("scan0001.pdf")).toBeNull();
    expect(guessEvidenceType("Document (3).docx")).toBeNull();
  });

  it("turns a filename into something a person would recognise", () => {
    expect(titleFromFilename("access-review-q1.pdf")).toBe("access review q1");
    expect(titleFromFilename("AI_Policy_v3.docx")).toBe("AI Policy v3");
    // A name that is only an extension still has to produce something.
    expect(titleFromFilename(".gitignore")).toBe(".gitignore");
  });
});
