/**
 * Intake: the two mechanisms that make origin and triage more than labels.
 *
 * **`QUESTION_SETS` is keyed on origin.** This is where decision 2 stops being a
 * badge on a table and starts being a workflow. A procured SaaS tool raises
 * questions about what the vendor committed to; an API integration raises
 * questions about what leaves our boundary and how long it is kept; an internal
 * model raises questions about training data and who may retrain it. Same
 * wizard, same route, same submission record — a different third step. Building
 * three intake forms would have produced three things to maintain and three
 * places for the model to drift.
 *
 * **`TRIAGE_RULES` are data, not closures.** Each rule is a `Predicate`
 * evaluated by the same function the assessment template uses for conditional
 * display. Rules that are data can be listed, versioned, and — the point —
 * shown to the person they affect: the triage panel prints the rules that fired
 * in plain language, so a requester can see exactly why their request needs a
 * governance endorsement rather than a note. A rule written as a closure can
 * only be read by opening the source, so the panel would have nothing to show
 * and the product would be asking for trust it had not earned.
 *
 * The recommendation is never binding. A reviewer may override it, and the
 * override demands a written justification — because the override is the
 * interesting record. A triage engine nobody can overrule gets worked around;
 * one that records why it was overruled gets improved.
 */
import { evaluate, type ValueBag } from "../predicate";
import type {
  IntakeSubmission,
  QuestionSets,
  ReviewType,
  TriageResult,
  TriageRule,
} from "../types";

/* ------------------------------------------------- origin question sets */

export const QUESTION_SETS: QuestionSets = {
  procured_saas: {
    label: "Procured SaaS",
    rationale:
      "You bought a finished product, so the questions are about what the vendor has committed to and how your tenant is configured. The risk you carry is the risk they left with you.",
    fields: [
      {
        id: "saas_contract",
        label: "What are we buying it under?",
        type: "single_select",
        required: true,
        options: [
          { value: "enterprise_agreement", label: "Enterprise agreement", help: "Negotiated terms, signed by legal." },
          { value: "click_through", label: "Click-through terms", help: "Someone accepted the standard terms online." },
          { value: "trial", label: "Free or paid trial", help: "Time-limited, often on standard terms." },
        ],
      },
      {
        id: "saas_dpa",
        label: "Is there a data processing agreement in place?",
        type: "single_select",
        required: true,
        help: "If personal data goes anywhere near this tool, the answer needs to be yes before it goes live.",
        options: [
          { value: "yes", label: "Yes, signed" },
          { value: "pending", label: "Requested, not signed" },
          { value: "no", label: "No" },
          { value: "unknown", label: "I do not know" },
        ],
      },
      {
        id: "saas_trains",
        label: "Does the vendor train its models on our data?",
        type: "single_select",
        required: true,
        options: [
          { value: "no", label: "No — contractually excluded" },
          { value: "opt_out", label: "Only if we do not opt out" },
          { value: "yes", label: "Yes, by default on this plan" },
          { value: "unknown", label: "I do not know" },
        ],
      },
      {
        id: "saas_residency",
        label: "Where does the data come to rest?",
        type: "short_text",
        help: "The region the vendor stores it in, not just where the request goes.",
      },
      {
        id: "saas_admin",
        label: "Can we administer it centrally?",
        type: "single_select",
        options: [
          { value: "yes", label: "Yes — single sign-on and an admin console" },
          { value: "partial", label: "Partly — some settings only" },
          { value: "no", label: "No — users configure it themselves" },
        ],
      },
    ],
  },

  api_integration: {
    label: "API integration",
    rationale:
      "Our own software calls someone else's model, so the questions are about the boundary: what we send, what is kept, and for how long. Nobody else is watching this for us.",
    fields: [
      {
        id: "api_provider",
        label: "Which model, from which provider?",
        type: "short_text",
        required: true,
      },
      {
        id: "api_logging",
        label: "Are prompts and responses logged?",
        type: "single_select",
        required: true,
        options: [
          { value: "ours", label: "Yes — in our own account" },
          { value: "vendor", label: "Yes — by the provider" },
          { value: "both", label: "Both" },
          { value: "none", label: "Not logged at all", help: "Which also means no audit trail." },
        ],
      },
      {
        id: "api_retention",
        label: "How long is any of it retained?",
        type: "single_select",
        required: true,
        options: [
          { value: "none", label: "Not retained" },
          { value: "30_days", label: "Up to 30 days" },
          { value: "90_days", label: "Up to 90 days" },
          { value: "indefinite", label: "Indefinitely, or nobody knows" },
        ],
      },
      {
        id: "api_redaction",
        label: "Is anything stripped before it is sent?",
        type: "single_select",
        options: [
          { value: "pii", label: "Personal identifiers are redacted" },
          { value: "partial", label: "Some fields are excluded" },
          { value: "none", label: "Nothing — the payload goes as-is" },
        ],
      },
      {
        id: "api_boundary",
        label: "Does the data leave our region?",
        type: "single_select",
        options: [
          { value: "no", label: "No — regional endpoint" },
          { value: "transit", label: "In transit only" },
          { value: "yes", label: "Yes" },
          { value: "unknown", label: "I do not know" },
        ],
      },
    ],
  },

  internal_model: {
    label: "Internal model",
    rationale:
      "We built or fine-tuned it, so every obligation a vendor would normally carry is ours: the training data, the evaluation, the drift, and who is allowed to change it.",
    fields: [
      {
        id: "model_training_source",
        label: "What was it trained on?",
        type: "long_text",
        required: true,
        help: "Name the datasets. 'Our own data' is not an answer anyone can check.",
      },
      {
        id: "model_data_rights",
        label: "Do we have the right to use that data for this?",
        type: "single_select",
        required: true,
        options: [
          { value: "yes", label: "Yes — confirmed with legal" },
          { value: "assumed", label: "Assumed, not confirmed" },
          { value: "no", label: "No, or unclear" },
        ],
      },
      {
        id: "model_evaluation",
        label: "How was it evaluated before release?",
        type: "long_text",
        required: true,
        help: "Including how it performs across the groups it will be used on.",
      },
      {
        id: "model_retraining",
        label: "How often is it retrained?",
        type: "single_select",
        options: [
          { value: "scheduled", label: "On a schedule" },
          { value: "triggered", label: "When monitoring says so" },
          { value: "never", label: "Never — trained once" },
        ],
      },
      {
        id: "model_who_retrains",
        label: "Who is allowed to retrain or replace it?",
        type: "short_text",
        help: "A named team or role, not 'engineering'.",
      },
    ],
  },
};

