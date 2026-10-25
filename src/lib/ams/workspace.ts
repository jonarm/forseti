/**
 * One organisation's AI management system, as a value.
 *
 * Every screen in this product needs the same handful of registers, and most of
 * them need to walk between registers — a risk names a system, a control cites
 * evidence, a finding undermines a risk. The mockup got that by importing the
 * fixture modules directly and calling module-scope lookups like `systemById`.
 * That cannot survive contact with a database, and the failure mode is the
 * dangerous kind: the screens would still render, still look right, and still
 * show fixture numbers to an organisation whose own rows are empty.
 *
 * So the data becomes an argument. `WorkspaceData` is plain arrays and nothing
 * else — it crosses the server/client boundary intact, which is what lets a
 * Server Component read it and a client component receive it. `Workspace` wraps
 * that with the lookups, which are closures over the same arrays and therefore
 * *cannot* reach another tenant's rows: there is no global left to reach.
 *
 * The lookups keep the names they had as module functions on purpose. A
 * component destructures what it needs off the workspace and every call site
 * below reads exactly as it did when the design was reviewed.
 *
 * `framework` is nullable because a new organisation genuinely has none until
 * something seeds one, and a screen that pretends otherwise crashes on the one
 * day nobody is watching.
 */
import type {
  AccountPerson,
  ActivityEvent,
  AISystem,
  OversightLevel,
  RiskTier,
  AIUseCase,
  AiSuggestion,
  AssessmentInstance,
  ControlApplicability,
  Evidence,
  Finding,
  FindingRiskLink,
  Framework,
  FrameworkControl,
  FrameworkNode,
  IntakeNote,
  IntakeRequest,
  Person,
  Policy,
  Questionnaire,
  Risk,
} from "./types";

/** The serialisable half — safe to hand to a client component as a prop. */
export interface WorkspaceData {
  people: Person[];
  /** Which signed-in accounts are which of those people. Usually a short list. */
  accountPeople: AccountPerson[];
  businessUnits: string[];
  systems: AISystem[];
  useCases: AIUseCase[];
  requests: IntakeRequest[];
  framework: Framework | null;
  nodes: FrameworkNode[];
  controls: FrameworkControl[];
  applicability: ControlApplicability[];
  policies: Policy[];
  evidence: Evidence[];
  assessments: AssessmentInstance[];
  risks: Risk[];
  findings: Finding[];
  findingRiskLinks: FindingRiskLink[];
  activity: ActivityEvent[];
  questionnaires: Questionnaire[];
  suggestions: AiSuggestion[];
  /** Only populated when a page asked for one request's notes. */
  intakeNotes: IntakeNote[];
}

export interface Workspace extends WorkspaceData {
  personById(id: string | null): Person;
  /**
   * The person a signed-in account is, or undefined.
   *
   * Deliberately not `personById`'s shape: that one answers a miss with an
   * "Unassigned" placeholder, which is right for a record whose owner has left
   * and wrong here. An account nobody has matched has no person, and the caller
   * has to say something else — the id, or nothing — rather than assert that a
   * change was made by nobody.
   */
  personForAccount(userId: string | null | undefined): Person | undefined;
  systemById(id: string): AISystem | undefined;
  getUseCase(id: string): AIUseCase | undefined;
  getUseCasesForSystem(systemId: string): AIUseCase[];
  /**
   * The systems implementing a use case, in the order the join returned.
   *
   * The reverse of `getUseCasesForSystem`, and new: while a use case had one
   * system every caller wrote `systemById(useCase.systemId)` inline. Ids that
   * no longer resolve are dropped rather than rendered — `readWorkspace`
   * strips a deleted system from the link array, so an unresolvable id here
   * means a fixture is wrong rather than a system is gone.
   */
  getSystemsForUseCase(useCaseId: string): AISystem[];
  /**
   * How risky this purpose is **on this tool**.
   *
   * The pairing's own answer where it has one, the use case's otherwise. Every
   * figure about a system's exposure should come through here rather than off
   * `useCase.riskTier`, which is the baseline and says nothing about which tool
   * is doing the job.
   *
   * Falls back to the baseline for a system that does not implement the use
   * case at all, rather than throwing: callers are rendering a table, and the
   * honest answer to "what tier is this purpose" without a system is the tier
   * of the purpose.
   */
  effectiveTier(useCaseId: string, systemId?: string): RiskTier;
  /** The same resolution for supervision. See `effectiveTier`. */
  effectiveOversight(
    useCaseId: string,
    systemId?: string,
  ): { level: OversightLevel; summary: string };
  requestById(id: string): IntakeRequest | undefined;
  controlById(id: string): FrameworkControl | undefined;
  nodeById(id: string): FrameworkNode | undefined;
  controlsForNode(nodeId: string): FrameworkControl[];
  applicabilityFor(controlId: string): ControlApplicability | undefined;
  coverageForSystem(systemId: string): {
    claimed: number;
    evidenced: number;
    percent: number;
    rows: ControlApplicability[];
  };
  policyById(id: string | null): Policy | undefined;
  evidenceById(id: string): Evidence | undefined;
  evidenceForSystem(systemId: string): Evidence[];
  assessmentById(id: string): AssessmentInstance | undefined;
  assessmentsForSystem(systemId: string): AssessmentInstance[];
  findingById(id: string): Finding | undefined;
  risksForSystem(systemId: string): Risk[];
  findingsForSystem(systemId: string): Finding[];
  linksForRisk(riskId: string): FindingRiskLink[];
  linksForFinding(findingId: string): FindingRiskLink[];
  underminingFindings(riskId: string): { link: FindingRiskLink; finding: Finding }[];
  activityFor(subjectId: string): ActivityEvent[];
  questionnaireById(id: string): Questionnaire | undefined;
  suggestionById(id: string): AiSuggestion | undefined;
  pendingSuggestionsFor(prefix: string): AiSuggestion[];
}

