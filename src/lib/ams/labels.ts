/**
 * How every enum in the model is spoken and coloured.
 *
 * One place, so a system that is "In production" on the inventory is never
 * "Live" on its own profile, and so the decision about *which* states earn
 * colour is made once rather than per component. The rule applied throughout:
 * a state gets a tone only if someone has to act on it. Lifecycle is entirely
 * neutral — a pilot is not a problem — while an overdue assessment is critical
 * because it is a broken promise to an auditor.
 *
 * Every entry pairs a label with the tone, so no component ever renders colour
 * without the word beside it.
 */
import type {
  Applicability,
  AssessmentStatus,
  DataCategory,
  DeploymentModel,
  EvidenceType,
  ImplementationStatus,
  LifecycleStage,
  OversightLevel,
  RiskTier,
  SystemOrigin,
  UseCaseStatus,
  AiCharacteristic,
} from "./types";
import type { Tone } from "./tone";

export interface Vocab {
  label: string;
  tone: Tone;
}

/**
 * Origin gets the "info" tone rather than neutral in exactly one place — it is
 * the field that decides which question set a system answers, so it is worth
 * being able to scan a column for. The short forms exist because the full ones
 * do not fit a dense table.
 */
export const ORIGIN: Record<SystemOrigin, Vocab & { short: string; blurb: string }> = {
  procured_saas: {
    label: "Procured SaaS",
    short: "SaaS",
    tone: "neutral",
    blurb:
      "Bought as a finished product. The questions are about vendor commitments, tenant configuration and what the contract permits.",
  },
  api_integration: {
    label: "API integration",
    short: "API",
    tone: "neutral",
    blurb:
      "A model called directly from our own software. The questions are about prompt logging, token retention and what leaves our boundary.",
  },
  internal_model: {
    label: "Internal model",
    short: "Internal",
    tone: "neutral",
    blurb:
      "Built or fine-tuned in house. The questions are about training data, evaluation, drift and who may retrain it.",
  },
};

export const LIFECYCLE: Record<LifecycleStage, Vocab> = {
  proposed: { label: "Proposed", tone: "neutral" },
  poc: { label: "Proof of concept", tone: "neutral" },
  pilot: { label: "Pilot", tone: "neutral" },
  production: { label: "Production", tone: "neutral" },
  deprecated: { label: "Deprecated", tone: "neutral" },
  retired: { label: "Retired", tone: "neutral" },
};

/**
 * The one enum where colour is the message. Tiers follow the familiar
 * regulatory ladder, and "unacceptable" is critical because it means stop.
 */
export const RISK_TIER: Record<RiskTier, Vocab> = {
  minimal: { label: "Minimal", tone: "neutral" },
  limited: { label: "Limited", tone: "info" },
  high: { label: "High", tone: "warn" },
  unacceptable: { label: "Unacceptable", tone: "critical" },
};

export const ASSESSMENT_STATUS: Record<AssessmentStatus, Vocab> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "neutral" },
  submitted: { label: "Submitted", tone: "info" },
  endorsed: { label: "Endorsed", tone: "info" },
  approved: { label: "Approved", tone: "ok" },
  overdue: { label: "Overdue", tone: "critical" },
};

export const APPLICABILITY: Record<Applicability, Vocab> = {
  yes: { label: "Applicable", tone: "ok" },
  no: { label: "Excluded", tone: "warn" },
  na: { label: "Not applicable", tone: "neutral" },
};

export const IMPLEMENTATION: Record<ImplementationStatus, Vocab> = {
  not_started: { label: "Not started", tone: "critical" },
  planned: { label: "Planned", tone: "warn" },
  in_progress: { label: "In progress", tone: "warn" },
  implemented: { label: "Implemented", tone: "ok" },
  not_applicable: { label: "N/A", tone: "neutral" },
};