/* --------------------------------------------------------- triage rules */

/**
 * Flatten a submission into something the predicate evaluator can read.
 *
 * `originAnswers` is spread to the top level so a rule can name
 * `saas_dpa` directly instead of knowing it lives one level down. Nothing else
 * in the shape is changed — the rule reads the field the requester answered.
 */
export function toValueBag(submission: IntakeSubmission): ValueBag {
  return { ...submission, ...submission.originAnswers };
}

/**
 * The rules, in the order they read best on screen.
 *
 * `implies: "endorsement"` escalates; `implies: "noting"` is context that fired
 * but does not on its own require a governance decision. Any single escalating
 * rule lifts the whole result, because these are floors and not a score — a
 * system touching special category data does not become safe by also being
 * low-reach.
 */
export const TRIAGE_RULES: TriageRule[] = [
  {
    id: "special-category",
    explain: "It touches special category or health data, which carries the highest duty of care.",
    implies: "endorsement",
    when: { fieldId: "dataCategories", includesAny: ["special_category", "health"] },
  },
  {
    id: "decisions-about-people",
    explain:
      "It informs decisions about individuals, so a wrong or skewed output lands on a person rather than on a process.",
    implies: "endorsement",
    when: { fieldId: "informsDecisionsAboutPeople", equals: true },
  },
  {
    id: "customer-facing-genai",
    explain:
      "It generates content that reaches customers directly, so anything it gets wrong is said in our name.",
    implies: "endorsement",
    when: {
      all: [
        { fieldId: "facesCustomers", equals: true },
        { fieldId: "isGenAi", equals: true },
      ],
    },
  },
  {
    id: "internal-build",
    explain:
      "We are building it ourselves, so the training data, evaluation and drift obligations are all ours.",
    implies: "endorsement",
    when: { fieldId: "origin", equals: "internal_model" },
  },
  {
    id: "no-dpa",
    explain:
      "Personal data is involved and there is no signed data processing agreement with the vendor.",
    implies: "endorsement",
    when: {
      all: [
        { fieldId: "dataCategories", includesAny: ["personal", "special_category", "health", "customer_content"] },
        { fieldId: "saas_dpa", oneOf: ["no", "pending", "unknown"] },
      ],
    },
  },
  {
    id: "vendor-trains",
    explain: "The vendor may train its own models on what we put into this tool.",
    implies: "endorsement",
    when: { fieldId: "saas_trains", oneOf: ["yes", "opt_out", "unknown"] },
  },
  {
    id: "unbounded-retention",
    explain:
      "Prompts or responses are retained indefinitely, or nobody could say for how long.",
    implies: "endorsement",
    when: { fieldId: "api_retention", equals: "indefinite" },
  },
  {
    id: "unredacted-payload",
    explain:
      "Personal data is sent to the model with nothing stripped out of the payload first.",
    implies: "endorsement",
    when: {
      all: [
        { fieldId: "dataCategories", includesAny: ["personal", "special_category", "health"] },
        { fieldId: "api_redaction", equals: "none" },
      ],
    },
  },
  {
    id: "personal-data",
    explain: "It processes personal data, so the privacy notice and retention position need checking.",
    implies: "noting",
    when: { fieldId: "dataCategories", includesAny: ["personal", "customer_content"] },
  },
  {
    id: "customer-facing",
    explain: "It is visible to customers, even though it does not generate content for them.",
    implies: "noting",
    when: { fieldId: "facesCustomers", equals: true },
  },
  {
    id: "click-through",
    explain: "It is being bought on click-through or trial terms rather than a negotiated agreement.",
    implies: "noting",
    when: { fieldId: "saas_contract", oneOf: ["click_through", "trial"] },
  },
];