/** What a brand new organisation looks like before anything is recorded. */
export const EMPTY_WORKSPACE: WorkspaceData = {
  people: [],
  accountPeople: [],
  businessUnits: [],
  systems: [],
  useCases: [],
  requests: [],
  framework: null,
  nodes: [],
  controls: [],
  applicability: [],
  policies: [],
  evidence: [],
  assessments: [],
  risks: [],
  findings: [],
  findingRiskLinks: [],
  activity: [],
  questionnaires: [],
  suggestions: [],
  intakeNotes: [],
};

export function workspace(data: WorkspaceData): Workspace {
  const personIndex = new Map(data.people.map((p) => [p.id, p]));
  const accountIndex = new Map(data.accountPeople.map((row) => [row.userId, row.personId]));
  const systemIndex = new Map(data.systems.map((s) => [s.id, s]));
  const useCaseIndex = new Map(data.useCases.map((u) => [u.id, u]));
  const controlIndex = new Map(data.controls.map((c) => [c.id, c]));
  const nodeIndex = new Map(data.nodes.map((n) => [n.id, n]));
  const applicabilityIndex = new Map(data.applicability.map((row) => [row.controlId, row]));
  const policyIndex = new Map(data.policies.map((p) => [p.id, p]));
  const evidenceIndex = new Map(data.evidence.map((e) => [e.id, e]));
  const assessmentIndex = new Map(data.assessments.map((a) => [a.id, a]));
  const findingIndex = new Map(data.findings.map((f) => [f.id, f]));
  const suggestionIndex = new Map(data.suggestions.map((s) => [s.id, s]));

  const evidenceById = (id: string) => evidenceIndex.get(id);
  const findingById = (id: string) => findingIndex.get(id);
  const linksForRisk = (riskId: string) =>
    data.findingRiskLinks.filter((link) => link.riskId === riskId);

  return {
    ...data,

    /* An unknown id resolves to a placeholder rather than undefined: an owner
     * who has left still has their name on the record they signed, and a table
     * cell reading "Unassigned" is more use than one that is blank. */
    personById(id) {
      if (id) {
        const found = personIndex.get(id);
        if (found) return found;
      }
      return { id: id ?? "unknown", name: "Unassigned", role: "—", businessUnit: "—" };
    },

    personForAccount(userId) {
      if (!userId) return undefined;
      const personId = accountIndex.get(userId);
      return personId ? personIndex.get(personId) : undefined;
    },

    systemById: (id) => systemIndex.get(id),
    getUseCase: (id) => useCaseIndex.get(id),
    getUseCasesForSystem: (systemId) =>
      data.useCases.filter((u) => u.systemIds.includes(systemId)),
    effectiveTier: (useCaseId, systemId) => {
      const useCase = useCaseIndex.get(useCaseId);
      if (!useCase) return "minimal";
      const override = systemId
        ? useCase.systemOverrides.find((o) => o.systemId === systemId)
        : undefined;
      return override?.riskTier ?? useCase.riskTier;
    },
    effectiveOversight: (useCaseId, systemId) => {
      const useCase = useCaseIndex.get(useCaseId);
      if (!useCase) return { level: "human_in_the_loop", summary: "" };
      const override = systemId
        ? useCase.systemOverrides.find((o) => o.systemId === systemId)
        : undefined;
      return {
        level: override?.oversightLevel ?? useCase.oversightLevel,
        /* The summary follows the level rather than being resolved
         * independently: a pairing that overrides the level and not the prose
         * would publish one tool's sentence beside another tool's arrangement. */
        summary:
          override?.oversightLevel != null
            ? (override.oversightSummary ?? "")
            : useCase.oversightSummary,
      };
    },
    getSystemsForUseCase: (useCaseId) =>
      (useCaseIndex.get(useCaseId)?.systemIds ?? [])
        .map((id) => systemIndex.get(id))
        .filter((s): s is AISystem => Boolean(s)),
    requestById: (id) => data.requests.find((r) => r.id === id),
    controlById: (id) => controlIndex.get(id),
    nodeById: (id) => nodeIndex.get(id),
    controlsForNode: (nodeId) => data.controls.filter((ctl) => ctl.nodeId === nodeId),
    applicabilityFor: (controlId) => applicabilityIndex.get(controlId),

    /**
     * Controls claimed against a system, and how many carry evidence *for it*.
     *
     * The arithmetic behind the inventory's coverage column — derived from the
     * join rather than stored on the system, so a control losing its evidence
     * moves the number without anyone editing a row.
     *
     * The rule that matters is what counts as evidence for a given system. A
     * document attached to a specific system only evidences that system: the
     * Microsoft data processing agreement says nothing about DeepL, and
     * counting it for both is how a coverage figure becomes a number that
     * flatters everyone equally and distinguishes nobody. Evidence with no
     * system links is organisation-level — governance forum minutes, the
     * internal audit report — and legitimately covers every system, because
     * that is what it is about.
     */
    coverageForSystem(systemId) {
      const claimed = data.applicability.filter(
        (row) => row.applicability === "yes" && row.appliesToSystemIds.includes(systemId),
      );
      const evidenced = claimed.filter((row) =>
        row.linkedEvidenceIds.some((id) => {
          const doc = evidenceById(id);
          if (!doc) return false;
          return doc.linkedSystemIds.length === 0 || doc.linkedSystemIds.includes(systemId);
        }),
      );
      return {
        claimed: claimed.length,
        evidenced: evidenced.length,
        percent:
          claimed.length === 0 ? 0 : Math.round((evidenced.length / claimed.length) * 100),
        rows: claimed,
      };
    },

    policyById: (id) => (id ? policyIndex.get(id) : undefined),
    evidenceById,
    evidenceForSystem: (systemId) =>
      data.evidence.filter((e) => e.linkedSystemIds.includes(systemId)),
    assessmentById: (id) => assessmentIndex.get(id),
    assessmentsForSystem: (systemId) => data.assessments.filter((a) => a.systemId === systemId),
    findingById,
    risksForSystem: (systemId) => data.risks.filter((r) => r.systemId === systemId),
    findingsForSystem: (systemId) => data.findings.filter((f) => f.systemId === systemId),
    linksForRisk,
    linksForFinding: (findingId) =>
      data.findingRiskLinks.filter((link) => link.findingId === findingId),

    /**
     * Open findings that say a risk's treatment is not holding.
     *
     * The query the risk record is built around. A closed undermining finding
     * is history; an open one is a live argument against the residual number
     * sitting above it.
     */
    underminingFindings(riskId) {
      return linksForRisk(riskId)
        .filter((link) => link.kind === "undermines")
        .map((link) => ({ link, finding: findingById(link.findingId) }))
        .filter(
          (pair): pair is { link: FindingRiskLink; finding: Finding } =>
            pair.finding !== undefined && pair.finding.status !== "closed",
        );
    },

    /** Newest first — an audit trail is read from the top. */
    activityFor: (subjectId) =>
      data.activity
        .filter((e) => e.subjectId === subjectId)
        .sort((a, b) => b.at.localeCompare(a.at)),

    questionnaireById: (id) => data.questionnaires.find((q) => q.id === id),
    suggestionById: (id) => suggestionIndex.get(id),
    pendingSuggestionsFor: (prefix) =>
      data.suggestions.filter((s) => s.status === "pending" && s.target.id.startsWith(prefix)),
  };
}
