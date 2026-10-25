/**
 * The trust centre, and the line between two audiences.
 *
 * One page, two readers. Internally it answers the question that otherwise
 * arrives as a Teams message to the governance lead twenty times a week — *may I
 * use this tool, and what may I put into it?* Externally it answers the question
 * a buyer's legal team asks before they will sign.
 *
 * The dangerous version of this feature is one page that silently shows less
 * when shared. Somebody eventually publishes the wrong thing, and nobody notices
 * because nothing on screen ever said what the boundary was. So the boundary is
 * a property of the data here, not a filter applied at render time: every entry
 * declares its `audience`, the internal view *marks* what a customer would not
 * see, and the external view states how much is hidden rather than quietly
 * dropping it.
 *
 * The other decision worth naming: **the readiness percentage is internal.**
 * Publishing "39% ready" to a customer is worse than publishing nothing — a
 * number without its definition invites a comparison against somebody else's
 * number computed a different way, and ours is deliberately strict. Externally
 * we publish the posture: which standard, where we are in certifying against it,
 * and what we commit to. Those are checkable claims. A score is not.
 */
import { frameworkReadiness } from "./readiness";
import type { AISystem, AIUseCase, RiskTier } from "./types";
import type { Workspace } from "./workspace";

export type Audience = "internal" | "external";

/** Whether an approved tool may be named outside the organisation. */
export type Shareability = "both" | "internal_only";

export interface ToolEntry {
  systemId: string;
  name: string;
  vendor: string;
  /** What staff are actually asking: may I use it, and for what. */
  status: "approved" | "conditional" | "not_approved" | "withdrawing";
  useFor: string[];
  mayNotContain: string[];
  oversight: string;
  /**
   * What the line above is a floor over.
   *
   * A tool doing four jobs publishes the least supervised of the four. Without
   * this sentence beside it a reader takes it for the arrangement rather than
   * for the worst case, which is a stronger claim than the data supports.
   */
  oversightBasis: string;
  /**
   * How many purposes this tool is governed for.
   *
   * The count before the disclosure filter, so it does not move with the
   * audience: `useFor.length` is what may be *named*, this is what exists.
   * Internal readers get both, and the gap between them is the point.
   */
  governedUseCases: number;
  /**
   * The highest risk tier of any purpose this tool serves.
   *
   * The maximum rather than an average, because scoping under the AI Act
   * attaches to the intended purpose: a tool serving one high-risk purpose is in
   * scope for high-risk obligations for that purpose however ordinary its other
   * uses are. An average would let four minimal purposes dilute one that is not,
   * which is the arithmetic a regulator would ask about.
   */
  highestTier: RiskTier | null;
  /**
   * Whether every purpose this tool serves is actually governed.
   *
   * A conjunction over purposes, not a property of the system: completeness is
   * per-purpose, so a tool with four uses of which one is unassessed is not
   * fully governed. Claiming otherwise is the overstatement this page exists to
   * avoid — and the system-level `status` above cannot say it, because it reads
   * the system's own assessment and knows nothing about the jobs.
   */
  everyUseCaseAssessed: boolean;
  audience: Shareability;
  /** Why it is not shareable, shown to internal readers beside the mark. */
  withheldBecause: string | null;
}

const CONFIDENTIAL = ["Special category personal data", "Unreleased financial results"];

/**
 * The approved list, derived from the inventory rather than maintained twice.
 *
 * A trust centre kept as its own document is a trust centre that is wrong within
 * a month. Status here follows the assessment and lifecycle state on the system
 * record, so withdrawing a tool in the inventory withdraws it here.
 */
/**
 * Supervision, ranked. Higher is weaker, so the maximum is the least supervised.
 *
 * The name reads backwards from the sort that uses it, which cost a reader
 * once: the sort is descending and takes `[0]`, so the *largest* number wins
 * and `none: 3` is the one that surfaces.
 *
 * A tool with several use cases has several oversight arrangements, and this
 * page shows one line. Which one it shows was previously whichever came first
 * in the array — publishable prose decided by insertion order. It now shows the
 * weakest, because a trust centre that claims more supervision than the least
 * supervised use case actually has is making a false statement to a customer,
 * and understating is the only direction that is safe to be wrong in.
 */
