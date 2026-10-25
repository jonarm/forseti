/**
 * Inbound questionnaires — the ones customers and insurers send you.
 *
 * This is the pain the Northwind finding already describes: a customer asked
 * which AI systems touch their data, what models sit behind them and who reviews
 * the output, and assembling the answer took eleven working days against a
 * five-day contractual commitment. Not because the information was missing, but
 * because it lived in an inventory, some contracts and a set of assessment
 * documents, and every answer was reassembled by hand.
 *
 * A note on persistence. Treating a drafted answer as ephemeral is right when it
 * is a draft you paste into somebody else's portal — which is what the GDPR
 * toolkit's copilot produced, and why it never stored one. Here they are kept,
 * deliberately: an answer *sent* to a customer is a **commitment**, and when the
 * same customer asks again next year the first question is what we told them
 * last time. Same word, different object.
 */
import type { Questionnaire } from "../types";

export const QUESTIONNAIRES: Questionnaire[] = [
  {
    id: "qn-northwind-2026",
    title: "AI due diligence — annual supplier assurance",
    requester: "Northwind Retail",
    requesterType: "customer",
    receivedAt: "2026-08-04",
    dueAt: "2026-08-11",
    ownerId: "p-larsen",
    status: "in_progress",
    note: "The review that produced finding REQ — eleven days last year against a five-day commitment.",
    questions: [
      {
        id: "q-nw-1",
        number: "1.1",
        text: "Which AI systems process our data, and what does each one do with it?",
        /* Answerable straight from the inventory, which is the point. */
        controlIds: ["ctl-4-1", "ctl-a3-2", "ctl-a4-3"],
        policyIds: ["pol-ai-governance"],
        evidenceIds: ["ev-inventory-export"],
      },
      {
        id: "q-nw-2",
        number: "1.2",
        text: "Which underlying models or model providers are involved, and where is our data processed?",
        controlIds: ["ctl-a4-5", "ctl-a10-3"],
        policyIds: ["pol-vendor-ai"],
        evidenceIds: ["ev-copilot-tenant-config", "ev-ms-dpa"],
      },
      {
        id: "q-nw-3",
        number: "2.1",
        text: "Is our data used to train any AI model, by you or by your suppliers?",
        controlIds: ["ctl-a10-2", "ctl-a10-3"],
        policyIds: ["pol-vendor-ai"],
        evidenceIds: ["ev-ms-dpa"],
      },
      {
        id: "q-nw-4",
        number: "2.2",
        text: "Describe the human oversight applied to AI outputs that affect our customers.",
        controlIds: ["ctl-a4-6", "ctl-a9-2"],
        policyIds: ["pol-human-oversight"],
        evidenceIds: ["ev-studio-handoff-test"],
      },
      {
        id: "q-nw-5",
        number: "3.1",
        text: "Do you hold ISO/IEC 42001 certification, or an equivalent AI management system certification?",
        controlIds: [],
        policyIds: [],
        evidenceIds: [],
      },
      {
        id: "q-nw-6",
        number: "3.2",
        text: "How do you assess AI systems before deployment, and who approves them?",
        controlIds: ["ctl-6-3", "ctl-a5-2", "ctl-a5-3"],
        policyIds: ["pol-impact-assessment"],
        evidenceIds: ["ev-copilot-dpia"],
      },
      {
        id: "q-nw-7",
        number: "4.1",
        text: "Do any of your AI systems make or materially influence decisions about individuals?",
        controlIds: ["ctl-a5-4"],
        policyIds: ["pol-impact-assessment"],
        evidenceIds: ["ev-claim-override-log", "ev-talentscreen-dpia"],
      },
      {
        id: "q-nw-8",
        number: "4.2",
        text: "How would you notify us of an AI-related incident affecting our data?",
        controlIds: ["ctl-a8-4"],
        policyIds: ["pol-incident"],
        evidenceIds: [],
      },
    ],
  },
  {
    id: "qn-helios-prospect",
    title: "Vendor security review — AI addendum",
    requester: "Helios Group",
    requesterType: "prospect",
    receivedAt: "2026-08-08",
    dueAt: "2026-08-22",
    ownerId: "p-oyelaran",
    status: "not_started",
    note: "Blocking a contract signature. Their legal team asked for it before redlines.",
    questions: [
      {
        id: "q-he-1",
        number: "A.1",
        text: "Do you maintain an inventory of AI systems, and is it reviewed?",
        controlIds: ["ctl-4-1", "ctl-a3-2"],
        policyIds: ["pol-ai-governance"],
        evidenceIds: ["ev-inventory-export"],
      },
      {
        id: "q-he-2",
        number: "A.2",
        text: "Describe your governance forum and its decision-making authority.",
        controlIds: ["ctl-5-1", "ctl-9-3"],
        policyIds: ["pol-ai-governance"],
        evidenceIds: ["ev-governance-minutes"],
      },
      {
        id: "q-he-3",
        number: "A.3",
        text: "Do you conduct internal audits of your AI management system?",
        controlIds: ["ctl-9-2", "ctl-10-1"],
        policyIds: [],
        evidenceIds: ["ev-internal-audit"],
      },
    ],
  },
  {
    id: "qn-insurer-renewal",
    title: "Cyber and technology liability renewal — AI schedule",
    requester: "Bridgewater Mutual",
    requesterType: "insurer",
    receivedAt: "2026-07-02",
    dueAt: "2026-07-31",
    ownerId: "p-larsen",
    status: "submitted",
    note: "Submitted 28 July. Premium held flat on the strength of the oversight answers.",
    questions: [],
  },
];

export const REQUESTER_TYPE: Record<string, string> = {
  customer: "Customer",
  prospect: "Prospect",
  insurer: "Insurer",
  regulator: "Regulator",
  partner: "Partner",
};

export const QUESTIONNAIRE_STATUS: Record<
  Questionnaire["status"],
  { label: string; tone: "ok" | "warn" | "critical" | "info" | "neutral" }
> = {
  not_started: { label: "Not started", tone: "critical" },
  in_progress: { label: "In progress", tone: "warn" },
  in_review: { label: "In review", tone: "info" },
  submitted: { label: "Submitted", tone: "ok" },
};
