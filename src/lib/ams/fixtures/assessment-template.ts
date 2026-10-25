/**
 * The impact assessment, as configuration.
 *
 * This object is the whole argument for screen 5. Nothing in the renderer knows
 * that a section called "fairness" exists or that a field is named
 * `informs_decisions_about_people` — it walks `sections`, evaluates `showIf`
 * against the answers, and switches on `field.type`. Grep the renderer for any
 * id below and you will find none.
 *
 * That matters for a reason beyond tidiness. An impact assessment is the
 * document that changes most often: a regulator publishes guidance, a customer
 * demands an extra question, the org decides sensitive uses need three more
 * fields. A template that is data can be versioned, diffed and eventually edited
 * by the customer; a template that is JSX means a release for every question.
 *
 * Three mechanisms are exercised deliberately:
 *
 *   - **Section-level `showIf`** — answering "informs decisions about
 *     individuals" reveals an entire fairness and adverse-impact section, not
 *     one extra field. That is the conditional that has to work visibly.
 *   - **Field-level `showIf`** — inside that section, naming a protected or
 *     vulnerable group reveals the disparity-testing question. Conditions nest.
 *   - **`origins`** — the technology readiness section only appears for systems
 *     we build. One template serves all three workflows rather than three
 *     templates drifting apart.
 *
 * Sections follow the shape of a real AI impact assessment: profile, intended
 * use, stakeholders, benefits, harms, oversight, fairness, readiness, restricted
 * uses, limitations, failure impact, sensitive uses, data, mitigations.
 */
import type { AssessmentTemplate } from "../types";