const OVERSIGHT_STRENGTH: Record<string, number> = {
  human_in_the_loop: 0,
  human_on_the_loop: 1,
  human_in_command: 2,
  none: 3,
};

/**
 * An unrecognised level is treated as the weakest, not the strongest.
 *
 * The lookup used to fall back to `0`, which is `human_in_the_loop` — so a value
 * this map had never heard of was silently published as the most supervised
 * arrangement there is, and could never be selected as the floor. A level we
 * cannot read is a level we cannot vouch for, and the whole argument for showing
 * the weakest is that understating is the only safe direction to be wrong in.
 */
function supervision(level: string): number {
  return OVERSIGHT_STRENGTH[level] ?? OVERSIGHT_STRENGTH.none;
}

export function toolEntries(ws: Workspace): ToolEntry[] {
  const live = ws.systems.filter((s) => s.lifecycleStage !== "retired");

  /*
   * Shareability for every system, computed before any entry is built.
   *
   * A use case reaches several systems now, and its *name* is published prose.
   * Deciding one entry at a time would publish that name through whichever
   * parent happened to be approved, while correctly withholding the entry of
   * the parent that was not — so the tool stays hidden and the sentence
   * describing what it is used for goes out anyway. The boundary has to be a
   * property of the data rather than of the route somebody arrived by, which is
   * this module's opening argument, so it is settled in one pass here and read
   * in the next.
   */
  const onPage = new Set(live.map((s) => s.id));
  const shareableSystems = new Set(
    live.filter((system) => shareabilityOf(ws, system) === "both").map((s) => s.id),
  );

  return live.map((system) => {
    const uses = ws.getUseCasesForSystem(system.id);
    /*
     * Approval follows the inventory's own status, not the assessment register.
     * The register holds five worked examples; the inventory knows the state of
     * all fifteen. Deriving from the smaller set made ten approved systems read
     * as unapproved here — a trust centre disagreeing with the inventory is
     * worse than not having one.
     */
    const status = statusOf(ws, system);

    const shareable = shareabilityOf(ws, system);

    return {
      systemId: system.id,
      name: system.name,
      vendor: system.vendor,
      status,
      /*
       * **Least-shareable wins.** A purpose is published only when every system
       * implementing it may be published. One tool approved and another still
       * under review means the purpose itself is not yet something to say out
       * loud — and naming it here would describe the withheld tool's job while
       * withholding the tool, which is the disclosure the entry above was
       * suppressed to prevent.
       *
       * Internally the list is whole, because internally there is nothing to
       * withhold: the reader can already open both systems.
       */
      useFor: uses
        .filter(
          (u) =>
            shareable !== "both" ||
            /* Only systems this page could show can gate what it says. A
             * retired tool has no entry to be inferred from, and retirement is
             * a lifecycle fact rather than a reason to withhold — letting one
             * veto a purpose would hide it forever with nothing on screen
             * explaining why. */
            u.systemIds.every((id) => !onPage.has(id) || shareableSystems.has(id)),
        )
        .map((u) => u.name)
        .sort(),
      mayNotContain: system.dataCategories.includes("special_category")
        ? ["Nothing beyond what the assessment covers"]
        : CONFIDENTIAL,
      /*
       * The floor, and the count it is a floor over.
       *
       * With one use case "the oversight arrangement" is a fair description.
       * With four it is not: publishing the weakest as though it were the level
       * misrepresents the three that are better supervised, and publishing
       * anything else overstates the one that is worst. So the sentence says
       * which it is, and `oversightFloorOf` says how many it was chosen from.
       */
      oversight:
        [...uses]
          .map((u) => ws.effectiveOversight(u.id, system.id))
          .sort((a, b) => supervision(b.level) - supervision(a.level))[0]?.summary ??
        "Assessed at system level; no use case recorded separately.",
      oversightBasis: oversightBasis(uses.length),
      governedUseCases: uses.length,
      highestTier: highestTier(ws, uses, system.id),
      everyUseCaseAssessed:
        uses.length > 0 && uses.every((u) => Boolean(u.assessmentId)),
      audience: shareable,
      withheldBecause:
        shareable === "internal_only"
          ? status === "withdrawing"
            ? "Being withdrawn — naming it externally invites a question about why it was in use"
            : "Not approved, or carrying an open finding"
          : null,
    };
  });
}

