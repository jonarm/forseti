/**
 * Use cases: the object the whole model turns on.
 *
 * A system is what you procured. A use case is what somebody actually does with
 * it, and it is the level at which risk is real. M365 Copilot has four here and
 * they are not equally risky — summarising your own meetings is not the same
 * act as drafting a message a customer will read, even though it is one licence,
 * one vendor, one contract and one row in the inventory.
 *
 * That is why `riskTier` lives on this record as well as on the system, and why
 * the two questions that carry most of the regulatory weight —
 * `facesCustomers` and `informsDecisionsAboutPeople` — are answered here rather
 * than once for the tool. TalentScreen's screening use case answers yes to the
 * second, which is what pulls a whole fairness section into its assessment.
 */
import type { AIUseCase } from "../types";

export const USE_CASES: AIUseCase[] = [
  /* ---- Microsoft 365 Copilot: one system, four different risk profiles ---- */
  {
    id: "uc-copilot-meetings",
    systemIds: ["sys-m365-copilot"],
    systemOverrides: [],
    name: "Meeting summarisation",
    description:
      "Generates notes and action items from Teams recordings for the people who attended, or who were invited and could not make it.",
    businessUnit: "Technology",
    ownerId: "p-devi",
    riskTier: "limited",
    oversightLevel: "human_in_the_loop",
    oversightSummary:
      "The summary is a draft in the organiser's notes until they edit and share it. Nothing is circulated automatically.",
    facesCustomers: false,
    informsDecisionsAboutPeople: false,
    dataCategories: ["internal", "confidential", "personal"],
    approxUsers: 430,
    status: "active",
    assessmentId: "asmt-copilot-meetings",
  },
  {
    id: "uc-copilot-email",
    systemIds: ["sys-m365-copilot"],
    systemOverrides: [],
    name: "Email and message drafting",
    description:
      "Drafts replies in Outlook and Teams from a short instruction and the thread above it.",
    businessUnit: "Technology",
    ownerId: "p-devi",
    riskTier: "limited",
    oversightLevel: "human_in_the_loop",
    oversightSummary:
      "A draft sits in the compose window. The sender reads and sends it, and owns what it says.",
    facesCustomers: true,
    informsDecisionsAboutPeople: false,
    dataCategories: ["internal", "confidential", "personal", "customer_content"],
    approxUsers: 520,
    status: "active",
    assessmentId: null,
  },
  {
    id: "uc-copilot-documents",
    systemIds: ["sys-m365-copilot"],
    systemOverrides: [],
    name: "Document and deck drafting",
    description:
      "Produces first drafts of documents and slides from an outline and the files the author points it at.",
    businessUnit: "Technology",
    ownerId: "p-devi",
    riskTier: "minimal",
    oversightLevel: "human_in_the_loop",
    oversightSummary: "Output is a working document nobody but the author can see until they share it.",
    facesCustomers: false,
    informsDecisionsAboutPeople: false,
    dataCategories: ["internal", "confidential"],
    approxUsers: 380,
    status: "active",
    assessmentId: null,
  },
  {
    id: "uc-copilot-search",
    systemIds: ["sys-m365-copilot"],
    systemOverrides: [],
    name: "Search across our own content",
    description:
      "Answers questions from files, mail and chats the person asking already has permission to open.",
    businessUnit: "Technology",
    ownerId: "p-devi",
    riskTier: "high",
    oversightLevel: "human_on_the_loop",
    oversightSummary:
      "No review step — the answer appears immediately. The control is permissions, and permissions are the thing most likely to be wrong: over-shared sites surface content the reader could technically always reach but never would have found.",
    facesCustomers: false,
    informsDecisionsAboutPeople: false,
    dataCategories: ["internal", "confidential", "personal"],
    approxUsers: 610,
    status: "active",
    assessmentId: null,
  },

  /* ---- Copilot Studio: the org builds the risky thing itself ---- */
  {
    id: "uc-studio-order-status",
    systemIds: ["sys-copilot-studio"],
    systemOverrides: [],
    name: "Customer order status agent",
    description:
      "A public-facing agent on the help centre that answers where an order is, from the order system and the shipping feed.",
    businessUnit: "Customer Operations",
    ownerId: "p-hallberg",
    riskTier: "high",
    oversightLevel: "human_on_the_loop",
    oversightSummary:
      "The customer sees the answer with no person in between. Support leads sample transcripts weekly and the agent hands off to a human on any refund or complaint intent.",
    facesCustomers: true,
    informsDecisionsAboutPeople: false,
    dataCategories: ["personal", "customer_content", "confidential"],
    approxUsers: 0,
    status: "piloting",
    assessmentId: "asmt-copilot-studio",
  },
  {
    id: "uc-studio-agent-assist",
    systemIds: ["sys-copilot-studio"],
    systemOverrides: [],
    name: "Support agent assist",
    description:
      "Suggests a reply to the handler from the policy library and the customer's history.",
    businessUnit: "Customer Operations",
    ownerId: "p-hallberg",
    riskTier: "limited",
    oversightLevel: "human_in_the_loop",
    oversightSummary: "The handler edits and sends. The suggestion never reaches the customer unchanged unless they choose it.",
    facesCustomers: true,
    informsDecisionsAboutPeople: false,
    dataCategories: ["personal", "customer_content"],
    approxUsers: 84,
    status: "active",
    assessmentId: null,
  },
  {
    id: "uc-studio-hr-faq",
    systemIds: ["sys-copilot-studio"],
    systemOverrides: [],
    name: "Internal HR policy agent",
    description:
      "Answers staff questions about leave, expenses and benefits from the approved policy set.",
    businessUnit: "People",
    ownerId: "p-boateng",
    riskTier: "limited",
    oversightLevel: "human_on_the_loop",
    oversightSummary:
      "Answers go straight to the employee, always with a link to the policy they came from so the source can be checked.",
    facesCustomers: false,
    informsDecisionsAboutPeople: false,
    dataCategories: ["internal", "personal"],
    approxUsers: 640,
    status: "piloting",
    assessmentId: null,
  },

  /* ---- Claim triage: the API integration ---- */
  {
    id: "uc-claim-extraction",
    systemIds: ["sys-claim-triage-api"],
    systemOverrides: [],
    name: "Claim field extraction",
    description:
      "Reads the submitted claim and free-text attachments and fills the structured fields a handler would otherwise key in.",
    businessUnit: "Customer Operations",
    ownerId: "p-ferreira",
    riskTier: "limited",
    oversightLevel: "human_in_the_loop",
    oversightSummary:
      "Every extracted field is shown beside the source text and confirmed by a handler before the claim advances.",
    facesCustomers: false,
    informsDecisionsAboutPeople: true,
    dataCategories: ["personal", "special_category", "financial"],
    approxUsers: 47,
    status: "active",
    assessmentId: "asmt-claim-triage",
  },
  {
    id: "uc-claim-routing",
    systemIds: ["sys-claim-triage-api"],
    systemOverrides: [],
    name: "Claim routing and priority",
    description:
      "Proposes which queue a claim belongs in and whether it should be expedited.",
    businessUnit: "Customer Operations",
    ownerId: "p-ferreira",
    riskTier: "high",
    oversightLevel: "human_in_the_loop",
    oversightSummary:
      "A handler confirms the queue. Priority is the sensitive part: a claim quietly deprioritised is a decision about a person that nobody made deliberately, so every override is logged and the queue is reviewed for ageing.",
    facesCustomers: false,
    informsDecisionsAboutPeople: true,
    dataCategories: ["personal", "special_category", "financial"],
    approxUsers: 47,
    status: "active",
    assessmentId: null,
  },

  /* ---- The predictive and internal ones ---- */
  {
    id: "uc-churn-scoring",
    systemIds: ["sys-churnlens"],
    systemOverrides: [],
    name: "Retention outreach prioritisation",
    description:
      "Scores accounts on cancellation likelihood so the retention team calls the right ones first.",
    businessUnit: "Customer Operations",
    ownerId: "p-hallberg",
    riskTier: "limited",
    oversightLevel: "human_in_command",
    oversightSummary:
      "The score orders a call list. It does not change anyone's price or terms, and the team can work the list in any order.",
    facesCustomers: false,
    informsDecisionsAboutPeople: true,
    dataCategories: ["personal", "financial", "confidential"],
    approxUsers: 11,
    status: "proposed",
    assessmentId: null,
  },
  {
    id: "uc-demand-planning",
    systemIds: ["sys-demand-forecast"],
    systemOverrides: [],
    name: "Weekly volume planning",
    description:
      "Forecasts order volume by region to set staffing and stock levels for the coming fortnight.",
    businessUnit: "Data & Analytics",
    ownerId: "p-nakamura",
    riskTier: "minimal",
    oversightLevel: "human_in_command",
    oversightSummary:
      "Planners take the forecast as one input. A material deviation from last year is queried before it is used.",
    facesCustomers: false,
    informsDecisionsAboutPeople: false,
    dataCategories: ["internal", "financial"],
    approxUsers: 23,
    status: "active",
    assessmentId: "asmt-demand-forecast",
  },
  {
    id: "uc-talent-screening",
    systemIds: ["sys-talentscreen"],
    systemOverrides: [],
    name: "Application screening and ranking",
    description:
      "Summarises each application and ranks candidates against the role profile for the recruiter's shortlist.",
    businessUnit: "People",
    ownerId: "p-boateng",
    riskTier: "high",
    oversightLevel: "human_in_the_loop",
    oversightSummary:
      "A recruiter builds the shortlist and can see every candidate. But the ranking sets the reading order, and in practice the bottom of a long list is read least — which is why this one carries an adverse-impact review rather than a note.",
    facesCustomers: false,
    informsDecisionsAboutPeople: true,
    dataCategories: ["personal", "special_category", "confidential"],
    approxUsers: 19,
    status: "piloting",
    assessmentId: "asmt-talentscreen",
  },
  {
    id: "uc-github-completion",
    systemIds: ["sys-github-copilot"],
    systemOverrides: [],
    name: "Code completion and chat",
    description:
      "Suggests code inline and answers questions about the repository the engineer has open.",
    businessUnit: "Technology",
    ownerId: "p-ferreira",
    riskTier: "limited",
    oversightLevel: "human_in_the_loop",
    oversightSummary:
      "Nothing ships without review. Suggestions pass the same pull request checks as anything written by hand.",
    facesCustomers: false,
    informsDecisionsAboutPeople: false,
    dataCategories: ["source_code", "internal"],
    approxUsers: 142,
    status: "active",
    assessmentId: null,
  },
  {
    id: "uc-notetaker-calls",
    systemIds: ["sys-notetaker"],
    systemOverrides: [],
    name: "External call recording and notes",
    description:
      "Joins customer and prospect calls to record, transcribe and summarise them.",
    businessUnit: "Marketing",
    ownerId: "p-quinn",
    riskTier: "high",
    oversightLevel: "none",
    oversightSummary:
      "Nobody reviews the transcript, and the recording notice depends on the meeting organiser remembering to give it. This is an open finding, not a description of a working control.",
    facesCustomers: true,
    informsDecisionsAboutPeople: false,
    dataCategories: ["personal", "confidential", "customer_content"],
    approxUsers: 7,
    status: "active",
    assessmentId: null,
  },
  {
    id: "uc-knowledge-answers",
    systemIds: ["sys-docsearch"],
    systemOverrides: [],
    name: "Cited answers from the intranet",
    description:
      "Answers a question in prose with links to the policies and pages the answer came from.",
    businessUnit: "Technology",
    ownerId: "p-devi",
    riskTier: "limited",
    oversightLevel: "human_on_the_loop",
    oversightSummary:
      "Every answer carries its citations, so the reader can check the source. Unanswered and low-confidence questions are reviewed monthly.",
    facesCustomers: false,
    informsDecisionsAboutPeople: false,
    dataCategories: ["internal", "confidential"],
    approxUsers: 580,
    status: "active",
    assessmentId: null,
  },
  {
    id: "uc-invoice-extraction",
    systemIds: ["sys-invoice-ocr"],
    systemOverrides: [],
    name: "Supplier invoice extraction",
    description: "Reads scanned invoices and proposes the ledger lines.",
    businessUnit: "Finance",
    ownerId: "p-schulz",
    riskTier: "minimal",
    oversightLevel: "human_in_the_loop",
    oversightSummary: "A clerk confirms every line before posting. Nothing reaches the ledger unreviewed.",
    facesCustomers: false,
    informsDecisionsAboutPeople: false,
    dataCategories: ["financial", "confidential"],
    approxUsers: 9,
    status: "active",
    assessmentId: null,
  },
  {
    id: "uc-adcopy-drafting",
    systemIds: ["sys-adcopy"],
    systemOverrides: [],
    name: "Campaign copy drafting",
    description: "Drafts advertising and email copy from a campaign brief.",
    businessUnit: "Marketing",
    ownerId: "p-quinn",
    riskTier: "minimal",
    oversightLevel: "human_in_the_loop",
    oversightSummary: "Everything published is edited and approved by a marketer first.",
    facesCustomers: true,
    informsDecisionsAboutPeople: false,
    dataCategories: ["internal", "public"],
    approxUsers: 14,
    status: "active",
    assessmentId: null,
  },
];

/*
 * Named `getUseCase` rather than `useCase` on purpose: a function whose name
 * begins with "use" is a React hook as far as the lint rules are concerned, and
 * these are plain lookups called from server components.
 */
