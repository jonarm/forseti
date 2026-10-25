import { beforeAll, describe, expect, it } from "vitest";

import {
  MAX_COLUMNS,
  MAX_ROWS,
  columnLetter,
  parseInventoryFile,
} from "./import-parse";
import { guessMapping, templateCsv } from "./import-spec";
import { SYSTEM_IMPORT } from "./import/system-spec";
import {
  DEFAULT_MAPPING,
  RAW_ROWS,
  SOURCE_COLUMNS,
  sampleCsv,
} from "./fixtures/import";

/**
 * Reading somebody else's spreadsheet.
 *
 * The import was a fixture until this module existed: every stage after the
 * drop zone was real, and the drop zone previewed nine hard-coded rows. So the
 * first thing worth proving is that a file — a real CSV, a real workbook —
 * comes out the other side as the rows it contains.
 *
 * After that, the failures that lose data quietly, which is the only kind that
 * matters in a register:
 *
 *   - a file over the cap is **refused**, not truncated. An import that took
 *     the first 500 rows of 900 and reported success would be the worst thing
 *     this feature could do;
 *   - a blank or repeated header does not silently swallow a column, because
 *     `ImportRawRow` is a flat object and two "Notes" would collapse into one;
 *   - row numbers survive blank rows, because the preview's promise is that a
 *     warning can be traced back to a line in somebody's own file;
 *   - a PDF is turned away with a reason, rather than reaching a mapping table
 *     as one long column.
 *
 * And the sample spreadsheet is parsed here rather than asserted as a literal:
 * it is uploaded through this same function by the dialog, so if the guesser or
 * the CSV reader breaks, the demo breaks with it and this test says so first.
 */

const utf8 = (text: string) => Buffer.from(text, "utf8");

/** A real workbook, built by the library that will be asked to read it back. */
async function xlsxOf(rows: (string | number)[][]): Promise<Buffer> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Inventory");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("parseInventoryFile — CSV", () => {
  it("reads headers, rows and the line each row came from", async () => {
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8("Tool,Dept\nOtter.ai,Sales\nGrammarly,Marketing"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sheet.columns).toEqual(["Tool", "Dept"]);
    expect(result.sheet.rows).toEqual([
      { Tool: "Otter.ai", Dept: "Sales" },
      { Tool: "Grammarly", Dept: "Marketing" },
    ]);
    expect(result.sheet.lines).toEqual([2, 3]);
  });

  it("detects a tab-separated export without being told", async () => {
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8("Tool\tDept\nOtter.ai\tSales"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.columns).toEqual(["Tool", "Dept"]);
    expect(result.sheet.rows[0]).toEqual({ Tool: "Otter.ai", Dept: "Sales" });
  });

  it("keeps a quoted comma inside one cell", async () => {
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8('Tool,Notes\nOtter.ai,"Records calls, externally"'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.rows[0].Notes).toBe("Records calls, externally");
  });

  it("strips the byte-order mark Excel writes, so the first header still matches", async () => {
    const result = await parseInventoryFile(
      "tracker.csv",
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        utf8("Tool,Dept\nOtter.ai,Sales"),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sheet.columns).toEqual(["Tool", "Dept"]);
    // The failure this guards against is silent: the header renders as "Tool"
    // and matches nothing, so the banner claims no column is mapped to a name.
    expect(guessMapping(SYSTEM_IMPORT, result.sheet.columns).Tool).toBe("name");
  });

  it("refuses a file with an unclosed quote rather than reporting three rows of two hundred", async () => {
    /* papaparse returns data *and* an error here: everything after the stray
     * quote is swallowed into one field. Taking the data would report a
     * confident row count for a file most of which was never read. */
    const rows = Array.from({ length: 40 }, (_, i) => `Tool ${i},Sales`);
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8(["Tool,Dept", 'Otter"ai,"Sales', ...rows].join("\n")),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("quotation mark");
  });

  it("still accepts ragged rows, which are ordinary in a hand-kept sheet", async () => {
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8("Tool,Dept,Notes\nOtter.ai,Sales\nGrammarly,Marketing,fine,extra"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Short row padded, long row's overflow dropped with the column it had no
    // header for — neither is a reason to turn the file away.
    expect(result.sheet.rows[0]).toEqual({
      Tool: "Otter.ai",
      Dept: "Sales",
      Notes: "",
    });
    expect(result.sheet.rows[1].Notes).toBe("fine");
  });

  it("skips a title row above the table and counts it in the line numbers", async () => {
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8("\nTool,Dept\nOtter.ai,Sales"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.columns).toEqual(["Tool", "Dept"]);
    // Header was line 2, so the first row of data is line 3 — not line 2, which
    // is what "header plus index" would have said.
    expect(result.sheet.lines).toEqual([3]);
  });
});