export interface Commitment {
  id: string;
  claim: string;
  /** What backs it — a customer can ask, and this is the answer. */
  basis: string;
  audience: Shareability;
}

/**
 * What we are willing to say we do.
 *
 * Every entry is a checkable claim rather than a value statement. "We take AI
 * safety seriously" commits to nothing and can never be shown false; "no
 * supplier trains on your data under our enterprise agreements" can be checked
 * against a contract, which is the only kind of claim worth publishing.
 */
export function commitments(ws: Workspace): Commitment[] {
  const readiness = frameworkReadiness(ws);
  /* An organisation with no framework loaded has nothing to claim about one,
   * so the sentence names the gap rather than rendering "undefined". */
  const standard = ws.framework?.shortName ?? "no standard yet";

  return [
    {
      id: "framework",
      claim: `We govern AI against ${standard}, with ${readiness.scoped} controls in scope.`,
      basis: "Statement of Applicability, reviewed quarterly at the governance forum.",
      audience: "both",
    },
    {
      id: "certification",
      claim:
        "We are not yet certified. A stage 1 readiness review is complete; stage 2 is scheduled once the open findings from it are closed.",
      basis: "Kestrel Assurance stage 1 report, ref KA-42001-S1-07.",
      audience: "both",
    },
    {
      id: "no-training",
      claim:
        "No supplier trains its models on your data under our enterprise agreements, and that prohibition is contractual rather than a setting.",
      basis: "Data processing agreements and AI addenda held per supplier.",
      audience: "both",
    },
    {
      id: "assessment",
      claim:
        "No AI system reaches production without an approved impact assessment, signed off by three people in three different roles.",
      basis: "AI Impact Assessment Procedure v1.2 and the assessment register.",
      audience: "both",
    },
    {
      id: "oversight",
      claim:
        "Where an AI system contributes to a decision about a person, a human reviews and confirms before the outcome takes effect, and the person can ask for it to be re-reviewed.",
      basis: "Oversight level recorded per use case, not per tool.",
      audience: "both",
    },
    {
      id: "residency",
      claim:
        "Customer data processed by AI systems stays in the EU, with the contractual basis recorded per system.",
      basis: "Hosting region and residency basis held on each inventory record.",
      audience: "both",
    },
    {
      id: "readiness-figure",
      claim: `Internal readiness stands at ${readiness.ready.percent}% — applicable, implemented and evidenced.`,
      basis:
        "Deliberately not published. A score without its definition invites comparison against numbers computed a different way, and ours is stricter than most.",
      audience: "internal_only",
    },
    {
      id: "open-findings",
      claim: `${ws.findings.filter((f) => f.status !== "closed").length} findings are open, ${
        ws.findings.filter((f) => f.status !== "closed" && f.severity === "critical").length
      } of them critical.`,
      basis:
        "Findings are shared with an auditor under an engagement, and with a customer only where a contract requires it.",
      audience: "internal_only",
    },
  ];
}

