import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/pglite";
import type { AISystem } from "@/lib/ams/types";
import { RECORD_KINDS, RECORD_KIND_IDS } from "@/lib/ams/record-kinds";

/**
 * `POST /api/records/system/export`, exercised against a real Postgres.
 *
 * The export is a read, so most of what could go wrong here is quiet: a file
 * that is well formed and wrong. The properties worth pinning are the ones that
 * would produce exactly that:
 *
 *   - **it never exports another tenant's row**, however the ids arrive. The
 *     client says which rows it means, so this is the one place that has to
 *     refuse to take its word for it;
 *   - **the columns are the ones asked for, in catalogue order** rather than the
 *     order they were ticked, so two months' exports can be diffed;
 *   - **the trail records that it happened**, because "who took a copy of the AI
 *     register" is the question the route exists to be able to answer;
 *   - **a degraded read is a failure, not a spreadsheet of zeroes.** The store
 *     returns empty arrays rather than throwing, so the naive path produces a
 *     file where every coverage figure is 0% — an answer-shaped non-answer.
 *
 * The session is mocked; the store, the SQL and the workbook writer are real.
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

const caller = { organizationId: ORG_A, userId: "user-a", role: "auditor" };
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
const { readActivityByKind, saveAiSystem } = await import("@/lib/ai-store");
const { POST } = await import("@/app/api/records/[kind]/export/route");

const ACTOR = { userId: "seed" };

function makeSystem(id: string, name: string, over: Partial<AISystem> = {}): AISystem {
  return {
    id,
    name,
    vendor: "Somebody",
    origin: "procured_saas",
    isGenAi: true,
    businessUnit: "Technology",
    ownerId: "",
    lifecycleStage: "production",
    riskTier: "minimal",
    assessmentStatus: "approved",
    purpose: "",
    deploymentModel: "vendor_multi_tenant",
    hostingRegions: [],
    dataResidency: "EU",
    userGroups: [],
    approxUsers: 12,
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
    ...over,
  };
}

function post(body: unknown, kind = "system") {
  return POST(
    new Request(`http://localhost/api/records/${kind}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ kind }) },
  );
}

/** The CSV back as rows of cells, so assertions read like the file looks. */
function csvRows(text: string): string[][] {
  return text.split("\n").map((line) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") {
        cells.push(cell);
        cell = "";
      } else cell += ch;
    }
    cells.push(cell);
    return cells;
  });
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

  await saveAiSystem(ORG_A, makeSystem("sys-one", "Otter.ai"), ACTOR);
  await saveAiSystem(
    ORG_A,
    makeSystem("sys-two", "Grammarly", { ownerId: "p-devi", isGenAi: false }),
    ACTOR,
  );
  await saveAiSystem(ORG_B, makeSystem("sys-theirs", "Somebody else's"), ACTOR);
});

