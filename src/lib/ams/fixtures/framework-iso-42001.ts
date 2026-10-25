/**
 * ISO/IEC 42001, as our product describes it — not as the standard words it.
 *
 * **Every string in this file is ours.** ISO copyrights its standards and we
 * cannot redistribute clause text, so there is no `officialText` field on the
 * type and nothing here is a transcription. What we store is:
 *
 *   - `officialRef` — the citation ("A.6.2.4"). A reference is a fact about
 *     where a requirement lives, and a customer needs it to talk to an auditor.
 *   - `shortTitle` — our name for the control, written to be scannable in a
 *     table of eighty rows.
 *   - `requirementSummary` — our paraphrase of what has to be demonstrated,
 *     written as an instruction to the reader rather than a restatement of the
 *     clause. A close paraphrase of the clause is still the clause; these are
 *     deliberately written from the product's point of view.
 *   - `evidenceGuidance` — what we would accept as proof. This is the part that
 *     makes a control actionable, and it exists in no standard.
 *
 * `developmentOnly` is the other load-bearing field. Most mid-market
 * organisations buy AI rather than build it, so the controls about training
 * data, model design and validation do not apply to them — and a Statement of
 * Applicability that makes them justify eighty controls one by one is why SoAs
 * get filled in with copy-paste. Marking them here is what lets the SoA arrive
 * with a defensible consumption-only posture already argued.
 */
import type { FrameworkControl, FrameworkNode, Framework } from "../types";

export const ISO_42001: Framework = {
  id: "iso-42001",
  name: "ISO/IEC 42001 — AI management system",
  shortName: "ISO 42001",
  description:
    "The management system standard for artificial intelligence: what an organisation has to put in place to govern the AI it builds or uses, and to show an auditor that the governance is real. Certifiable, and the one buyers are starting to ask for.",
  version: "2023",
};

/**
 * The tree: management clauses 4–10, then Annex A areas.
 *
 * Both live in one array because they are one navigation. The `kind` field is
 * what lets the tree render them as two groups without needing two tables, and
 * `parentId` is null for every top-level entry — the depth here is one level,
 * which is all the standard's own structure needs.
 */
export const ISO_42001_NODES: FrameworkNode[] = [
  { id: "n-4", frameworkId: "iso-42001", officialRef: "4", parentId: null, kind: "management_clause", shortTitle: "Context of the organisation" },
  { id: "n-5", frameworkId: "iso-42001", officialRef: "5", parentId: null, kind: "management_clause", shortTitle: "Leadership" },
  { id: "n-6", frameworkId: "iso-42001", officialRef: "6", parentId: null, kind: "management_clause", shortTitle: "Planning" },
  { id: "n-7", frameworkId: "iso-42001", officialRef: "7", parentId: null, kind: "management_clause", shortTitle: "Support" },
  { id: "n-8", frameworkId: "iso-42001", officialRef: "8", parentId: null, kind: "management_clause", shortTitle: "Operation" },
  { id: "n-9", frameworkId: "iso-42001", officialRef: "9", parentId: null, kind: "management_clause", shortTitle: "Performance evaluation" },
  { id: "n-10", frameworkId: "iso-42001", officialRef: "10", parentId: null, kind: "management_clause", shortTitle: "Improvement" },

  { id: "n-a2", frameworkId: "iso-42001", officialRef: "A.2", parentId: null, kind: "annex_a", shortTitle: "Policies for AI" },
  { id: "n-a3", frameworkId: "iso-42001", officialRef: "A.3", parentId: null, kind: "annex_a", shortTitle: "Internal organisation" },
  { id: "n-a4", frameworkId: "iso-42001", officialRef: "A.4", parentId: null, kind: "annex_a", shortTitle: "Resources for AI systems" },
  { id: "n-a5", frameworkId: "iso-42001", officialRef: "A.5", parentId: null, kind: "annex_a", shortTitle: "Assessing impacts" },
  { id: "n-a6", frameworkId: "iso-42001", officialRef: "A.6", parentId: null, kind: "annex_a", shortTitle: "AI system life cycle" },
  { id: "n-a7", frameworkId: "iso-42001", officialRef: "A.7", parentId: null, kind: "annex_a", shortTitle: "Data for AI systems" },
  { id: "n-a8", frameworkId: "iso-42001", officialRef: "A.8", parentId: null, kind: "annex_a", shortTitle: "Information for interested parties" },
  { id: "n-a9", frameworkId: "iso-42001", officialRef: "A.9", parentId: null, kind: "annex_a", shortTitle: "Responsible use of AI" },
  { id: "n-a10", frameworkId: "iso-42001", officialRef: "A.10", parentId: null, kind: "annex_a", shortTitle: "Third parties and customers" },
];

