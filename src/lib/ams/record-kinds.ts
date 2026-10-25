/**
 * Which registers exist, and what may be done to each.
 *
 * Forseti has eight registers and they had almost nothing in common in code:
 * the inventory grew tick boxes, a bulk delete and a three-format export, and
 * the other six were read-only tables that happened to look similar. This is
 * the description they now share — one entry per kind, naming the labels a
 * screen shows, the permission resource a route checks, the columns a file can
 * carry, and which of the four features the kind actually supports.
 *
 * **Client-safe on purpose.** Everything here is data and pure functions: the
 * column resolvers read `labels.ts` and the `Workspace`, both of which the
 * browser already has. The half that knows how to *fetch* and *delete* a kind
 * lives in `src/lib/records.ts`, which imports the database and must never be
 * pulled into a component — a registry that mixed the two would put the DB
 * client in every register's bundle.
 *
 * **The feature flags are not decoration.** Assessments and questionnaires can
 * be exported and removed but not imported: they are produced inside the
 * product rather than migrated into it. Evidence "import" means uploading
 * documents, not mapping spreadsheet columns, which is a different feature
 * wearing the same word — so it is named `files` rather than `rows`. Encoding
 * that here is what lets one toolbar render the right buttons for eight
 * registers without a conditional in each of them. `link` is the fourth and the
 * newest: whether a record already in the register can be attached to a system
 * afterwards, and on what terms.
 */
import type { ErasedColumn } from "./export-format";
import type { ImportSpec } from "./import-spec";
import { FINDING_IMPORT } from "./import/finding-spec";
import { RISK_IMPORT } from "./import/risk-spec";
import { SYSTEM_IMPORT } from "./import/system-spec";
import { USE_CASE_IMPORT } from "./import/use-case-spec";
import { DEFAULT_SYSTEM_COLUMNS, SYSTEM_COLUMNS } from "./inventory-export";
import {
  ASSESSMENT_COLUMNS,
  DEFAULT_ASSESSMENT_COLUMNS,
} from "./assessment-export";
import { DEFAULT_EVIDENCE_COLUMNS, EVIDENCE_COLUMNS } from "./evidence-export";
import { DEFAULT_FINDING_COLUMNS, FINDING_COLUMNS } from "./finding-export";
import { DEFAULT_INTAKE_COLUMNS, INTAKE_COLUMNS } from "./intake-export";
import {
  DEFAULT_QUESTIONNAIRE_COLUMNS,
  QUESTIONNAIRE_COLUMNS,
} from "./questionnaire-export";
import { DEFAULT_RISK_COLUMNS, RISK_COLUMNS } from "./risk-export";
import { DEFAULT_USE_CASE_COLUMNS, USE_CASE_COLUMNS } from "./use-case-export";

/**
 * The registers, by the name their routes and audit rows use.
 *
 * These strings appear in URLs (`/api/records/[kind]/export`) and in stored
 * audit entries, so they are a stable vocabulary rather than a display detail —
 * renaming one is a migration, not a rename.
 */
export type RecordKind =
  | "system"
  | "useCase"
  | "risk"
  | "finding"
  | "evidence"
  | "assessment"
  | "questionnaire"
  | "intake";

/**
 * How a record already in a register is attached to a system, if at all.
 *
 * Two styles rather than a boolean, because they are genuinely different acts
 * and collapsing them would hide the one that costs something:
 *
 *   - `attach` is **additive**. Evidence carries a set of system links rather
 *     than a column, so one SOC 2 report supports ten systems and adding an
 *     eleventh takes nothing away from the other ten. Many at a time, and no
 *     record loses anything.
 *   - `file` is **exclusive**. A risk and a finding each carry a single
 *     `system_id`, so putting one on this system is taking it off wherever it
 *     was. Only records sitting at organisation level are ever offered, which
 *     is what keeps a filing from being a silent transfer between two systems.
 *
 * `false` is the answer for the registers whose parent is fixed at creation —
 * an assessment is about one system and stays that way.
 *
 * A use case used to be in that list and no longer is. Its systems moved into
 * `ai_use_case_system`, so a purpose reaches as many tools as actually do it,
 * and the relation is edited through `/api/use-cases/{link,unlink}` rather than
 * as a field. `attach` is right for it in both senses: adding a system takes
 * nothing away from the others, and the one rule the join cannot express — that
 * the last system may not be removed — lives in the unlink route.
 *
 * **The style also names the statement the act gates on**, and the pairing is
 * not arbitrary. `attach` writes a link and gates on `create` — the `evidence`
 * resource has no `update` statement at all, in the access control definition or
 * on any of the five roles, because a document is filed rather than edited.
 * `file` changes a column on an existing record and gates on `update`, which is
 * the statement the risk register's own edit route already checks.
 */