/**
 * Run every rule and return what fired.
 *
 * Note what this does *not* do: it does not stop at the first escalating rule.
 * The reviewer needs the full list, because three reasons for an endorsement is
 * a different conversation from one, and a rule that fired quietly is the one
 * they will want to argue with.
 */
export function triage(submission: IntakeSubmission): TriageResult {
  const bag = toValueBag(submission);
  const fired = TRIAGE_RULES.filter((rule) => evaluate(rule.when, bag));
  const suggested: ReviewType = fired.some((rule) => rule.implies === "endorsement")
    ? "endorsement"
    : "noting";

  return { suggested, firedRuleIds: fired.map((rule) => rule.id) };
}

export function ruleById(id: string): TriageRule | undefined {
  return TRIAGE_RULES.find((rule) => rule.id === id);
}

/* ------------------------------------------------------- review vocabulary */

export const REVIEW_TYPE: Record<
  ReviewType,
  { label: string; blurb: string; routesTo: string; sla: string }
> = {
  endorsement: {
    label: "Governance endorsement",
    blurb:
      "Goes to the AI Governance Forum for a decision before anything is procured or built. An impact assessment is required and must be approved before go-live.",
    routesTo: "AI Governance Forum",
    sla: "Next scheduled forum, or within 10 working days",
  },
  noting: {
    label: "Noting",
    blurb:
      "Recorded in the inventory and reviewed by the AI Governance Lead without a forum decision. An impact assessment is still required if the system reaches production.",
    routesTo: "AI Governance Lead",
    sla: "Within 5 working days",
  },
};

/** The four ways a review ends. */
export const DECISIONS = [
  {
    id: "endorse",
    label: "Endorse",
    blurb: "Decision recorded. Register the system and create its impact assessment separately.",
    tone: "ok" as const,
  },
  {
    id: "note",
    label: "Note",
    blurb: "Decision recorded without a forum decision. Inventory registration and review scheduling remain separate steps.",
    tone: "info" as const,
  },
  {
    id: "more_info",
    label: "Needs more info",
    blurb: "Returned to the requester with questions. Nothing is registered until it comes back.",
    tone: "warn" as const,
  },
  {
    id: "reject",
    label: "Reject",
    blurb: "Not approved. The reason is recorded and visible to the requester.",
    tone: "critical" as const,
  },
];

/** A worked example, so the demo can reach the decision screen in two clicks. */
export const EXAMPLE_SUBMISSION: IntakeSubmission = {
  name: "Sales call coaching assistant",
  description:
    "Listens to recorded sales calls and scores each rep against the qualification framework, with coaching notes for their manager.",
  businessUnit: "Customer Operations",
  origin: "procured_saas",
  isGenAi: true,
  vendor: "Cadence AI",
  dataCategories: ["personal", "confidential", "customer_content"],
  facesCustomers: false,
  informsDecisionsAboutPeople: true,
  originAnswers: {
    saas_contract: "trial",
    saas_dpa: "pending",
    saas_trains: "opt_out",
    saas_residency: "US, with an EU option on the enterprise plan",
    saas_admin: "partial",
  },
};