const c = (
  id: string,
  nodeId: string,
  officialRef: string,
  shortTitle: string,
  requirementSummary: string,
  evidenceGuidance: string,
  developmentOnly = false,
): FrameworkControl => ({
  id,
  frameworkId: "iso-42001",
  nodeId,
  officialRef,
  shortTitle,
  requirementSummary,
  evidenceGuidance,
  developmentOnly,
});

export const ISO_42001_CONTROLS: FrameworkControl[] = [
  /* ---------------------------------------------------- management clauses */
  c("ctl-4-1", "n-4", "4.1", "Scope of the AI management system",
    "Write down which parts of the organisation, and which AI systems, the management system covers — and what it deliberately leaves out.",
    "The scope statement, plus the inventory it points at. An auditor will check that a system you run is either in scope or explicitly excluded for a stated reason."),
  c("ctl-4-2", "n-4", "4.2", "Interested parties and their expectations",
    "Identify who is affected by your use of AI — staff, customers, applicants, regulators — and record what each of them needs from you.",
    "A stakeholder register naming the groups and the obligation attached to each, reviewed within the last twelve months."),
  c("ctl-4-3", "n-4", "4.4", "The management system itself",
    "Show that the processes described in these controls actually connect: intake feeds assessment, assessment feeds the risk register, findings feed back into review.",
    "A process description or diagram, plus records showing one system travelling the whole path end to end."),
  c("ctl-5-1", "n-5", "5.1", "Leadership and commitment",
    "Demonstrate that senior management owns AI governance rather than delegating it to whoever raised it first.",
    "Minutes of a governance forum with named attendance, showing decisions taken and not merely papers noted."),
  c("ctl-5-2", "n-5", "5.2", "AI policy",
    "Maintain a policy stating what the organisation will and will not do with AI, approved at the right level.",
    "The approved policy with a version, an approval date and an owner. A draft satisfies nothing."),
  c("ctl-5-3", "n-5", "5.3", "Roles and authority",
    "Name who decides what: who may approve a new system, who owns a risk, who can stop a deployment.",
    "A responsibilities matrix naming individuals or roles, matching the owners recorded against systems in the inventory."),
  c("ctl-6-1", "n-6", "6.1.2", "AI risk assessment",
    "Have a repeatable method for identifying and rating AI risks, so two people assessing the same system reach comparable answers.",
    "The documented method, plus at least one completed assessment that visibly follows it."),
  c("ctl-6-2", "n-6", "6.1.3", "AI risk treatment",
    "For each identified risk, record the treatment decision and who accepted whatever remains.",
    "Risk register entries showing inherent rating, treatment, residual rating and a named acceptor."),
  c("ctl-6-3", "n-6", "6.1.4", "AI system impact assessment",
    "Assess the consequences for individuals and groups before a system goes live, not after.",
    "A completed impact assessment dated before the deployment record for the same system."),
  c("ctl-6-4", "n-6", "6.2", "Objectives and planning",
    "Set measurable AI objectives and say how you will know whether you met them.",
    "Objectives with a target, an owner and a review date; evidence of at least one review against them."),
  c("ctl-7-1", "n-7", "7.2", "Competence",
    "Make sure the people governing, building and operating AI know enough to do it, and can show it.",
    "Training records or role-based competence criteria covering the named owners in the inventory."),
  c("ctl-7-2", "n-7", "7.3", "Awareness",
    "Make sure everyone who uses AI at work knows the rules that apply to them.",
    "Acceptable-use communications with completion figures, not just a policy published on the intranet."),
  c("ctl-7-3", "n-7", "7.5", "Documented information",
    "Control the documents the management system depends on — versioned, owned, reviewed.",
    "A document register showing version, owner and next review for each policy and procedure."),
  c("ctl-8-1", "n-8", "8.1", "Operational planning and control",
    "Run the processes you documented, and keep the records that prove you ran them.",
    "Records from the live process: intake decisions, assessments, approvals — dated and attributable."),
  c("ctl-9-1", "n-9", "9.1", "Monitoring and measurement",
    "Track whether the AI management system is working, with figures rather than impressions.",
    "A metrics pack: systems assessed against systems registered, overdue reviews, open findings by age."),
  c("ctl-9-2", "n-9", "9.2", "Internal audit",
    "Audit the management system on a planned cycle, by someone independent of what they are auditing.",
    "An audit plan, the report, and the findings raised — including at least one finding, since an audit that finds nothing invites the question."),
  c("ctl-9-3", "n-9", "9.3", "Management review",
    "Have leadership review the management system on a schedule and record what they decided to change.",
    "Review minutes covering performance, findings and resourcing, with actions and owners."),
  c("ctl-10-1", "n-10", "10.2", "Nonconformity and corrective action",
    "When something goes wrong, record it, fix the cause rather than the symptom, and verify the fix held.",
    "Findings with root cause, corrective action, and a dated verification before closure."),

  /* ------------------------------------------------------------- Annex A */
  c("ctl-a2-2", "n-a2", "A.2.2", "AI policy in force",
    "Publish an AI policy that the organisation actually operates to, not one written for the audit.",
    "The approved policy, plus a case where it changed a decision — a rejected request, a use put out of bounds."),
  c("ctl-a2-3", "n-a2", "A.2.3", "Alignment with other policies",
    "Make sure the AI policy agrees with the security, privacy and procurement policies rather than contradicting them.",
    "A mapping or review note showing the four were read together, with any conflicts resolved."),
  c("ctl-a2-4", "n-a2", "A.2.4", "Review of the AI policy",
    "Review the policy on a defined cycle and whenever the way you use AI changes materially.",
    "Version history showing a review inside the stated cycle, with the reviewer named."),
  c("ctl-a3-2", "n-a3", "A.3.2", "AI roles and responsibilities",
    "Assign and communicate who is accountable for each AI system and each stage of its life.",
    "Named owners on every system in the inventory, with no row left unassigned."),
  c("ctl-a3-3", "n-a3", "A.3.3", "Reporting concerns",
    "Give people a route to raise a concern about an AI system, and show that raised concerns go somewhere.",
    "The reporting channel, plus a log of concerns raised and how each was handled."),
  c("ctl-a4-2", "n-a4", "A.4.2", "Resources are documented",
    "Record what each AI system depends on — data, tooling, compute, people — so the dependency is visible when something changes.",
    "A resource record per system in scope, kept with the system rather than in someone's head."),
  c("ctl-a4-3", "n-a4", "A.4.3", "Data resources",
    "Document the data each system uses and where it came from.",
    "Data categories recorded against every system, matching what the vendor's documentation actually says it processes."),
  c("ctl-a4-5", "n-a4", "A.4.5", "System and computing resources",
    "Know where each system runs and on whose infrastructure.",
    "Hosting region and deployment model recorded per system, with the contractual basis for any residency claim."),
  c("ctl-a4-6", "n-a4", "A.4.6", "Human resources",
    "Make sure the people operating and overseeing each system are competent to do so, and enough of them exist.",
    "Named oversight roles per system, with training records — and an honest count of how many people actually do the reviewing."),
  c("ctl-a5-2", "n-a5", "A.5.2", "Impact assessment process",
    "Have a defined process for assessing an AI system's impact, with criteria for when it must be run.",
    "The documented process, including the trigger rules that decide which systems need one."),
  c("ctl-a5-3", "n-a5", "A.5.3", "Impact assessments are documented",
    "Keep the completed assessments, with who filled them in and who approved them.",
    "Completed assessments with a full sign-off chain and dates. An unapproved assessment is a draft."),
  c("ctl-a5-4", "n-a5", "A.5.4", "Impact on individuals and groups",
    "Assess how a system could disadvantage the people it touches, especially where it informs a decision about them.",
    "The fairness and adverse-impact sections completed for every system that informs decisions about people, plus the appeal route offered."),
  c("ctl-a5-5", "n-a5", "A.5.5", "Societal impact",
    "Consider effects beyond your own users where the system's reach warrants it.",
    "A recorded consideration — including a reasoned 'not material here', which is a legitimate answer if it is argued."),
  c("ctl-a6-1-2", "n-a6", "A.6.1.2", "Objectives for responsible development",
    "Set out what responsible development means for the systems you build, before building them.",
    "Development principles or standards adopted by the team that builds models.", true),
  c("ctl-a6-2-2", "n-a6", "A.6.2.2", "Requirements and specification",
    "Specify what a system you are building must do, and the constraints it must respect.",
    "A written specification predating the build, including the non-functional and ethical constraints.", true),
  c("ctl-a6-2-3", "n-a6", "A.6.2.3", "Design and development documentation",
    "Document design decisions for systems you build, so a later reviewer can reconstruct why.",
    "Design records, model cards or equivalent for each internally built model.", true),
  c("ctl-a6-2-4", "n-a6", "A.6.2.4", "Verification and validation",
    "Test a system against its specification before release, and record the results.",
    "Test plans and results, including performance across the groups the system will be used on.", true),
  c("ctl-a6-2-5", "n-a6", "A.6.2.5", "Deployment",
    "Control how a system reaches production — who approves it, what has to be true first.",
    "Deployment approvals tied to a completed assessment, for every system now live."),
  c("ctl-a6-2-6", "n-a6", "A.6.2.6", "Operation and monitoring",
    "Monitor systems in use for the things that go wrong quietly: drift, degradation, misuse.",
    "Monitoring records with thresholds, and evidence of what happened when one was crossed."),
  c("ctl-a6-2-8", "n-a6", "A.6.2.8", "Event logging",
    "Keep logs sufficient to reconstruct what a system did and when.",
    "Log samples plus the retention period, and confirmation that the retention matches the policy."),
  c("ctl-a7-2", "n-a7", "A.7.2", "Data for development",
    "Manage the data used to build and improve models you develop yourself.",
    "Data management records for the training sets behind each internally built model.", true),
  c("ctl-a7-3", "n-a7", "A.7.3", "Acquisition of data",
    "Establish that you have the right to use the data you train on.",
    "Provenance and licensing records for each training data source.", true),
  c("ctl-a7-4", "n-a7", "A.7.4", "Quality of data",
    "Define and check the quality the data must meet before it is used for training.",
    "Data quality criteria and the results of applying them.", true),
  c("ctl-a7-5", "n-a7", "A.7.5", "Provenance of data",
    "Record where training data came from and how it has been handled since.",
    "A provenance trail per data source, sufficient to answer where a record originated.", true),
  c("ctl-a8-2", "n-a8", "A.8.2", "Documentation and information for users",
    "Tell the people using a system what it does, what it cannot do, and how to challenge it.",
    "User-facing guidance per system, including the stated limitations and the escalation route."),
  c("ctl-a8-3", "n-a8", "A.8.3", "External reporting",
    "Be able to report externally on your AI use where you are obliged to.",
    "The reporting obligations you are subject to, and evidence of meeting each."),
  c("ctl-a8-4", "n-a8", "A.8.4", "Communication of incidents",
    "Have a route for AI incidents that reaches the right people quickly.",
    "The incident procedure naming AI-specific triggers, plus any incident record and its timeline."),
  c("ctl-a9-2", "n-a9", "A.9.2", "Processes for responsible use",
    "Define how people may use each system, and make the boundary enforceable rather than advisory.",
    "Acceptable-use rules per system, plus a technical control or a monitoring record showing the boundary holds."),
  c("ctl-a9-3", "n-a9", "A.9.3", "Objectives for responsible use",
    "State what responsible use means in your context, in terms specific enough to test.",
    "Documented objectives referenced by the assessments, not a statement of values."),
  c("ctl-a9-4", "n-a9", "A.9.4", "Intended use",
    "Record what each system is for, and hold it to that. A tool bought for one job and used for another is unassessed.",
    "Intended use recorded per system and per use case, with periodic confirmation that actual use still matches."),
  c("ctl-a10-2", "n-a10", "A.10.2", "Allocating responsibilities with third parties",
    "Be clear about which AI obligations are yours and which are the vendor's, in writing.",
    "Contract terms or a responsibility split per vendor. A click-through licence rarely establishes one."),
  c("ctl-a10-3", "n-a10", "A.10.3", "Suppliers",
    "Assess AI suppliers before you rely on them, and re-assess them on a cycle.",
    "Vendor assessments covering model provenance, sub-processors and whether your data trains their models."),
  c("ctl-a10-4", "n-a10", "A.10.4", "Customers",
    "Give customers the information they need about AI in the products you supply to them.",
    "Customer-facing AI disclosures, and the answers you give to their questionnaires."),
];