describe("parseInventoryFile — XLSX", () => {
  /* exceljs is a large dependency and Vitest transforms it on first import,
   * which costs far more than any parse in here. Paid once, out of band, so a
   * timeout in these tests means the parser was slow rather than the loader. */
  beforeAll(async () => {
    await import("exceljs");
  }, 180_000);

  it("reads a real workbook", async () => {
    const buffer = await xlsxOf([
      ["Tool", "Dept"],
      ["Otter.ai", "Sales"],
      ["Grammarly", "Marketing"],
    ]);

    const result = await parseInventoryFile("tracker.xlsx", buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.columns).toEqual(["Tool", "Dept"]);
    expect(result.sheet.rows).toEqual([
      { Tool: "Otter.ai", Dept: "Sales" },
      { Tool: "Grammarly", Dept: "Marketing" },
    ]);
    expect(result.sheet.lines).toEqual([2, 3]);
  });

  it("carries the sheet row number across a blank spacer row", async () => {
    const buffer = await xlsxOf([
      ["Tool", "Dept"],
      ["Otter.ai", "Sales"],
      [],
      ["Grammarly", "Marketing"],
    ]);

    const result = await parseInventoryFile("tracker.xlsx", buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.rows).toHaveLength(2);
    // Row 4 in the file, not row 3 — which is where somebody has to look.
    expect(result.sheet.lines).toEqual([2, 4]);
  });

  it("reads numbers as the text the cell shows", async () => {
    const buffer = await xlsxOf([
      ["Tool", "Seats"],
      ["Otter.ai", 12],
    ]);

    const result = await parseInventoryFile("tracker.xlsx", buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.rows[0].Seats).toBe("12");
  });
});