describe("exporting to CSV", () => {
  it("returns the chosen columns as a downloadable file", async () => {
    const response = await post({
      format: "csv",
      columns: ["name", "vendor", "owner"],
      ids: ["sys-one", "sys-two"],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    // A register changes; a cached copy of one is a wrong answer delivered well.
    expect(response.headers.get("cache-control")).toBe("no-store");

    const rows = csvRows(await response.text());
    expect(rows[0]).toEqual(["System name", "Vendor", "Owner"]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r[0]).slice(1).sort()).toEqual(["Grammarly", "Otter.ai"]);
  });

  it("writes columns in catalogue order, not the order they were ticked", async () => {
    const response = await post({
      format: "csv",
      // Ticked backwards, as somebody clicking down a list would.
      columns: ["riskTier", "vendor", "name"],
      ids: ["sys-one"],
    });

    const rows = csvRows(await response.text());
    // Two months' exports have to be diffable, so the file follows the
    // catalogue rather than the clicks.
    expect(rows[0]).toEqual(["System name", "Vendor", "Risk tier"]);
  });

  it("resolves labels and owners rather than exporting raw enum values", async () => {
    const response = await post({
      format: "csv",
      columns: ["name", "origin", "isGenAi", "owner", "discoveredVia"],
      ids: ["sys-two"],
    });

    const [, row] = csvRows(await response.text());
    expect(row[1]).toBe("Procured SaaS");
    expect(row[2]).toBe("No");
    expect(row[3]).toBe("S. Devi");
    // Null means a person registered it by hand — a fact, not an absence.
    expect(row[4]).toBe("Registered by hand");
  });

  it("names an unowned system rather than leaving the cell blank", async () => {
    const response = await post({
      format: "csv",
      columns: ["name", "owner"],
      ids: ["sys-one"],
    });

    const [, row] = csvRows(await response.text());
    expect(row[1]).toBe("Unassigned");
  });

  it("quotes a value containing a comma so the columns do not shift", async () => {
    await saveAiSystem(
      ORG_A,
      makeSystem("sys-three", "Claims triage", {
        purpose: "Drafts replies, summarises calls",
      }),
      ACTOR,
    );

    const response = await post({
      format: "csv",
      columns: ["name", "purpose", "vendor"],
      ids: ["sys-three"],
    });

    const text = await response.text();
    expect(text).toContain('"Drafts replies, summarises calls"');

    // The failure this prevents: every column after the comma shifting by one.
    // Vendor precedes Purpose because the file follows the catalogue, not the
    // order the columns were asked for — the same rule asserted above.
    const [header, row] = csvRows(text);
    expect(header).toEqual(["System name", "Vendor", "Purpose"]);
    expect(row).toEqual([
      "Claims triage",
      "Somebody",
      "Drafts replies, summarises calls",
    ]);
  });
});

describe("exporting to XLSX", () => {
  it("returns a real workbook whose counts are numbers", async () => {
    const response = await post({
      format: "xlsx",
      columns: ["name", "approxUsers"],
      ids: ["sys-one"],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");

    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const sheet = workbook.worksheets[0];

    expect(sheet.name).toBe("AI inventory");
    expect(sheet.getRow(1).getCell(1).text).toBe("System name");
    // A count that arrives as text is a support ticket the first time anybody
    // tries to sum the column.
    expect(sheet.getRow(2).getCell(2).value).toBe(12);
  });
});

describe("exporting to PDF", () => {
  it("returns a self-printing document rather than a download", async () => {
    const response = await post({
      format: "pdf",
      columns: ["name", "vendor"],
      ids: ["sys-one"],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    /* No attachment: it is opened and printed, not saved. A download prompt for
     * an .html file is not what somebody who asked for a PDF expects. */
    expect(response.headers.get("content-disposition")).toBeNull();

    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("window.print()");
    // Headings have to repeat, or a long register is unreadable after page one.
    expect(html).toContain("display: table-header-group");
    expect(html).toContain("landscape");
    expect(html).toContain("<th>System name</th>");
    expect(html).toContain("Otter.ai");
  });

  it("escapes a system name that contains markup", async () => {
    /* The document is written into a same-origin iframe, so an unescaped
     * `<script>` in a vendor field would run with our cookies. This is the one
     * test in the file that is about safety rather than about a correct file. */
    await saveAiSystem(
      ORG_A,
      makeSystem("sys-xss", '<script>alert("x")</script>', {
        vendor: 'Bobby "Drop" & Co',
      }),
      ACTOR,
    );

    const html = await (
      await post({ format: "pdf", columns: ["name", "vendor"], ids: ["sys-xss"] })
    ).text();

    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Bobby &quot;Drop&quot; &amp; Co");
  });

  it("is recorded in the trail like any other export", async () => {
    await post({ format: "pdf", columns: ["name"], ids: ["sys-one"] });

    const trail = await readActivityByKind(ORG_A, "organization");
    const entry = trail.find((e) => e.action === "exported the AI inventory");

    // Taking a copy is the auditable act whichever shape it leaves in.
    expect(entry?.after).toContain("1 system");
    expect(entry?.after).toContain(".pdf");
  });
});

describe("what an export must not do", () => {
  it("will not export another organization's system, whoever asks for it", async () => {
    const response = await post({
      format: "csv",
      columns: ["name"],
      ids: ["sys-one", "sys-theirs"],
    });

    const rows = csvRows(await response.text());
    const names = rows.slice(1).map((r) => r[0]);

    expect(names).toEqual(["Otter.ai"]);
    expect(names).not.toContain("Somebody else's");
  });

  it("answers 404 when every id belongs to somebody else", async () => {
    const response = await post({
      format: "csv",
      columns: ["name"],
      ids: ["sys-theirs"],
    });

    expect(response.status).toBe(404);
  });

  it("refuses a caller without the statement", async () => {
    permitted = false;
    expect((await post({ format: "csv", columns: ["name"], ids: ["sys-one"] })).status).toBe(
      403,
    );
  });

  it("checks system: export rather than a write statement", async () => {
    // Asserted on the arguments because the mock says yes to anything — an
    // auditor must be able to export, and only this pins that.
    requirePermission.mockClear();
    await post({ format: "csv", columns: ["name"], ids: ["sys-one"] });

    expect(requirePermission).toHaveBeenCalledWith(
      { system: ["export"] },
      expect.any(String),
    );
  });

  it("refuses a register that cannot be exported yet, and one that does not exist", async () => {
    // Taken from the registry rather than named, so turning a register on moves
    // this assertion to the next one waiting instead of failing it.
    const notYet = RECORD_KIND_IDS.find((k) => !RECORD_KINDS[k].features.export);
    if (notYet) {
      expect(
        (await post({ format: "csv", columns: ["name"], ids: ["x"] }, notYet)).status,
      ).toBe(404);
    }

    expect(
      (await post({ format: "csv", columns: ["name"], ids: ["r"] }, "nope")).status,
    ).toBe(404);
  });

  it("rejects a bad format, an empty column list and a bad id list", async () => {
    expect((await post({ format: "docx", columns: ["name"], ids: ["sys-one"] })).status).toBe(400);
    expect((await post({ format: "csv", columns: [], ids: ["sys-one"] })).status).toBe(400);
    expect((await post({ format: "csv", columns: ["nope"], ids: ["sys-one"] })).status).toBe(400);
    expect((await post({ format: "csv", columns: ["name"], ids: [] })).status).toBe(400);
    expect((await post({ format: "csv", columns: ["name"], ids: [7] })).status).toBe(400);
  });

  it("drops a column id it does not recognise instead of failing the export", async () => {
    const response = await post({
      format: "csv",
      columns: ["name", "a-column-we-removed", "vendor"],
      ids: ["sys-one"],
    });

    expect(response.status).toBe(200);
    expect(csvRows(await response.text())[0]).toEqual(["System name", "Vendor"]);
  });
});

describe("the trail an export leaves", () => {
  it("records who exported what, and how much of it", async () => {
    const response = await post({
      format: "xlsx",
      columns: ["name", "vendor"],
      ids: ["sys-one", "sys-two"],
    });

    const trail = await readActivityByKind(ORG_A, "organization");
    const entry = trail.find((e) => e.action === "exported the AI inventory");

    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe("user-a");
    expect(entry?.subjectId).toBe(ORG_A);
    expect(entry?.after).toContain("2 systems");
    expect(entry?.after).toContain("System name, Vendor");

    /* The filename, because it is the only handle tying a file sitting in
     * somebody's downloads folder back to the entry that records it leaving —
     * and it carries the format in its extension. */
    const filename = response.headers.get("content-disposition");
    expect(filename).toContain(".xlsx");
    expect(entry?.after).toContain(".xlsx");
    expect(entry?.after).toContain("AI inventory ");
    // Nothing changed, so a diff-shaped entry would misreport a read as an edit.
    expect(entry?.before).toBeNull();
  });

  it("leaves no trail in another organization", async () => {
    await post({ format: "csv", columns: ["name"], ids: ["sys-one"] });

    const theirs = await readActivityByKind(ORG_B, "organization");
    expect(theirs.filter((e) => e.action === "exported the AI inventory")).toEqual([]);
  });
});