export type LinkStyle = false | "attach" | "file";

/** How a register may be filled from outside. */
export type ImportStyle =
  /** Not at all — the records are produced in the product. */
  | false
  /** A spreadsheet, through the column mapper. */
  | "rows"
  /** Documents, through the upload pipeline. */
  | "files";

export interface RecordKindDef {
  kind: RecordKind;
  /** "system" / "systems", for counts and buttons. */
  singular: string;
  plural: string;
  /** What the file is called and what the export dialog is titled. */
  title: string;
  /**
   * The resource in `permissions.ts` whose statements gate this kind.
   *
   * One name, four actions: a route asks for `{ [resource]: ["export"] }` or
   * `["delete"]` and never has to know which register it is serving.
   */
  resource: string;
  features: {
    export: boolean;
    /** Soft delete, with the row recoverable until the retention window ends. */
    delete: boolean;
    import: ImportStyle;
    /** Attaching an existing record to a system, from that system's profile. */
    link: LinkStyle;
  };
  /** Everything a file could carry, in the order a file lays it out. */
  columns: readonly ErasedColumn[];
  /** Ticked when the export dialog opens — usually the columns the table shows. */
  defaultColumns: readonly string[];
  /**
   * How a spreadsheet becomes records here. Present exactly when
   * `features.import` is `"rows"`; the route checks both, because a flag
   * without a spec is a screen offering an import nothing can apply.
   */
  importSpec?: ImportSpec<unknown>;
}

/**
 * The registry.
 *
 * Kinds arrive here as their modules are built. A kind that is present but has
 * every feature off is still useful: it names the register, so the shared
 * toolbar can be dropped into it and light up one feature at a time rather than
 * waiting for all four.
 */