describe("a sheet that arrived as one long column per row", () => {
  /* The file that prompted this: an .xlsx holding a CSV, fifteen headers and
   * twenty-six fields to a row, all of it in column A because nothing had ever
   * split it. The parser was right that the sheet had one column, and being
   * right was useless — the mapping screen reported no column mapped to system
   * name while the person could read their own headers in the cell. */
  const CRAMMED = [
    "AI System ID,AI System Name,Provider,Business Owner,Technical Owner,Department,Status",
    "AI-001,Microsoft 365 Copilot,Microsoft,Chief Information Officer,Head of Digital Workplace,Enterprise Technology,In Use",
    "AI-002,GitHub Copilot,GitHub/Microsoft,CTO,Head of Engineering,Engineering,In Use",
  ];

  it("splits it back out when it came from a workbook", async () => {
    const buffer = await xlsxOf(CRAMMED.map((line) => [line]));
    const result = await parseInventoryFile("inventory.xlsx", buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sheet.columns).toEqual([
      "AI System ID",
      "AI System Name",
      "Provider",
      "Business Owner",
      "Technical Owner",
      "Department",
      "Status",
    ]);
    expect(result.sheet.rows[0]["AI System Name"]).toBe("Microsoft 365 Copilot");
    expect(result.sheet.lines).toEqual([2, 3]);

    /* The whole point: the headers the mapping screen could not find are now
     * there, and read the way somebody keeping an AI register writes them.
     * "Status" stays unmapped because it means approval as often as lifecycle,
     * and "Technical Owner" because "Business Owner" already claimed owner. */
    expect(guessMapping(SYSTEM_IMPORT, result.sheet.columns)).toEqual({
      "AI System ID": null,
      "AI System Name": "name",
      Provider: "vendor",
      "Business Owner": "owner",
      "Technical Owner": null,
      Department: "businessUnit",
      Status: null,
    });
  });

  it("splits a semicolon-separated one too, without being told which", async () => {
    const buffer = await xlsxOf([
      ["Tool;Dept;Owner"],
      ["Otter.ai;Sales;Ada Lovelace"],
      ["Grammarly;Marketing;Ada Lovelace"],
    ]);

    const result = await parseInventoryFile("inventory.xlsx", buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.columns).toEqual(["Tool", "Dept", "Owner"]);
    expect(result.sheet.rows[1].Owner).toBe("Ada Lovelace");
  });

  it("leaves a genuine single-column list alone", async () => {
    const buffer = await xlsxOf([["Tool"], ["Otter.ai"], ["Grammarly"]]);
    const result = await parseInventoryFile("inventory.xlsx", buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No delimiter splits these, so nothing is invented. One column is correct.
    expect(result.sheet.columns).toEqual(["Tool"]);
    expect(result.sheet.rows).toEqual([{ Tool: "Otter.ai" }, { Tool: "Grammarly" }]);
  });

  it("declines to split when a row would not split with the others", async () => {
    const buffer = await xlsxOf([
      ["Tool,Dept"],
      ["Otter.ai,Sales"],
      ["a note somebody typed into the sheet"],
    ]);

    const result = await parseInventoryFile("inventory.xlsx", buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Splitting would have left that row a column short and said nothing about
    // it. One column is wrong but visible; a silent partial split is worse.
    expect(result.sheet.columns).toEqual(["Tool,Dept"]);
  });

  it("does not touch a sheet that is already split", async () => {
    const buffer = await xlsxOf([
      ["Tool", "Notes"],
      ["Otter.ai", "records calls, externally"],
    ]);

    const result = await parseInventoryFile("inventory.xlsx", buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.columns).toEqual(["Tool", "Notes"]);
    expect(result.sheet.rows[0].Notes).toBe("records calls, externally");
  });
});

describe("the CSV template", () => {
  it("comes back through the parser with every column already mapped", async () => {
    const result = await parseInventoryFile(
      "template.csv",
      utf8(templateCsv(SYSTEM_IMPORT)),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mapping = guessMapping(SYSTEM_IMPORT, result.sheet.columns);
    // A template our own guesser could not read would be embarrassing in a way
    // nothing else in the suite would catch.
    expect(Object.values(mapping).filter((field) => field === null)).toEqual([]);
    expect(new Set(Object.values(mapping))).toEqual(
      new Set([
        "name",
        "vendor",
        "origin",
        "isGenAi",
        "businessUnit",
        "owner",
        "lifecycleStage",
      ]),
    );
  });

  it("has an example row the coercions actually accept", async () => {
    const result = await parseInventoryFile(
      "template.csv",
      utf8(templateCsv(SYSTEM_IMPORT)),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mapping = guessMapping(SYSTEM_IMPORT, result.sheet.columns);
    const system = SYSTEM_IMPORT.build(
      result.sheet.rows[0],
      mapping,
      {
        existingNames: [],
        people: [],
        businessUnits: ["Sales"],
        systems: [],
        controls: [],
      },
      new Date("2026-08-20T00:00:00Z"),
    );

    // Nothing fell through to a default, which is what makes the row worth
    // shipping as documentation of the vocabularies.
    expect(system.name).toBe("Otter.ai");
    expect(system.origin).toBe("procured_saas");
    expect(system.isGenAi).toBe(true);
    expect(system.lifecycleStage).toBe("pilot");
    expect(system.businessUnit).toBe("Sales");
  });
});

describe("headers that are not clean", () => {
  it("names a blank header for its column letter rather than dropping it", async () => {
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8("Tool,,Dept\nOtter.ai,x,Sales"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.columns).toEqual(["Tool", "Column B", "Dept"]);
    expect(result.sheet.rows[0]["Column B"]).toBe("x");
  });

  it("numbers a repeated header instead of letting it overwrite the first", async () => {
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8("Tool,Notes,Notes\nOtter.ai,first,second"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.columns).toEqual(["Tool", "Notes", "Notes (2)"]);
    expect(result.sheet.rows[0]).toEqual({
      Tool: "Otter.ai",
      Notes: "first",
      "Notes (2)": "second",
    });
  });

  it("does not count a spreadsheet's blank tail as columns", async () => {
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8("Tool,Dept,,\nOtter.ai,Sales,,"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.columns).toEqual(["Tool", "Dept"]);
  });

  it("builds A1-style letters past Z", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
  });
});

describe("the caps refuse, and never truncate", () => {
  it("accepts a file exactly at the row cap", async () => {
    const rows = Array.from({ length: MAX_ROWS }, (_, i) => `Tool ${i},Sales`);
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8(["Tool,Dept", ...rows].join("\n")),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.rows).toHaveLength(MAX_ROWS);
  });

  it("refuses one row over it rather than importing the first 500", async () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `Tool ${i},Sales`);
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8(["Tool,Dept", ...rows].join("\n")),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The count and the cap both appear, because "too many rows" is not
    // something somebody can act on.
    expect(result.reason).toContain(String(MAX_ROWS + 1));
    expect(result.reason).toContain(String(MAX_ROWS));
  });

  it("refuses a file wider than the column cap", async () => {
    const header = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `C${i}`);
    const result = await parseInventoryFile(
      "tracker.csv",
      utf8([header.join(","), header.map(() => "x").join(",")].join("\n")),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(String(MAX_COLUMNS));
  });
});