/** The rules staff are actually looking for when they open this page. */
export function houseRules(ws: Workspace) {
  const policy = ws.policies.find((p) => p.id === "pol-ai-use");
  return {
    policy,
    rules: [
      {
        id: "approved-only",
        text: "Use tools from the approved list. If it is not on the list, it has not been assessed — which is not the same as it being banned, it means nobody has checked yet.",
      },
      {
        id: "data-class",
        text: "Never paste special category personal data, unreleased financial results or another organisation's confidential material into any AI tool, approved or not.",
      },
      {
        id: "check-output",
        text: "You own what you send. An AI draft that goes out under your name is your work, and 'the tool wrote it' is not a defence anyone will accept on your behalf.",
      },
      {
        id: "customers",
        text: "Tell people when they are talking to an AI agent rather than a person. Nobody minds until they find out afterwards.",
      },
      {
        id: "raise-it",
        text: "If a tool behaves in a way that surprises you, raise it. A surprise is the earliest form of a finding, and the ones caught early cost nothing.",
      },
    ],
  };
}

/**
 * What staff are asking about a tool: may I use it, and for what.
 *
 * Lifted out of `toolEntries` unchanged, so the entry pass and the use-case pass
 * can read one rule rather than two copies of it — the pair disagreeing is
 * exactly how a withheld system's purpose would get published through an
 * approved sibling.
 */
function statusOf(ws: Workspace, system: AISystem): ToolEntry["status"] {
  const withdrawing = ws.risks.some(
    (r) => r.systemId === system.id && r.treatment === "avoid" && r.status === "open",
  );
  const openFindings = ws.findings.some(
    (f) => f.systemId === system.id && f.status !== "closed",
  );

  if (withdrawing) return "withdrawing";
  if (system.assessmentStatus === "approved") return "approved";
  return openFindings || system.riskTier === "high" ? "not_approved" : "conditional";
}

/**
 * Whether a system may appear on the public page at all.
 *
 * Approved and nothing else — a tool we are withdrawing, or one still
 * conditional, is a fact staff need and a customer has no business inferring
 * from a public page.
 *
 * **Deliberately unchanged in behaviour.** This replaced a ternary whose two
 * arms both returned `"both"`, so it looked like `dataCategories` mattered and
 * it never did. Collapsing it is the same rule written once; widening it — to
 * withhold an approved system carrying an open finding, say — would be a change
 * to what this organisation publishes, and belongs in its own change with its
 * own argument rather than smuggled in beside a relation.
 */
function shareabilityOf(ws: Workspace, system: AISystem): Shareability {
  return statusOf(ws, system) === "approved" ? "both" : "internal_only";
}

/**
 * How many purposes the published oversight line was chosen from.
 *
 * The line itself is the least supervised arrangement of the lot. Saying so is
 * the difference between a customer reading it as "this is how the tool is
 * supervised" and reading it as "this is the least supervision applied to any
 * job it does" — the second is what the sentence actually means, and only the
 * second is defensible once a tool does several jobs.
 */
function oversightBasis(count: number): string {
  if (count === 0) return "No use case is recorded separately for this tool.";
  if (count === 1) return "The one recorded purpose for this tool.";
  return `The least supervised of ${count} recorded purposes.`;
}

/** Ranked, so the maximum is the tier that decides the obligations. */
const TIER_ORDER: RiskTier[] = ["minimal", "limited", "high", "unacceptable"];

/**
 * The highest tier of any purpose, or null when there are none.
 *
 * Null rather than "minimal": a tool nobody has recorded a purpose for has not
 * been assessed as low risk, it has not been assessed. Defaulting the two to the
 * same answer is how an unexamined tool comes to look like a safe one.
 */
function highestTier(
  ws: Workspace,
  uses: AIUseCase[],
  systemId: string,
): RiskTier | null {
  if (uses.length === 0) return null;
  /* The tier of each purpose **as done on this tool**, not the purpose's own.
   * That is the whole point of a pair-level override: summarising meetings may
   * be limited risk in an enterprise tenant and high in a consumer chatbot, and
   * publishing the same worst case against both would be wrong about one. */
  return uses.reduce<RiskTier>((worst, use) => {
    const tier = ws.effectiveTier(use.id, systemId);
    return TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(worst) ? tier : worst;
  }, "minimal");
}
