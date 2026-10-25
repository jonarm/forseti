/**
 * The cast. Obviously fictional, deliberately unremarkable.
 *
 * Names are generic on purpose — a prospect watching the demo should be
 * mapping these onto their own colleagues within a few seconds, which a
 * memorable name actively prevents. The three governance roles at the top are
 * the ones the sign-off chain resolves to, so they appear on every assessment.
 */
import type { Person } from "../types";

export const PEOPLE: Person[] = [
  { id: "p-anders", name: "R. Andersen", role: "AI Governance Lead", businessUnit: "Risk & Compliance" },
  { id: "p-oyelaran", name: "T. Oyelaran", role: "Chief Information Security Officer", businessUnit: "Technology" },
  { id: "p-marek", name: "J. Marek", role: "Data Protection Officer", businessUnit: "Legal" },

  { id: "p-devi", name: "S. Devi", role: "Head of Workplace Technology", businessUnit: "Technology" },
  { id: "p-hallberg", name: "M. Hallberg", role: "Director of Customer Operations", businessUnit: "Customer Operations" },
  { id: "p-nakamura", name: "K. Nakamura", role: "Head of Data Science", businessUnit: "Data & Analytics" },
  { id: "p-ferreira", name: "L. Ferreira", role: "Engineering Manager, Platform", businessUnit: "Technology" },
  { id: "p-boateng", name: "A. Boateng", role: "Head of Talent Acquisition", businessUnit: "People" },
  { id: "p-schulz", name: "D. Schulz", role: "Financial Controller", businessUnit: "Finance" },
  { id: "p-quinn", name: "E. Quinn", role: "Marketing Operations Manager", businessUnit: "Marketing" },
  { id: "p-ibrahim", name: "N. Ibrahim", role: "Procurement Lead", businessUnit: "Finance" },
  { id: "p-larsen", name: "C. Larsen", role: "Head of Legal Operations", businessUnit: "Legal" },
];

/** The three fixed governance roles the sign-off chain routes through. */
export const GOVERNANCE_LEAD = "p-anders";
export const APPROVER = "p-oyelaran";
export const DATA_PROTECTION_OFFICER = "p-marek";

export const BUSINESS_UNITS = [
  "Customer Operations",
  "Data & Analytics",
  "Finance",
  "Legal",
  "Marketing",
  "People",
  "Risk & Compliance",
  "Technology",
] as const;