export const RECORD_KINDS: Record<RecordKind, RecordKindDef> = {
  system: {
    kind: "system",
    singular: "system",
    plural: "systems",
    title: "AI inventory",
    resource: "system",
    features: { export: true, delete: true, import: "rows", link: false },
    columns: SYSTEM_COLUMNS,
    defaultColumns: DEFAULT_SYSTEM_COLUMNS,
    importSpec: SYSTEM_IMPORT as ImportSpec<unknown>,
  },

  useCase: {
    kind: "useCase",
    singular: "use case",
    plural: "use cases",
    title: "Use cases",
    /* Its own resource, not `system`. See `permissions.ts` for why a use case is
     * not a property of the system that runs it. */
    resource: "useCase",
    /* An organisation part way through an AI audit usually has a tab called "AI
     * usage" with a row per team. That is a use-case register that has never
     * been called one, and importing it is the fastest this screen ever gets
     * filled. */
    features: { export: true, delete: true, import: "rows", link: "attach" },
    columns: USE_CASE_COLUMNS,
    defaultColumns: DEFAULT_USE_CASE_COLUMNS,
    importSpec: USE_CASE_IMPORT as ImportSpec<unknown>,
  },

  risk: {
    kind: "risk",
    singular: "risk",
    plural: "risks",
    title: "Risk register",
    resource: "risk",
    /* A risk log in Excel predates every tool that replaces it, which is the
     * whole argument for importing one. */
    features: { export: true, delete: true, import: "rows", link: "file" },
    columns: RISK_COLUMNS,
    defaultColumns: DEFAULT_RISK_COLUMNS,
    importSpec: RISK_IMPORT as ImportSpec<unknown>,
  },

  /*
   * Intake is last. Its queue is still React state over fixtures, so delete and
   * export there mean nothing until it persists — see `records.ts`.
   */
  finding: {
    kind: "finding",
    singular: "finding",
    plural: "findings",
    title: "Findings",
    resource: "finding",
    /* Findings arrive from outside more often than any other register: an
     * external auditor sends a report, and what lands in an inbox is a table. */
    features: { export: true, delete: true, import: "rows", link: "file" },
    columns: FINDING_COLUMNS,
    defaultColumns: DEFAULT_FINDING_COLUMNS,
    importSpec: FINDING_IMPORT as ImportSpec<unknown>,
  },
  evidence: {
    kind: "evidence",
    singular: "document",
    plural: "documents",
    title: "Evidence register",
    resource: "evidence",
    /* The one import that is not a spreadsheet. Filling this register means
     * documents through the sniff/zip-guard/extract pipeline, not mapped
     * columns — a different feature wearing the same word, which is why the
     * registry names the difference rather than a boolean. */
    features: { export: true, delete: true, import: "files", link: "attach" },
    columns: EVIDENCE_COLUMNS,
    defaultColumns: DEFAULT_EVIDENCE_COLUMNS,
  },
  assessment: {
    kind: "assessment",
    singular: "assessment",
    plural: "assessments",
    title: "Impact assessments",
    resource: "assessment",
    /* Import stays off for good, not for now: an assessment is answered inside
     * the product against a template, and a spreadsheet of answers would arrive
     * with no sign-off chain and no way to have one. */
    features: { export: true, delete: true, import: false, link: false },
    columns: ASSESSMENT_COLUMNS,
    defaultColumns: DEFAULT_ASSESSMENT_COLUMNS,
  },
  questionnaire: {
    kind: "questionnaire",
    singular: "questionnaire",
    plural: "questionnaires",
    title: "Questionnaires",
    resource: "questionnaire",
    /* Import stays off for good. A questionnaire arrives as somebody else's
     * document and is answered here; the answers are ephemeral by design and
     * there is nothing a spreadsheet could bring in that this register keeps. */
    features: { export: true, delete: true, import: false, link: false },
    columns: QUESTIONNAIRE_COLUMNS,
    defaultColumns: DEFAULT_QUESTIONNAIRE_COLUMNS,
  },
  intake: {
    kind: "intake",
    singular: "request",
    plural: "requests",
    title: "Intake requests",
    resource: "intake",
    /* Import is off. A request is somebody in this organisation asking
     * permission through the form; a spreadsheet of requests would be a queue
     * of askings nobody made, with no submitter and no triage behind them. */
    features: { export: true, delete: true, import: false, link: false },
    columns: INTAKE_COLUMNS,
    defaultColumns: DEFAULT_INTAKE_COLUMNS,
  },
};

export const RECORD_KIND_IDS = Object.keys(RECORD_KINDS) as RecordKind[];

/**
 * A kind from an untrusted string — a URL segment, or a stored audit row.
 *
 * `Object.hasOwn` rather than a plain lookup, and that is not pedantry: the
 * value comes straight out of a URL path, and `RECORD_KINDS["constructor"]`
 * walks the prototype chain and hands back a function. The route would then see
 * a truthy `def`, read `.features` off it, and answer a 500 where it owed a
 * clean 404. Every inherited key on `Object.prototype` is a way in.
 */
export function recordKind(value: unknown): RecordKindDef | null {
  if (typeof value !== "string") return null;
  if (!Object.hasOwn(RECORD_KINDS, value)) return null;
  return RECORD_KINDS[value as RecordKind];
}

/** "3 systems", "1 risk" — the phrase four different screens were building. */
export function countOf(def: RecordKindDef, n: number): string {
  return `${n} ${n === 1 ? def.singular : def.plural}`;
}
