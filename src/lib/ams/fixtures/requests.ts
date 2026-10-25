/**
 * The intake queue — a quarter of governance work.
 *
 * Twelve requests across every state, because the queue is the screen that
 * tells a compliance lead whether this product would actually change their
 * week. Two things it has to show honestly:
 *
 *   - **Things sit.** Three of these have been waiting longer than the stated
 *     service level, and one has been with the requester for a fortnight
 *     because nobody chased it. A queue where everything is inside its SLA is a
 *     queue nobody recognises, and it makes the ageing column look decorative.
 *   - **Rejection is a real outcome.** Two were refused and one is a duplicate
 *     of something already in the inventory. Neither produced a system, which is
 *     the whole reason a request is its own object.
 *
 * `createdSystemId` points at the inventory row a decision produced, so the two
 * headline systems that came through intake can be traced back to the request
 * that authorised them.
 */
import type { IntakeRequest, RequestStatus } from "../types";

export const REQUESTS: IntakeRequest[] = [
  {
    id: "req-041",
    reference: "REQ-2026-041",
    submission: {
      name: "Meeting transcription for client workshops",
      description:
        "Record and transcribe discovery workshops with clients so consultants can write up findings without taking notes during the session.",
      businessUnit: "Customer Operations",
      origin: "procured_saas",
      isGenAi: true,
      vendor: "Sonix",
      dataCategories: ["personal", "confidential", "customer_content"],
      facesCustomers: true,
      informsDecisionsAboutPeople: false,
      originAnswers: {
        saas_contract: "click_through",
        saas_dpa: "no",
        saas_trains: "unknown",
        saas_residency: "Not stated in the terms",
        saas_admin: "no",
      },
    },
    submittedById: "p-hallberg",
    submittedAt: "2026-08-07",
    status: "awaiting_decision",
    reviewerId: "p-anders",
    reviewType: "endorsement",
    overrideJustification: null,
    decision: null,
    decidedById: null,
    decidedAt: null,
    comments: "",
    createdSystemId: null,
  },
  {
    id: "req-040",
    reference: "REQ-2026-040",
    submission: {
      name: "Expense receipt categorisation",
      description:
        "Read submitted receipts and propose the expense category and cost centre, which the claimant confirms before submitting.",
      businessUnit: "Finance",
      origin: "procured_saas",
      isGenAi: false,
      vendor: "Ledgerline",
      dataCategories: ["financial", "internal"],
      facesCustomers: false,
      informsDecisionsAboutPeople: false,
      originAnswers: {
        saas_contract: "enterprise_agreement",
        saas_dpa: "yes",
        saas_trains: "no",
        saas_residency: "EU — Frankfurt",
        saas_admin: "yes",
      },
    },
    submittedById: "p-schulz",
    submittedAt: "2026-08-06",
    status: "awaiting_decision",
    reviewerId: "p-anders",
    reviewType: "noting",
    overrideJustification: null,
    decision: null,
    decidedById: null,
    decidedAt: null,
    comments: "",
    createdSystemId: null,
  },
  {
    id: "req-039",
    reference: "REQ-2026-039",
    submission: {
      name: "Candidate sourcing assistant",
      description:
        "Search public professional profiles and rank potential candidates against an open role before a recruiter contacts them.",
      businessUnit: "People",
      origin: "procured_saas",
      isGenAi: true,
      vendor: "Hirewell Systems",
      dataCategories: ["personal", "special_category"],
      facesCustomers: false,
      informsDecisionsAboutPeople: true,
      originAnswers: {
        saas_contract: "trial",
        saas_dpa: "pending",
        saas_trains: "opt_out",
        saas_residency: "EU — Dublin",
        saas_admin: "partial",
      },
    },
    submittedById: "p-boateng",
    submittedAt: "2026-07-28",
    status: "awaiting_triage",
    reviewerId: "p-anders",
    reviewType: null,
    overrideJustification: null,
    decision: null,
    decidedById: null,
    decidedAt: null,
    comments: "",
    createdSystemId: null,
  },
  {
    id: "req-038",
    reference: "REQ-2026-038",
    submission: {
      name: "Pricing recommendation engine",
      description:
        "Suggest a discount band for each renewal quote based on account history and comparable deals.",
      businessUnit: "Finance",
      origin: "internal_model",
      isGenAi: false,
      vendor: "",
      dataCategories: ["financial", "confidential", "personal"],
      facesCustomers: true,
      informsDecisionsAboutPeople: true,
      originAnswers: {
        model_training_source: "Three years of closed-won quotes and renewal outcomes from the CRM.",
        model_data_rights: "assumed",
        model_evaluation: "Backtested against last year's renewals. No fairness testing across customer segments yet.",
        model_retraining: "scheduled",
        model_who_retrains: "Data & Analytics",
      },
    },
    submittedById: "p-nakamura",
    submittedAt: "2026-07-24",
    status: "needs_more_info",
    reviewerId: "p-anders",
    reviewType: "endorsement",
    overrideJustification: null,
    decision: "more_info",
    decidedById: "p-anders",
    decidedAt: "2026-07-29",
    comments:
      "Two things before this can go to the forum: confirm with legal that we have the right to use closed-won data this way, and describe how you would detect a discount pattern that disadvantaged a segment. Sitting with the requester since 29 July.",
    createdSystemId: null,
  },
  {
    id: "req-037",
    reference: "REQ-2026-037",
    submission: {
      name: "Employee sentiment analysis on survey free text",
      description:
        "Analyse free-text answers in the engagement survey to score sentiment per team and flag teams at risk.",
      businessUnit: "People",
      origin: "procured_saas",
      isGenAi: true,
      vendor: "Pulseboard",
      dataCategories: ["personal", "special_category", "confidential"],
      facesCustomers: false,
      informsDecisionsAboutPeople: true,
      originAnswers: {
        saas_contract: "click_through",
        saas_dpa: "no",
        saas_trains: "yes",
        saas_residency: "US",
        saas_admin: "no",
      },
    },
    submittedById: "p-boateng",
    submittedAt: "2026-07-15",
    status: "rejected",
    reviewerId: "p-anders",
    reviewType: "endorsement",
    overrideJustification: null,
    decision: "reject",
    decidedById: "p-oyelaran",
    decidedAt: "2026-07-22",
    comments:
      "Refused. The survey is run on a promise of anonymity, and per-team sentiment scoring on a sample this size makes individuals identifiable. The vendor also trains on submitted data under click-through terms. No configuration of this tool would make it acceptable.",
    createdSystemId: null,
  },
  {
    id: "req-036",
    reference: "REQ-2026-036",
    submission: {
      name: "Customer order status agent",
      description:
        "A public agent on the help centre answering where an order is, from the order system and the shipping feed.",
      businessUnit: "Customer Operations",
      origin: "procured_saas",
      isGenAi: true,
      vendor: "Microsoft",
      dataCategories: ["personal", "customer_content", "confidential"],
      facesCustomers: true,
      informsDecisionsAboutPeople: false,
      originAnswers: {
        saas_contract: "enterprise_agreement",
        saas_dpa: "yes",
        saas_trains: "no",
        saas_residency: "EU West",
        saas_admin: "yes",
      },
    },
    submittedById: "p-hallberg",
    submittedAt: "2026-02-10",
    status: "endorsed",
    reviewerId: "p-anders",
    reviewType: "endorsement",
    overrideJustification: null,
    decision: "endorse",
    decidedById: "p-oyelaran",
    decidedAt: "2026-02-17",
    comments:
      "Endorsed on condition that the agent hands off to a human on any refund or complaint intent, and that transcript sampling starts before the pilot widens.",
    createdSystemId: "sys-copilot-studio",
  },
  {
    id: "req-035",
    reference: "REQ-2026-035",
    submission: {
      name: "Translation for the support desk",
      description:
        "Translate inbound customer messages and outbound replies across the languages the desk covers.",
      businessUnit: "Customer Operations",
      origin: "procured_saas",
      isGenAi: true,
      vendor: "DeepL",
      dataCategories: ["personal", "customer_content"],
      facesCustomers: true,
      informsDecisionsAboutPeople: false,
      originAnswers: {
        saas_contract: "enterprise_agreement",
        saas_dpa: "yes",
        saas_trains: "no",
        saas_residency: "EU — text discarded after translation",
        saas_admin: "yes",
      },
    },
    submittedById: "p-hallberg",
    submittedAt: "2025-07-12",
    status: "noted",
    reviewerId: "p-anders",
    reviewType: "noting",
    overrideJustification:
      "The rules escalated this because it is customer-facing generative AI. In practice it translates a message a person has already written and is about to send — the human is in the loop by construction, and the vendor discards the text. Noting is proportionate.",
    decision: "note",
    decidedById: "p-anders",
    decidedAt: "2025-07-19",
    comments: "Recorded and scheduled for annual review.",
    createdSystemId: "sys-translate",
  },
  {
    id: "req-034",
    reference: "REQ-2026-034",
    submission: {
      name: "Slide deck generator",
      description: "Generate a first-draft deck from a written brief for internal presentations.",
      businessUnit: "Marketing",
      origin: "procured_saas",
      isGenAi: true,
      vendor: "Tome",
      dataCategories: ["internal"],
      facesCustomers: false,
      informsDecisionsAboutPeople: false,
      originAnswers: {
        saas_contract: "trial",
        saas_dpa: "pending",
        saas_trains: "opt_out",
        saas_residency: "US",
        saas_admin: "no",
      },
    },
    submittedById: "p-quinn",
    submittedAt: "2026-06-30",
    status: "noted",
    reviewerId: "p-anders",
    reviewType: "noting",
    overrideJustification: null,
    decision: "note",
    decidedById: "p-anders",
    decidedAt: "2026-07-03",
    comments: "Internal use, internal data only. Noted. Revisit if it moves beyond the trial.",
    createdSystemId: "sys-adcopy",
  },
  {
    id: "req-033",
    reference: "REQ-2026-033",
    submission: {
      name: "Contract clause review",
      description: "Flag unusual clauses in inbound supplier contracts against our playbook.",
      businessUnit: "Legal",
      origin: "procured_saas",
      isGenAi: true,
      vendor: "Lexolve",
      dataCategories: ["confidential", "internal"],
      facesCustomers: false,
      informsDecisionsAboutPeople: false,
      originAnswers: {
        saas_contract: "trial",
        saas_dpa: "no",
        saas_trains: "no",
        saas_residency: "EU — Stockholm",
        saas_admin: "partial",
      },
    },
    submittedById: "p-larsen",
    submittedAt: "2026-07-30",
    status: "awaiting_decision",
    reviewerId: "p-anders",
    reviewType: "noting",
    overrideJustification: null,
    decision: null,
    decidedById: null,
    decidedAt: null,
    comments: "",
    createdSystemId: null,
  },
  {
    id: "req-032",
    reference: "REQ-2026-032",
    submission: {
      name: "AI notetaker for external calls",
      description: "Join customer and prospect calls to record, transcribe and summarise them.",
      businessUnit: "Marketing",
      origin: "procured_saas",
      isGenAi: true,
      vendor: "Convene Labs",
      dataCategories: ["personal", "confidential", "customer_content"],
      facesCustomers: true,
      informsDecisionsAboutPeople: false,
      originAnswers: {
        saas_contract: "click_through",
        saas_dpa: "no",
        saas_trains: "yes",
        saas_residency: "US — no regional option",
        saas_admin: "no",
      },
    },
    submittedById: "p-anders",
    submittedAt: "2026-07-14",
    status: "awaiting_decision",
    reviewerId: "p-anders",
    reviewType: "endorsement",
    overrideJustification: null,
    decision: null,
    decidedById: null,
    decidedAt: null,
    comments:
      "Raised retrospectively by the governance lead after the tool was found in the expense ledger. It is already in use, which is why the inventory row exists ahead of a decision.",
    createdSystemId: "sys-notetaker",
  },
  {
    id: "req-031",
    reference: "REQ-2026-031",
    submission: {
      name: "Second Copilot licence pool for Finance",
      description:
        "Extend the existing Microsoft 365 Copilot deployment to the finance team.",
      businessUnit: "Finance",
      origin: "procured_saas",
      isGenAi: true,
      vendor: "Microsoft",
      dataCategories: ["internal", "confidential", "financial"],
      facesCustomers: false,
      informsDecisionsAboutPeople: false,
      originAnswers: {
        saas_contract: "enterprise_agreement",
        saas_dpa: "yes",
        saas_trains: "no",
        saas_residency: "EU Data Boundary",
        saas_admin: "yes",
      },
    },
    submittedById: "p-schulz",
    submittedAt: "2026-06-18",
    status: "rejected",
    reviewerId: "p-anders",
    reviewType: "noting",
    overrideJustification: null,
    decision: "reject",
    decidedById: "p-anders",
    decidedAt: "2026-06-19",
    comments:
      "Closed as a duplicate rather than refused on the merits. Microsoft 365 Copilot is already registered and approved; extending it to another team is a change to the existing system, not a new one. Raise it against the inventory record instead.",
    createdSystemId: null,
  },
  {
    id: "req-030",
    reference: "REQ-2026-030",
    submission: {
      name: "Claim triage service",
      description:
        "Call a hosted model from our own service to extract structured fields from an inbound claim and propose a routing category.",
      businessUnit: "Customer Operations",
      origin: "api_integration",
      isGenAi: true,
      vendor: "Anthropic",
      dataCategories: ["personal", "special_category", "financial", "confidential"],
      facesCustomers: false,
      informsDecisionsAboutPeople: true,
      originAnswers: {
        api_provider: "Claude, hosted API",
        api_logging: "ours",
        api_retention: "30_days",
        api_redaction: "partial",
        api_boundary: "no",
      },
    },
    submittedById: "p-ferreira",
    submittedAt: "2025-09-08",
    status: "endorsed",
    reviewerId: "p-anders",
    reviewType: "endorsement",
    overrideJustification: null,
    decision: "endorse",
    decidedById: "p-oyelaran",
    decidedAt: "2025-09-19",
    comments:
      "Endorsed. Conditions: prompt retention capped at 30 days in our own account, every extracted field confirmed by a handler before the claim advances, and overrides logged.",
    createdSystemId: "sys-claim-triage-api",
  },
];

export const REQUEST_STATUS: Record<
  RequestStatus,
  { label: string; tone: "ok" | "warn" | "critical" | "info" | "neutral"; open: boolean }
> = {
  awaiting_triage: { label: "Awaiting triage", tone: "warn", open: true },
  awaiting_decision: { label: "Awaiting decision", tone: "warn", open: true },
  needs_more_info: { label: "With requester", tone: "info", open: true },
  endorsed: { label: "Endorsed", tone: "ok", open: false },
  noted: { label: "Noted", tone: "ok", open: false },
  rejected: { label: "Rejected", tone: "neutral", open: false },
};

/**
 * How long it has been sitting, in days.
 *
 * Measured from submission for anything still open and from the decision for
 * anything closed, because those are two different questions: how long has this
 * person been waiting, versus how long did we take.
 */
export function daysWaiting(request: IntakeRequest, today = "2026-08-10"): number {
  const from = REQUEST_STATUS[request.status].open
    ? request.submittedAt
    : (request.decidedAt ?? request.submittedAt);
  const ms = new Date(today).getTime() - new Date(from).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}