export const OVERSIGHT: Record<OversightLevel, Vocab & { blurb: string }> = {
  human_in_the_loop: {
    label: "Human in the loop",
    tone: "ok",
    blurb: "A person reviews and confirms every output before it has an effect.",
  },
  human_on_the_loop: {
    label: "Human on the loop",
    tone: "info",
    blurb: "Output takes effect immediately; a person monitors and can intervene.",
  },
  human_in_command: {
    label: "Human in command",
    tone: "info",
    blurb: "A person sets the boundaries and can switch the system off, but does not see each output.",
  },
  none: {
    label: "No oversight",
    tone: "critical",
    blurb: "Nobody reviews, monitors or can readily intervene. This is a finding.",
  },
};

/**
 * All four neutral, deliberately.
 *
 * Nothing here is a state anyone has to act on: a proposal is a proposal and a
 * retired use case is a job that stopped. What earns colour on a use case is its
 * tier and its oversight, and giving status a tone as well would put three
 * competing colours on one row.
 */
export const USE_CASE_STATUS: Record<UseCaseStatus, Vocab> = {
  active: { label: "Active", tone: "neutral" },
  piloting: { label: "Piloting", tone: "neutral" },
  proposed: { label: "Proposed", tone: "neutral" },
  retired: { label: "Retired", tone: "neutral" },
};

export const DATA_CATEGORY: Record<DataCategory, Vocab> = {
  public: { label: "Public", tone: "neutral" },
  internal: { label: "Internal", tone: "neutral" },
  confidential: { label: "Confidential", tone: "warn" },
  personal: { label: "Personal data", tone: "warn" },
  special_category: { label: "Special category", tone: "critical" },
  financial: { label: "Financial", tone: "warn" },
  health: { label: "Health", tone: "critical" },
  customer_content: { label: "Customer content", tone: "warn" },
  source_code: { label: "Source code", tone: "warn" },
};

export const CHARACTERISTIC: Record<AiCharacteristic, string> = {
  generative: "Generative",
  predictive: "Predictive",
  vision: "Vision",
  nlp: "Natural language",
  agentic: "Agentic",
  recommendation: "Recommendation",
};

export const DEPLOYMENT: Record<DeploymentModel, string> = {
  vendor_multi_tenant: "Vendor cloud, multi-tenant",
  vendor_dedicated: "Vendor cloud, dedicated tenant",
  private_cloud: "Our private cloud",
  on_premise: "On premise",
  hybrid: "Hybrid",
};

/**
 * Verification state, which is the difference between a document and proof.
 *
 * The only enum here where the unhappy values outnumber the happy one, and
 * deliberately so: an expired document still sits in the register looking like
 * evidence, and the whole job of this vocabulary is to stop a control that
 * relies on it reading as satisfied.
 */
export const VERIFICATION: Record<string, Vocab> = {
  verified: { label: "Verified", tone: "ok" },
  unverified: { label: "Unverified", tone: "warn" },
  expired: { label: "Expired", tone: "critical" },
  rejected: { label: "Rejected", tone: "critical" },
};

export const EVIDENCE_TYPE: Record<EvidenceType, string> = {
  policy: "Policy",
  screenshot: "Screenshot",
  configuration_export: "Configuration export",
  meeting_minutes: "Meeting minutes",
  contract: "Contract",
  test_result: "Test result",
  training_record: "Training record",
  log_extract: "Log extract",
};

export const CONTRACT_TYPE: Record<string, string> = {
  enterprise_agreement: "Enterprise agreement",
  click_through: "Click-through terms",
  trial: "Trial terms",
  internal: "Internal — no external contract",
};

export const DISCOVERED_VIA: Record<string, string> = {
  manual: "Registered manually",
  import: "Imported from spreadsheet",
  sso_logs: "Found in single sign-on logs",
  expense_report: "Found in expense reports",
};

/** Dates render one way across the product: unambiguous, sortable by eye. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** A review date that has passed is the single most common overdue signal. */
export function isOverdue(iso: string, today = utcToday()): boolean {
  return new Date(iso) < new Date(today);
}

/** UTC calendar date, evaluated per call rather than pinned to the demo timeline. */
export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
