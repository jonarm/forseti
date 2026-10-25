/**
 * The spreadsheet a prospect already has.
 *
 * This is the demo opener, so the file it imitates is the real artefact: a
 * tracker somebody in procurement kept, with the columns they happened to
 * choose, free text where an enum should be, a supplier column left blank, a
 * department that does not match our list, and a row for a tool already in the
 * inventory. An import preview against clean data proves nothing — the reason
 * anyone would buy this is that their data is not clean.
 *
 * **It is now a file, not a shortcut.** The dialog used to render these rows
 * directly, which meant the sample was the only thing the import could read.
 * `sampleCsv()` serialises them back into the CSV they came from and the
 * "try a sample" link uploads it, so the demo goes through `sniff`, the real
 * parser and the real header guesser exactly as a customer's file does. A
 * sample that took a private path would be a sample that could pass while the
 * feature was broken.
 *
 * **This file is the spreadsheet and nothing else.** What we make of it —
 * validation, the coercions, the row that becomes a system — lives in
 * `../import/system-spec.ts`, because that half runs on the server as well, judged
 * against the tenant's own register rather than against these fixtures. A
 * fixture that could be reached from a route is a fixture that will eventually
 * be one tenant's data checked against another's.
 */
import type { ColumnMapping, ImportRawRow } from "../types";

/** The headers as they appear in the uploaded file, in file order. */
export const SOURCE_COLUMNS = [
  "Tool",
  "Supplier",
  "How we got it",
  "Uses genAI?",
  "Dept",
  "Requested by",
  "Stage",
  "Notes",
] as const;

/**
 * What `guessMapping()` is expected to make of those headers.
 *
 * No longer wired into the dialog — the guesser reads the headers like any
 * other file's — but kept, and asserted in `import-parse.test.ts`, because it
 * is the record of a judgement. Two columns are deliberately unmapped: "How we
 * got it" because its header matches nothing anybody could match without
 * guessing, and "Notes" because it is genuinely nothing of ours. Origin
 * arriving unmapped is what gives the person watching a reason to touch the
 * dropdowns at all, and a guesser taught this one spreadsheet's phrasing would
 * take that away.
 */
export const DEFAULT_MAPPING: ColumnMapping = {
  Tool: "name",
  Supplier: "vendor",
  "How we got it": null,
  "Uses genAI?": "isGenAi",
  Dept: "businessUnit",
  "Requested by": "owner",
  Stage: "lifecycleStage",
  Notes: null,
};

export const IMPORT_FILENAME = "AI tools tracker (Procurement).csv";

export const RAW_ROWS: ImportRawRow[] = [
  {
    Tool: "Otter.ai",
    Supplier: "Otter.ai Inc.",
    "How we got it": "SaaS subscription",
    "Uses genAI?": "yes",
    Dept: "Sales",
    "Requested by": "M. Hallberg",
    Stage: "pilot",
    Notes: "Records external calls",
  },
  {
    Tool: "Grammarly Business",
    Supplier: "Grammarly",
    "How we got it": "SaaS subscription",
    "Uses genAI?": "yes",
    Dept: "Marketing",
    "Requested by": "E. Quinn",
    Stage: "production",
    Notes: "",
  },
  {
    Tool: "Salesforce Einstein",
    Supplier: "",
    "How we got it": "Bundled with CRM",
    "Uses genAI?": "TRUE",
    Dept: "Customer Operations",
    "Requested by": "M. Hallberg",
    Stage: "production",
    Notes: "Came with the CRM renewal",
  },
  {
    Tool: "Microsoft 365 Copilot",
    Supplier: "Microsoft",
    "How we got it": "SaaS subscription",
    "Uses genAI?": "yes",
    Dept: "Technology",
    "Requested by": "S. Devi",
    Stage: "production",
    Notes: "Firm-wide rollout",
  },
  {
    Tool: "Fraud scoring model",
    Supplier: "Built by us",
    "How we got it": "Internal build",
    "Uses genAI?": "no",
    Dept: "Finance",
    "Requested by": "K. Nakamura",
    Stage: "production",
    Notes: "Trained on our transaction history",
  },
  {
    Tool: "Perplexity Enterprise",
    Supplier: "Perplexity AI",
    "How we got it": "SaaS subscription",
    "Uses genAI?": "yes",
    Dept: "Strategy",
    "Requested by": "P. Osei",
    Stage: "trial",
    Notes: "Six seats, research use",
  },
  {
    Tool: "",
    Supplier: "Zapier",
    "How we got it": "SaaS subscription",
    "Uses genAI?": "yes",
    Dept: "Technology",
    "Requested by": "L. Ferreira",
    Stage: "pilot",
    Notes: "Automations with an AI step",
  },
  {
    Tool: "Claude API — claims triage",
    Supplier: "Anthropic",
    "How we got it": "API",
    "Uses genAI?": "yes",
    Dept: "Customer Operations",
    "Requested by": "L. Ferreira",
    Stage: "production",
    Notes: "Called from our own service",
  },
  {
    Tool: "Figma AI features",
    Supplier: "Figma",
    "How we got it": "SaaS subscription",
    "Uses genAI?": "yes",
    Dept: "Marketing",
    "Requested by": "E. Quinn",
    Stage: "production",
    Notes: "Part of the existing plan",
  },
];

/**
 * The fixture, back in the format it came from.
 *
 * Quoting is the whole job: "Claude API — claims triage" is fine unquoted, but a
 * note containing a comma would silently become two columns and the sample
 * would stop being a sample of anything. Rules are RFC 4180 — wrap when the
 * value holds a delimiter, a quote or a newline, and double any quote inside.
 */
export function sampleCsv(): string {
  const escape = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines = [SOURCE_COLUMNS.map(escape).join(",")];
  for (const row of RAW_ROWS) {
    lines.push(SOURCE_COLUMNS.map((column) => escape(row[column] ?? "")).join(","));
  }

  return lines.join("\n");
}