export const IMPACT_TEMPLATE: AssessmentTemplate = {
  id: "tpl-ai-impact-v2",
  name: "AI impact assessment",
  version: "2.1",
  sections: [
    {
      id: "profile",
      title: "System profile",
      intent:
        "Establish what is being assessed. Everything below is read against these answers, so a vague description here makes the rest of the document unusable.",
      fields: [
        {
          id: "intended_use",
          label: "What is this system for?",
          type: "long_text",
          required: true,
          help: "The job it does, in plain language. Avoid the vendor's marketing description.",
          aiAssist: true,
        },
        {
          id: "deployment_context",
          label: "Where does it sit in the work?",
          type: "long_text",
          help: "What happens immediately before its output, and immediately after.",
        },
        {
          id: "user_groups",
          label: "Who uses it?",
          type: "multi_select",
          options: [
            { value: "all_staff", label: "All staff" },
            { value: "specific_team", label: "One team" },
            { value: "customers", label: "Customers" },
            { value: "contractors", label: "Contractors" },
            { value: "public", label: "Members of the public" },
          ],
        },
        {
          id: "reach",
          label: "Roughly how many people use it?",
          type: "number",
        },
        {
          /*
           * Seeded from the use case, and editable here on purpose.
           *
           * The requester answered this at intake; the assessor is closer to the
           * work and may disagree. Letting them change it is what makes the
           * conditional section below reachable — and the change is exactly the
           * kind of thing the audit trail should record, because it moves the
           * whole shape of the document.
           */
          id: "informs_decisions_about_people",
          label: "Does this system inform decisions about individual people?",
          type: "boolean",
          required: true,
          material: true,
          help: "Hiring, pricing, credit, prioritisation, performance — anywhere the outcome lands on a person. Answering yes opens a fairness and adverse-impact section.",
        },
        {
          id: "faces_customers",
          label: "Do customers see it, or its output?",
          type: "boolean",
          required: true,
        },
      ],
    },

    {
      id: "intended_uses",
      title: "Intended and unintended uses",
      intent:
        "A tool bought for one job and used for another is an unassessed tool. Recording the boundary is what makes drift detectable later.",
      fields: [
        {
          id: "in_scope_uses",
          label: "Uses this assessment covers",
          type: "repeatable_rows",
          columns: [
            { id: "use", label: "Use", type: "short_text" },
            { id: "owner", label: "Owner", type: "short_text" },
          ],
        },
        {
          id: "restricted_uses",
          label: "Uses that are explicitly not permitted",
          type: "long_text",
          required: true,
          help: "The things someone might reasonably try that we have decided against. 'None' is rarely a true answer.",
          aiAssist: true,
        },
        {
          id: "unsupported_uses",
          label: "Uses the system is not capable of, whatever anyone assumes",
          type: "long_text",
          help: "Distinct from restricted: this is what it cannot do, not what it may not do.",
        },
      ],
    },

    {
      id: "stakeholders",
      title: "Stakeholders",
      intent:
        "Name everyone affected, including the people who never touch the system but live with its output.",
      fields: [
        {
          id: "affected_parties",
          label: "Who is affected?",
          type: "multi_select",
          required: true,
          options: [
            { value: "staff", label: "Our staff" },
            { value: "customers", label: "Customers" },
            { value: "applicants", label: "Job applicants" },
            { value: "suppliers", label: "Suppliers" },
            { value: "public", label: "The general public" },
          ],
        },
        {
          id: "consulted",
          label: "Who was consulted while preparing this?",
          type: "long_text",
          help: "An assessment written entirely by the system owner is a self-assessment.",
        },
      ],
    },

    {
      id: "benefits",
      title: "Benefits",
      intent:
        "State the benefit plainly enough that someone could later check whether it arrived. A benefit nobody measures is a benefit nobody can defend the risk against.",
      fields: [
        {
          id: "benefits",
          label: "What do we gain?",
          type: "long_text",
          required: true,
          aiAssist: true,
        },
        {
          id: "benefit_measure",
          label: "How would we know it worked?",
          type: "short_text",
          help: "A number and a date, ideally.",
        },
        {
          id: "alternative_considered",
          label: "What was the alternative to using AI here?",
          type: "long_text",
          help: "Including doing nothing.",
        },
      ],
    },

    {
      id: "harms",
      title: "Potential harms",
      intent:
        "The section auditors read first. Be specific about who is harmed and how, rather than listing categories of risk.",
      fields: [
        {
          id: "harm_types",
          label: "What kinds of harm are plausible?",
          type: "multi_select",
          required: true,
          options: [
            { value: "wrong_output", label: "Confidently wrong output" },
            { value: "unfair_outcome", label: "Unfair outcome for a person or group" },
            { value: "privacy", label: "Exposure of personal or confidential data" },
            { value: "over_reliance", label: "Over-reliance — people stop checking" },
            { value: "deskilling", label: "Deskilling" },
            { value: "reputational", label: "Reputational harm to the organisation" },
            { value: "safety", label: "Physical or financial safety" },
          ],
        },
        {
          id: "worst_case",
          label: "Describe the worst realistic outcome",
          type: "long_text",
          required: true,
          help: "Not the worst imaginable — the worst that could plausibly happen next quarter.",
          aiAssist: true,
        },
        {
          id: "failure_impact",
          label: "What happens if it simply stops working?",
          type: "single_select",
          options: [
            { value: "none", label: "Nothing — people carry on as before" },
            { value: "degraded", label: "Slower, but the work continues" },
            { value: "blocked", label: "The process stops until it is fixed" },
            { value: "unnoticed", label: "Nobody would notice, which is its own problem" },
          ],
        },
      ],
    },

    {
      id: "oversight",
      title: "Human oversight",
      intent:
        "Oversight is only real if someone has the time, the information and the authority to intervene. Describe all three.",
      fields: [
        {
          id: "oversight_level",
          label: "What level of oversight applies?",
          type: "single_select",
          required: true,
          material: true,
          options: [
            {
              value: "human_in_the_loop",
              label: "Human in the loop",
              help: "A person reviews and confirms every output before it has an effect.",
            },
            {
              value: "human_on_the_loop",
              label: "Human on the loop",
              help: "Output takes effect immediately; a person monitors and can intervene.",
            },
            {
              value: "human_in_command",
              label: "Human in command",
              help: "A person sets the boundaries and can switch it off, but does not see each output.",
            },
            {
              value: "none",
              label: "No oversight",
              help: "Nobody reviews, monitors or can readily intervene.",
            },
          ],
        },
        {
          id: "reviewer_capacity",
          label: "Who does the reviewing, and how much time do they have for it?",
          type: "long_text",
          required: true,
          help: "The most common failure is oversight assigned to people who already have a full job.",
        },
        {
          id: "override_route",
          label: "How does someone overrule the system?",
          type: "long_text",
          showIf: {
            any: [
              { fieldId: "oversight_level", equals: "human_in_the_loop" },
              { fieldId: "oversight_level", equals: "human_on_the_loop" },
            ],
          },
        },
        {
          id: "no_oversight_rationale",
          label: "Why is no oversight acceptable here?",
          type: "long_text",
          required: true,
          help: "This answer will be read closely.",
          showIf: { fieldId: "oversight_level", equals: "none" },
        },
      ],
    },

    /* ------------------------------------------------------------------
     * The conditional section. This is the one that has to work visibly.
     * ------------------------------------------------------------------ */
    {
      id: "fairness",
      title: "Fairness and adverse impact",
      intent:
        "Shown because this system contributes to decisions that affect individual people. When an output lands on a person rather than a process, the questions change.",
      showIf: { fieldId: "informs_decisions_about_people", equals: true },
      fields: [
        {
          id: "decision_influence",
          label: "How much does the output influence the decision?",
          type: "single_select",
          required: true,
          options: [
            { value: "advisory", label: "Advisory — one input among several" },
            { value: "primary", label: "Primary — usually followed" },
            { value: "determinative", label: "Determinative — effectively decides" },
          ],
        },
        {
          id: "affected_groups",
          label: "Whose outcomes could differ?",
          type: "multi_select",
          required: true,
          options: [
            { value: "applicants", label: "Job applicants" },
            { value: "claimants", label: "Claimants" },
            { value: "customers", label: "Customers" },
            { value: "protected", label: "People in protected groups" },
            { value: "vulnerable", label: "People in vulnerable circumstances" },
          ],
        },
        {
          // Nested condition: naming a protected or vulnerable group makes the
          // testing question unavoidable.
          id: "disparity_testing",
          label: "How is disparity tested, on whose data, and how often?",
          type: "long_text",
          required: true,
          help: "Vendor figures across their whole customer base are not a test of your applicant pool.",
          aiAssist: true,
          showIf: { fieldId: "affected_groups", includesAny: ["protected", "vulnerable"] },
        },
        {
          id: "appeal_route",
          label: "How does a person contest an outcome?",
          type: "long_text",
          required: true,
          help: "Who they contact, what that person can see, and what they are empowered to change.",
        },
        {
          id: "told_about_ai",
          label: "Are affected people told AI was involved?",
          type: "single_select",
          options: [
            { value: "yes", label: "Yes, proactively" },
            { value: "on_request", label: "Only if they ask" },
            { value: "no", label: "No" },
          ],
        },
      ],
    },

    {
      id: "readiness",
      title: "Technology readiness",
      intent:
        "Asked because we build this system ourselves, so the evaluation obligations are ours rather than a vendor's.",
      origins: ["internal_model"],
      fields: [
        {
          id: "evaluation_summary",
          label: "How was it evaluated before release?",
          type: "long_text",
          required: true,
        },
        {
          id: "performance_by_group",
          label: "How does performance vary across the groups it is used on?",
          type: "long_text",
          required: true,
        },
        {
          id: "drift_monitoring",
          label: "How would you know it had drifted?",
          type: "long_text",
        },
      ],
    },

    {
      id: "sensitive_uses",
      title: "Sensitive uses",
      intent:
        "A short checklist of the categories that trigger extra scrutiny almost everywhere. Any yes here means this assessment goes to the forum regardless of anything else.",
      fields: [
        {
          id: "sensitive_categories",
          label: "Does this system do any of the following?",
          type: "multi_select",
          options: [
            { value: "biometric", label: "Identify people biometrically" },
            { value: "emotion", label: "Infer emotion or state of mind" },
            { value: "employment", label: "Affect employment, promotion or pay" },
            { value: "credit", label: "Affect credit, pricing or eligibility" },
            { value: "vulnerable", label: "Target people in vulnerable circumstances" },
            { value: "safety", label: "Bear on physical safety" },
            { value: "none", label: "None of these" },
          ],
        },
        {
          id: "sensitive_rationale",
          label: "Explain the sensitive use and why it is justified",
          type: "long_text",
          required: true,
          showIf: {
            fieldId: "sensitive_categories",
            includesAny: ["biometric", "emotion", "employment", "credit", "vulnerable", "safety"],
          },
        },
      ],
    },

    {
      id: "data",
      title: "Data requirements",
      intent: "What goes in, where it rests, and how long it stays.",
      fields: [
        {
          id: "data_categories",
          label: "What data does it process?",
          type: "multi_select",
          required: true,
          options: [
            { value: "internal", label: "Internal" },
            { value: "confidential", label: "Confidential" },
            { value: "personal", label: "Personal data" },
            { value: "special_category", label: "Special category" },
            { value: "financial", label: "Financial" },
            { value: "customer_content", label: "Customer content" },
          ],
        },
        {
          id: "lawful_basis",
          label: "What is the lawful basis for processing it?",
          type: "short_text",
          required: true,
          showIf: {
            fieldId: "data_categories",
            includesAny: ["personal", "special_category"],
          },
        },
        {
          id: "retention",
          label: "How long is anything retained, and by whom?",
          type: "long_text",
          required: true,
        },
      ],
    },

    {
      id: "limitations",
      title: "Known limitations",
      intent:
        "What the system is bad at, written down before someone discovers it in production. The most useful section in the document a year later.",
      fields: [
        {
          id: "known_limitations",
          label: "What is it known to do badly?",
          type: "long_text",
          required: true,
          aiAssist: true,
        },
        {
          id: "limitation_communication",
          label: "How are users told about these limits?",
          type: "long_text",
        },
      ],
    },

    {
      id: "mitigations",
      title: "Mitigations and residual position",
      intent:
        "What we have actually done, and what remains after doing it. A residual position of zero is not credible.",
      fields: [
        {
          id: "mitigations",
          label: "Controls and mitigations in place",
          type: "repeatable_rows",
          columns: [
            { id: "mitigation", label: "Mitigation", type: "short_text" },
            { id: "owner", label: "Owner", type: "short_text" },
            { id: "status", label: "Status", type: "short_text" },
          ],
        },
        {
          id: "residual_position",
          label: "What risk remains, and who accepts it?",
          type: "long_text",
          required: true,
          aiAssist: true,
        },
        {
          id: "review_trigger",
          label: "What would make us reassess before the scheduled review?",
          type: "long_text",
        },
      ],
    },
  ],
};