describe("files that are not spreadsheets", () => {
  it("turns away a PDF by its bytes, saying why", async () => {
    const result = await parseInventoryFile(
      "policy.csv",
      utf8("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("PDF");
    expect(result.reason).toContain("columns");
  });

  it("turns away a Word document", async () => {
    // ZIP magic plus the entry name that identifies the format — the same
    // signal `sniff` reads, without decompressing anything.
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      utf8("word/document.xml"),
    ]);

    const result = await parseInventoryFile("policy.docx", docx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Word");
  });

  it("refuses an empty file", async () => {
    const result = await parseInventoryFile("tracker.csv", Buffer.alloc(0));
    expect(result.ok).toBe(false);
  });

  it("refuses a header row with nothing under it", async () => {
    const result = await parseInventoryFile("tracker.csv", utf8("Tool,Dept\n"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("nothing under it");
  });
});

describe("the sample spreadsheet goes through the real path", () => {
  it("parses back into the rows it was written from", async () => {
    const result = await parseInventoryFile("sample.csv", utf8(sampleCsv()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sheet.columns).toEqual([...SOURCE_COLUMNS]);
    expect(result.sheet.rows).toEqual(RAW_ROWS);
  });

  it("is guessed exactly as the fixture records — origin and notes unmapped", async () => {
    const result = await parseInventoryFile("sample.csv", utf8(sampleCsv()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    /* The two nulls are the point. "How we got it" is the header the guesser
     * must NOT resolve to origin: teaching it that phrase would make this demo
     * look smarter and delete the reason the mapping table is on the screen. */
    expect(guessMapping(SYSTEM_IMPORT, result.sheet.columns)).toEqual(DEFAULT_MAPPING);
  });
});

describe("guessMapping", () => {
  it("reads the headers a real tracker uses", () => {
    expect(
      guessMapping(SYSTEM_IMPORT, [
        "System Name",
        "Vendor",
        "Department",
        "System Owner",
        "Lifecycle",
      ]),
    ).toEqual({
      "System Name": "name",
      Vendor: "vendor",
      Department: "businessUnit",
      "System Owner": "owner",
      Lifecycle: "lifecycleStage",
    });
  });

  it("ignores punctuation and case, because a person reading them would", () => {
    expect(guessMapping(SYSTEM_IMPORT, ["Uses genAI?", "GEN AI"])).toEqual({
      "Uses genAI?": "isGenAi",
      // Claimed by the first column, so the second is left for a person to
      // decide — we do not know which one they meant.
      "GEN AI": null,
    });
  });

  it("leaves \"Status\" alone, because a tracker means approval by it as often as lifecycle", () => {
    expect(guessMapping(SYSTEM_IMPORT, ["Tool", "Status"])).toEqual({
      Tool: "name",
      Status: null,
    });
  });

  it("leaves a header it does not recognise unmapped rather than dropping it", () => {
    expect(guessMapping(SYSTEM_IMPORT, ["Tool", "Notes", "Cost centre"])).toEqual({
      Tool: "name",
      Notes: null,
      "Cost centre": null,
    });
  });
});
