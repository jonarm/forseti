import { createAccessControl } from "better-auth/plugins/access";

import {
  RECORD_KIND_IDS,
  RECORD_KINDS,
  type RecordKind,
} from "./ams/record-kinds";
import {
  adminAc,
  defaultStatements,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Who may change what.
 *
 * Forseti has always resolved the caller's role — `requireOrgContext()` re-reads
 * it from the membership table on every request — and then never used it. Every
 * route authorised identically, so any member could reword a control (changing
 * what the company claims to a buyer), delete one (changing the score), or import
 * a framework over the top of another. This file is the missing half.
 *
 * **One vocabulary, evaluated locally.** `createAccessControl` gives a set of
 * statements and roles built from them, and a role's `authorize()` is a
 * *synchronous, pure* check over its own statements — no database call, no API
 * round trip. That is what makes it cheap enough to run on every request, and it
 * is why `auth.api.hasPermission()` is not used: it would be a network call to
 * re-derive something `OrgContext.role` already carries.
 *
 * The same `ac` and roles are handed to the `organization()` plugin in `auth.ts`,
 * so Better Auth polices its own member and invitation endpoints from these
 * definitions rather than a second set. One source of truth, two enforcement
 * points, each owning what it is good at.
 *
 * **The five roles are the governance function's own org chart**, not a generic
 * owner/admin/member ladder. A platform admin runs the tenant; an AI governance
 * lead owns the management system's shape; a system owner evidences the systems
 * they are accountable for; a reviewer approves what somebody else wrote; an
 * auditor reads. The ladder metaphor breaks at the reviewer on purpose — a
 * reviewer holds *fewer* statements than a system owner, and one the system
 * owner must never hold, because the entire value of an approval is that the
 * author could not grant it to themselves.
 *
 * **Legal, Security and the exec sponsor are not roles here.** They are the
 * *stages* a particular record has to clear, and who covers a stage differs per
 * system and changes over time. Encoding them as roles would mean a new role
 * every time the workflow gained a step, and would still not answer who reviews
 * *this* assessment. They live in `ai_review_assignment`, which names a reviewer
 * per subject and stage. The role says "may approve at all"; the assignment says
 * "is the one to approve this".
 */

/**
 * Everything that can be permitted.
 *
 * Extends Better Auth's own statements rather than replacing them — dropping
 * `organization`, `member` or `invitation` here would silently disarm the
 * plugin's own checks on member management.
 *
 * Read is deliberately absent. Membership grants read; there is no `control:
 * ["read"]`, because a role that can open the app can see the library. Adding
 * read statements would mean every page acquiring a check that can only ever
 * return true for anyone who got past `requireOrgContext()`.
 */
export const statement = {
  ...defaultStatements,

  /** The library's shape: what a control *says*. Governance-lead territory. */
  control: ["create", "update", "delete"],
  /** Which clause of which standard a control satisfies. Moves the score. */
  crosswalk: ["update"],
  /** Which standards are in scope, and importing a framework wholesale. */
  framework: ["update"],

  /**
   * The AI inventory: registering a system, editing one, importing a register.
   *
   * Sits with the system owner rather than the governance lead, for the reason
   * `answer` does. Recording a tool somebody found in an expense report is the
   * working loop — the whole argument for the inventory is that shadow AI gets
   * written down by whoever notices it, and a register only the governance lead
   * may append to is a register that stays wrong.
   *
   * Deliberately not held by `reviewer`: a reviewer says what is wrong with a
   * system, not what the system is, and moving the record under review makes the
   * finding and the thing it describes impossible to tell apart.
   *
   * **`export` is the odd one out and is held by every role, auditor included.**
   * It writes nothing; it takes a copy of the register off the platform, which
   * is a different kind of act from the other three and the reason it is a
   * statement at all rather than something membership implies. Everyone who can
   * open the inventory can already read every row on it, so refusing the export
   * would stop a spreadsheet and not a disclosure — but a customer who wants the
   * AI register to leave only through certain hands can now say so, and every
   * export is written to the trail either way.
   */
  system: ["create", "update", "delete", "export"],

  /** Answering a control — the working loop, deliberately not admin-only. */
  answer: ["update"],
  evidence: ["create", "delete", "export"],
  risk: ["create", "update", "delete", "export"],
  asset: ["create", "update", "delete"],

  /*
   * The three registers that had no resource at all until their screens grew
   * the same tick boxes and export the inventory has.
   *
   * They are ordinary editable resources, so a tenant can decide in
   * `/settings/roles` who may remove an impact assessment or take the
   * questionnaire register off the platform. Without them those screens could
   * not gate a delete at all, which is the state they were in.
   */
  assessment: ["create", "update", "delete", "export"],
  questionnaire: ["create", "update", "delete", "export"],
  intake: ["create", "update", "delete", "export"],

  /**
   * Use cases, with their own resource rather than riding on `system`.
   *
   * They are a register now — created, corrected, imported, removed and exported
   * on their own screen — and a register gates on a resource of its own. Folding
   * them into `system` would say a use case is a property of the system, which is
   * the reading the whole model exists to refuse: one licence carries a use that
   * summarises meetings and another that answers customers unsupervised, and they
   * are not equally risky.
   *
   * It also matters for what a tenant can decide. Separate statements let an
   * organisation give the people closest to the work the right to write down what
   * a tool is actually being used for, without also handing them the ability to
   * remove the system from the inventory. Held beside `system` in all three
   * writing roles for the reason `system` is: a register only the governance lead
   * may append to is a register that stays wrong.
   */
  useCase: ["create", "update", "delete", "export"],

  /**
   * Findings, with **`verify` split out from `update`**.
   *
   * A finding closes only with a root cause, a corrective action and a dated
   * verification by somebody other than its owner. `update` is the remediation
   * work and belongs to whoever owns the system; `verify` is the assertion that
   * the remediation actually happened, and an owner signing off their own fix is
   * the exact thing that rule exists to prevent. Separate statements make it a
   * permission check rather than an honour system.
   */
  finding: ["create", "update", "delete", "verify", "export"],

  /**
   * Policy documents. **`approve` is split out from `update` on purpose.**
   *
   * Writing a policy is the working loop and belongs with the system owner;
   * saying "this is what we do, and a buyer may rely on it" is a different act.
   * Only an approved document satisfies a control, so `approve` is the moment a
   * draft starts moving the score — that is a decision, not an edit, and it is
   * what makes "a model can draft but only a person approves" enforceable rather
   * than a convention.
   */
  policy: ["create", "update", "delete", "approve"],

  /**
   * The sign-off chain on an impact assessment.
   *
   * The statement that makes Reviewer/Approver a role rather than a job title.
   * Without it a reviewer would be indistinguishable from an auditor, because
   * every other approval in the vocabulary arrives as a side effect of some
   * authoring permission. Answering an assessment is `answer: ["update"]`;
   * endorsing the answers somebody else gave is this, and the two are
   * deliberately held by different people.
   *
   * `reject` sits beside `approve` rather than being implied by it: sending an
   * assessment back is the reviewer's other half, and a role that could approve
   * but not reject would be a rubber stamp with extra steps.
   */
  signoff: ["approve", "reject"],

  /**
   * Naming who reviews a record at a given stage.
   *
   * Deliberately **not** held by `reviewer`. Choosing your own reviewer, or
   * appointing yourself, is the one move that empties an approval of meaning —
   * and it would do it quietly, because the resulting record looks exactly like
   * a properly assigned one. Assigning is workflow shaping, so it sits with the
   * governance lead beside the rest of the management system's shape.
   */
  review: ["assign"],

  /**
   * Model calls, split by who should be able to spend.
   *
   * `assess` and `answer` are the working loop, and `draft` joins them — writing
   * a policy draft is system-owner work, and the draft cannot approve itself.
   * `map` rewrites the crosswalk for the whole library, so it sits with the other
   * library-shaping permissions even though it is an AI action.
   */
  ai: ["assess", "answer", "map", "draft"],

  /** The company profile the assessment is built from. */
  profile: ["update"],

  /**
   * Editing what the other roles mean.
   *
   * **Its own statement, and deliberately not `member: ["update"]`.** Reusing
   * the members permission would hand the role editor to the governance lead,
   * who could then grant `signoff: ["approve"]` to `system_owner` — and the
   * entire value of an approval is that the author could not grant it to
   * themselves. One edit would turn that off, quietly, and the resulting
   * organization would look exactly like a correctly configured one.
   *
   * It is also not itself editable: see `EDITABLE_RESOURCES`. A permission that
   * can widen who holds it is not a permission.
   */
  role: ["update"],
} as const;

export const ac = createAccessControl(statement);

/**
 * Read-only. Holds no statements at all.
 *
 * An internal auditor, a certification body, an exec who wants the dashboard
 * without the ability to move a number. They see everything — the inventory, the
 * registers, the trail, the trust package — because membership is what grants
 * read, and an auditor who cannot see is not an auditor.
 *
 * This is also the role every unrecognised string resolves to, so it has to stay
 * genuinely powerless. See `normaliseRole()`.
 *
 * **Every statement it holds is `export`, and nothing else.** An auditor may
 * take each register away as a spreadsheet, which is most of what an auditor
 * came to do — and it moves nothing: membership already shows them every row,
 * so the alternative is transcribing the screen. The role stays powerless in
 * the sense that matters, which is that it cannot change a record.
 *
 * That this is also the fallback for an unrecognised role string is why the one
 * statement had to be a read. A fallback that could write would be a bug with no
 * symptom; a fallback that can copy what it is already being shown is not.
 */
export const auditor = ac.newRole({
  system: ["export"],
  useCase: ["export"],
  risk: ["export"],
  finding: ["export"],
  evidence: ["export"],
  assessment: ["export"],
  questionnaire: ["export"],
  intake: ["export"],
});

/**
 * Approves what somebody else wrote. Authors nothing.
 *
 * Legal counsel, the security reviewer, the exec sponsor — whoever is standing
 * at a workflow stage. **Deliberately holds fewer statements than a system
 * owner**, and the omissions are the point: no `answer`, no `policy: update`, no
 * `finding: update`. A reviewer who could edit the assessment they are endorsing
 * turns a second pair of eyes into one pair of eyes twice.
 *
 * Which records a given reviewer is the reviewer *for* is not a role question —
 * it is an assignment, per subject and per stage.
 */
export const reviewer = ac.newRole({
  /* Every register statement a reviewer holds is a read: they may take a
   * register away, not change what is in it. `finding` is the exception, and
   * only because `verify` already lived here — attesting that a fix happened is
   * the reviewer's other half, and it sits beside the export rather than
   * replacing it. */
  system: ["export"],
  useCase: ["export"],
  risk: ["export"],
  evidence: ["export"],
  assessment: ["export"],
  questionnaire: ["export"],
  intake: ["export"],
  finding: ["verify", "export"],
  signoff: ["approve", "reject"],
  policy: ["approve"],
});

/**
 * Accountable for the AI systems they own. Evidences the framework; cannot
 * change what it says.
 *
 * The widely-distributed role, and the one most members hold: registers systems,
 * answers assessments, uploads evidence, works the risk and finding registers,
 * drafts policies. **Cannot approve or verify any of it** — that is the single
 * line between this role and `reviewer`, and it is the line the whole management
 * system leans on.
 */
export const systemOwner = ac.newRole({
  answer: ["update"],
  system: ["create", "update", "delete", "export"],
  useCase: ["create", "update", "delete", "export"],
  evidence: ["create", "delete", "export"],
  risk: ["create", "update", "delete", "export"],
  asset: ["create", "update", "delete"],
  assessment: ["create", "update", "delete", "export"],
  questionnaire: ["create", "update", "delete", "export"],
  intake: ["create", "update", "delete", "export"],
  finding: ["create", "update", "delete", "export"],
  policy: ["create", "update", "delete"],
  ai: ["assess", "answer", "draft"],
});

/**
 * Owns the AI management system itself: the control library, the crosswalk, the
 * frameworks in scope, and the membership list.
 *
 * Holds the working loop as well, because the person running the management
 * system is also the one who fixes what nobody else will. Holds the approvals
 * too — in a small function the governance lead *is* the approver of record, and
 * withholding that would make the product unusable below about thirty people.
 * Where a real separation of duties is required, it comes from assigning a
 * different person to the stage, not from taking the statement away.
 */
export const governanceLead = ac.newRole({
  ...adminAc.statements,
  review: ["assign"],
  control: ["create", "update", "delete"],
  crosswalk: ["update"],
  framework: ["update"],
  answer: ["update"],
  system: ["create", "update", "delete", "export"],
  useCase: ["create", "update", "delete", "export"],
  evidence: ["create", "delete", "export"],
  risk: ["create", "update", "delete", "export"],
  asset: ["create", "update", "delete"],
  assessment: ["create", "update", "delete", "export"],
  questionnaire: ["create", "update", "delete", "export"],
  intake: ["create", "update", "delete", "export"],
  finding: ["create", "update", "delete", "verify", "export"],
  policy: ["create", "update", "delete", "approve"],
  signoff: ["approve", "reject"],
  ai: ["assess", "answer", "map", "draft"],
  profile: ["update"],
});

/**
 * Runs the tenant. Everything a governance lead can do, plus the things that end
 * the organization.
 *
 * **This is Better Auth's `creatorRole`**, which is not a cosmetic setting: the
 * plugin's own last-one-out protections — you cannot remove, demote or leave as
 * the only holder of the creator role — key off whatever `auth.ts` names there,
 * and off nothing else.
 */
export const platformAdmin = ac.newRole({
  ...ownerAc.statements,
  /* The only role that may rewrite the others, and the only one that cannot be
   * rewritten. Both halves are needed: an editor whose own grants are editable
   * is a ladder to everything. */
  role: ["update"],
  review: ["assign"],
  control: ["create", "update", "delete"],
  crosswalk: ["update"],
  framework: ["update"],
  answer: ["update"],
  system: ["create", "update", "delete", "export"],
  useCase: ["create", "update", "delete", "export"],
  evidence: ["create", "delete", "export"],
  risk: ["create", "update", "delete", "export"],
  asset: ["create", "update", "delete"],
  assessment: ["create", "update", "delete", "export"],
  questionnaire: ["create", "update", "delete", "export"],
  intake: ["create", "update", "delete", "export"],
  finding: ["create", "update", "delete", "verify", "export"],
  policy: ["create", "update", "delete", "approve"],
  signoff: ["approve", "reject"],
  ai: ["assess", "answer", "map", "draft"],
  profile: ["update"],
});

export const roles = {
  platform_admin: platformAdmin,
  governance_lead: governanceLead,
  system_owner: systemOwner,
  reviewer,
  auditor,
};

export type RoleName = keyof typeof roles;

/**
 * The order roles are offered in.
 *
 * Most privileged first, except that `reviewer` sits below `system_owner`
 * despite being neither more nor less privileged — the two are incomparable, and
 * a picker still has to put them somewhere. This order reads as the sequence a
 * record moves through: owned, reviewed, audited.
 */
export const ROLE_ORDER: RoleName[] = [
  "platform_admin",
  "governance_lead",
  "system_owner",
  "reviewer",
  "auditor",
];

/** The role a new member starts as, and the floor an unknown string falls to. */
export const LEAST_PRIVILEGED_ROLE: RoleName = "auditor";

/**
 * The role that owns the tenant.
 *
 * Exported because it is Better Auth's `creatorRole` and `members-table.tsx`'s
 * last-one-out guard, and those two must never drift apart — the plugin refuses
 * to demote the last holder of whatever `auth.ts` names, so a UI guarding a
 * different string guards nothing.
 */
export const CREATOR_ROLE: RoleName = "platform_admin";

export const ROLE_LABEL: Record<RoleName, string> = {
  platform_admin: "Platform Admin",
  governance_lead: "AI Governance Lead",
  system_owner: "AI System Owner",
  reviewer: "Reviewer / Approver",
  auditor: "Auditor",
};

export const ROLE_BLURB: Record<RoleName, string> = {
  platform_admin:
    "Everything a governance lead can do, plus deleting the organization.",
  governance_lead:
    "Owns the management system — the control library, the frameworks in scope, and the members.",
  system_owner:
    "Registers systems, answers assessments, uploads evidence, works the registers.",
  reviewer:
    "Approves assessments, policies and finding verifications. Authors nothing.",
  auditor:
    "Read-only — the inventory, the registers, the trail, the trust package.",
};

/**
 * What a stored role string means.
 *
 * Three generations of role names are in the column and all three have to keep
 * resolving:
 *
 *   - Better Auth's own defaults — owner/admin/**member** — from before
 *     `permissions.ts` existed. `member` meant "can do everything", because
 *     nothing was enforced.
 *   - Forseti's first four — owner/admin/contributor/viewer.
 *   - These five.
 *
 * `drizzle/0012` rewrites the column, so in a migrated database the aliases are
 * dead weight. They stay because a row the migration missed, a row written by an
 * older client, or a restored backup still has to resolve to something sensible
 * rather than silently losing every permission — or worse, silently gaining one.
 *
 * The mapping preserves what each old role could actually do: `admin` owned the
 * library, which is the governance lead's job; `contributor` did the work, which
 * is the system owner's.
 */
const ALIASES: Record<string, RoleName> = {
  // Forseti's first four.
  owner: "platform_admin",
  admin: "governance_lead",
  contributor: "system_owner",
  viewer: "auditor",
  // Better Auth's default, from before anything was enforced.
  member: "system_owner",
};

export function normaliseRole(role: string | null | undefined): RoleName {
  const value = (role ?? "").trim().toLowerCase();

  if (Object.hasOwn(roles, value)) return value as RoleName;
  if (Object.hasOwn(ALIASES, value)) return ALIASES[value];

  // Anything unrecognised is read-only. An unknown role must never be an
  // accidental grant — a typo in the column should cost access, not confer it.
  return LEAST_PRIVILEGED_ROLE;
}

/** A permission request, e.g. `{ control: ["update"] }`. */
export type PermissionRequest = Parameters<typeof platformAdmin.authorize>[0];

/**
 * May this role do this?
 *
 * Pure and synchronous. Safe to call in a Server Component during render, in a
 * route guard, and in a test with no database.
 */
/* ============================================================ tenant grants */

/**
 * What one role may do, as data rather than as a compiled role object.
 *
 * `ai_role_grant` stores this shape per organization, and `can()` evaluates
 * against it when a tenant has customised a role. Absent means "the code
 * default", never "nothing" — the difference is the whole safety of the feature.
 */
export type RoleGrants = Record<string, readonly string[]>;

/** One organization's overrides. A role missing here uses the code default. */
export type OrgGrants = Partial<Record<RoleName, RoleGrants>>;

/**
 * What each role means before anybody edits it.
 *
 * Read off the compiled roles rather than written out a second time. A separate
 * literal would be a second source for the same facts, and the day the two
 * disagreed the screen would show one answer while the routes enforced another —
 * which is the failure this whole module exists to prevent.
 */
export function defaultGrants(role: RoleName): RoleGrants {
  return roles[role].statements as RoleGrants;
}

/**
 * The resources a tenant may re-assign, and the three it may not.
 *
 * `statement` spreads Better Auth's `defaultStatements`, so `organization`,
 * `member` and `invitation` are in the vocabulary — and those three are policed
 * by the organization plugin from the `ac` it was handed at import in `auth.ts`,
 * not by `can()`. `members-table.tsx` calls `authClient.organization.*` directly.
 * So an edit to `member: ["update"]` would be honoured by our routes and ignored
 * by the plugin — divergence in the permissive direction, which is the worst
 * one. They stay fixed until the plugin can read a per-tenant matrix, and the
 * screen says so rather than hiding them.
 *
 * `role` is excluded for a different reason: a permission that can widen who
 * holds it is not a permission.
 */
export const EDITABLE_RESOURCES: readonly string[] = Object.keys(statement).filter(
  (resource) => !["organization", "member", "invitation", "role", "ac"].includes(resource),
);

/**
 * The role whose meaning is fixed.
 *
 * `platform_admin` is Better Auth's `creatorRole`, and the plugin's last-one-out
 * protections key off it. A tenant that could edit it could lock itself out of
 * its own organization — repairable only from the database — and could also
 * escalate, since it is the role holding `role: ["update"]` in the first place.
 */
export const FIXED_ROLE: RoleName = CREATOR_ROLE;

/**
 * Grants that may never be made, whatever a customer's process says.
 *
 * **These are the product's segregation of duties, not preferences.** Each one
 * is a rule stated elsewhere in this file and enforced somewhere in the store;
 * a matrix that could switch them off would let an organization configure away
 * the thing that makes its own records defensible — and the resulting setup
 * would look identical to a correct one.
 *
 * Refused in the store rather than only here, so the rule holds however the row
 * arrives: a seed, an import, a future API client.
 */
export const FORBIDDEN_GRANTS: Array<{
  role: RoleName;
  resource: string;
  action: string;
  why: string;
}> = [
  {
    role: "system_owner",
    resource: "signoff",
    action: "approve",
    why: "A system owner answers the assessment. An author who can endorse their own answers turns a second pair of eyes into one pair of eyes twice.",
  },
  {
    role: "system_owner",
    resource: "signoff",
    action: "reject",
    why: "Sending an assessment back is the reviewer's other half. Holding it alongside authorship is the same conflict as approving.",
  },
  {
    role: "system_owner",
    resource: "finding",
    action: "verify",
    why: "A finding closes only with a dated verification by somebody other than its owner. The owner remediates; somebody else attests it happened.",
  },
  {
    role: "system_owner",
    resource: "policy",
    action: "approve",
    why: "Writing a policy is the working loop; saying a buyer may rely on it is a different act. Only an approved policy satisfies a control.",
  },
  {
    role: "reviewer",
    resource: "review",
    action: "assign",
    why: "A reviewer who can appoint their own reviewer has emptied the approval of meaning, and the resulting record looks exactly like a properly assigned one.",
  },
];

/** Why a proposed matrix was refused, in a sentence somebody can act on. */
export function refusedGrant(
  role: RoleName,
  grants: RoleGrants,
): string | null {
  if (role === FIXED_ROLE) {
    return `${ROLE_LABEL[FIXED_ROLE]} cannot be edited. It runs the tenant, and it is the role that holds the permission to edit the others.`;
  }

  for (const [resource, actions] of Object.entries(grants)) {
    if (!EDITABLE_RESOURCES.includes(resource)) {
      return `"${resource}" cannot be re-assigned here. Membership and invitations are enforced by the auth library from a fixed definition, so an edit would apply to this app and not to it.`;
    }
    const known = (statement as Record<string, readonly string[]>)[resource] ?? [];
    for (const action of actions) {
      if (!known.includes(action)) {
        return `"${resource}: ${action}" is not a permission this product defines.`;
      }
    }
  }

  for (const rule of FORBIDDEN_GRANTS) {
    if (rule.role !== role) continue;
    if (grants[rule.resource]?.includes(rule.action)) {
      return `${ROLE_LABEL[role]} cannot be given "${rule.resource}: ${rule.action}". ${rule.why}`;
    }
  }

  return null;
}

/**
 * What a role means here, after this organization's edits.
 *
 * The non-editable resources always come from the code, never from the stored
 * row — so a grant written directly into the table, by an older client or a
 * hand-run SQL statement, still cannot hand out `member: ["update"]`.
 */
export function effectiveGrants(role: RoleName, orgGrants?: OrgGrants): RoleGrants {
  const override = orgGrants?.[role];
  if (!override || role === FIXED_ROLE) return defaultGrants(role);

  const base = defaultGrants(role);
  const effective: RoleGrants = {};

  for (const resource of Object.keys(statement)) {
    effective[resource] = EDITABLE_RESOURCES.includes(resource)
      ? (override[resource] ?? [])
      : (base[resource] ?? []);
  }

  return effective;
}

/**
 * May this role do this?
 *
 * **`grants` is optional, and its absence means the code defaults.** Every
 * existing caller keeps the behaviour it had, and — more importantly — a failed
 * read of the grants table degrades to the shipped matrix rather than to an
 * empty one. Empty would mean every role locked out of everything, which is the
 * opposite of the "degrade to the empty state" rule the rest of the store
 * follows, and the one place that rule is wrong.
 *
 * The uncustomised path goes through the compiled role's own `authorize()`, so
 * it is byte-for-byte the behaviour that shipped. The customised path evaluates
 * the same subset check by hand, because there is no compiled role to ask.
 * `permissions.test.ts` asserts the two agree for every role and every
 * permission in the vocabulary — without that, a tenant customising one resource
 * could silently acquire different semantics everywhere else.
 */
export function can(
  role: string | null | undefined,
  request: PermissionRequest,
  grants?: OrgGrants,
): boolean {
  const name = normaliseRole(role);
  const override = grants?.[name];
  if (!override || name === FIXED_ROLE) {
    return roles[name].authorize(request).success;
  }

  const held = effectiveGrants(name, grants);
  return Object.entries(request).every(([resource, actions]) =>
    (actions as readonly string[]).every((action) =>
      held[resource]?.includes(action),
    ),
  );
}

/**
 * The permissions a client component is allowed to know about.
 *
 * Passed to the browser instead of the role itself, deliberately. A client given
 * `role === "governance_lead"` has to re-derive what that means, and the moment
 * it does there are two permission matrices that can disagree — the server would
 * refuse something the UI offered, or worse, offer something it would refuse.
 *
 * This is a courtesy for the UI, never a control. The route is the gate.
 */
export interface UiPermissions {
  /** Add, edit, delete a control; import a framework; edit the crosswalk. */
  editLibrary: boolean;
  /**
   * Change the Statement of Applicability: whether a control is in scope, and
   * which systems it is claimed against.
   *
   * Its own flag rather than a reuse of `editLibrary`, because the two are
   * different questions about different things. The library is what the control
   * *says* — the standard's text, our paraphrase, the crosswalk. The SoA is what
   * this organisation has decided about it, and claiming a control against a
   * system is the decision every readiness figure is computed from.
   *
   * Reads `framework: ["update"]`, which **a system owner deliberately does not
   * hold.** Scope is the governance lead's call: a system owner evidences the
   * framework and cannot change what it says, which is the single line between
   * those two roles. So this is refused on most profile tabs, and refused
   * visibly rather than hidden.
   */
  editSoa: boolean;
  /** Answer controls and attach evidence. */
  answerControls: boolean;
  /** Risk register, asset inventory, findings. */
  editRegisters: boolean;
  /** Correct a registered AI system — the profile's editors. */
  editInventory: boolean;
  /**
   * Register a system, or import a register.
   *
   * Its own flag rather than a reuse of `editInventory`, because `POST
   * /api/systems` and `POST /api/systems/import` check `system: ["create"]`
   * while the profile's editors check `system: ["update"]`. The two statements
   * are held by the same three roles today, and a flag that agrees with its
   * route by coincidence disagrees with it the first time a role changes — the
   * argument the `runAi` note makes.
   */
  registerSystems: boolean;
  /**
   * Remove a system from the register.
   *
   * Its own flag for the reason `registerSystems` is: `POST /api/systems/delete`
   * checks `system: ["delete"]`, and the three statements on `system` are held
   * by the same three roles today only by coincidence. A tenant that takes
   * `delete` off the system owner — which is exactly the edit `/settings/roles`
   * exists to make — has to see the tick boxes refused while Register stays
   * enabled, and a flag shared with its neighbours could not express that.
   */
  deleteSystems: boolean;
  /**
   * What this caller may export and remove, per register.
   *
   * A map rather than a boolean per pair, because eight registers each carry the
   * same two questions and a flag per pair would be a wall of near-identical
   * lines that drift one at a time. The keys are the record kinds, so a screen
   * asks `records[kind].delete` with the same kind it passes to the route — the
   * flag and the statement the route checks are derived from one registry entry
   * and cannot disagree about which resource they mean.
   *
   * `create` is here because importing a spreadsheet is adding records in bulk
   * and gates on the same statement the register's own form does.
   *
   * `update` is here because a record page is where a register is actually
   * maintained, and the alternative was another top-level boolean beside
   * `editRegisters` — which is `risk: ["update"]` under a name that sounds like
   * it covers all of them. Reading it off the map keeps a screen asking about
   * the kind it is showing.
   *
   * `deleteSystems` survives beside it as the inventory's own name for
   * `records.system.delete`; the register screens use the map.
   */
  records: Record<
    RecordKind,
    { create: boolean; update: boolean; export: boolean; delete: boolean }
  >;
  /**
   * The trash: seeing what is waiting to be deleted for good, and restoring it.
   *
   * **Deliberately narrower than it will end up.** Removed systems are held for
   * thirty days and then destroyed, and while that is new the whole surface is
   * restricted to the platform admin — so the first person to discover the
   * countdown is the one who can do something about it, not an auditor who
   * finds a register shrinking on a schedule nobody explained to them.
   *
   * **One flag for the page, the button and the route.** `/inventory/trash`
   * calls `notFound()` without it and `POST /api/systems/restore` checks the
   * same statement, because a restriction the screen enforces and the route
   * does not is a list of ids away from being no restriction at all.
   *
   * Derived from `role: ["update"]`, which `platform_admin` holds alone and no
   * tenant may re-assign — the same statement `editRoles` reads, and its own
   * flag rather than a reuse of it because the two answer different questions
   * and will separate. When the trash is opened up, this line and the route's
   * change together: probably to `system: ["delete"]` for the view, and back to
   * `system: ["create"]` for the restore, which is what restoring really is.
   */
  viewTrash: boolean;
  /**
   * Run the assessment.
   *
   * Derived from `ai: ["assess"]`, which **no route checks yet** — the assessment
   * run is not built. Kept because the statement exists and the flag is what the
   * screen will read when it is; it is deliberately not reused for the drafting
   * routes below, whose server gates are different statements that today happen
   * to be held by the same three roles. A UI flag that agrees with the server by
   * coincidence disagrees with it the first time a role changes.
   */
  runAi: boolean;
  /** Draft a justification or an assessment answer — `/api/ai/draft-*`. */
  draftWithAi: boolean;
  /** Draft questionnaire answers — `/api/ai/draft-answer`. */
  useCopilot: boolean;
  /** Auto-map the library — library-shaping, so governance-lead only. */
  autoMap: boolean;
  /** Create, edit, delete and draft policy documents. */
  editPolicies: boolean;
  /**
   * Approve a policy. Separate from `editPolicies` because it is the only
   * policy action a system owner is refused, and the UI has to show the
   * difference — a disabled Approve is information, a missing one is confusing.
   */
  approvePolicies: boolean;
  /** Endorse or send back an assessment's sign-off chain. */
  approveSignOff: boolean;
  /** Name who reviews a record at a stage. Never the reviewer themselves. */
  assignReviewers: boolean;
  /** Attest that a finding's corrective action actually happened. */
  verifyFindings: boolean;
  /** Manage members and invitations. */
  manageMembers: boolean;
  /**
   * Mint an account outright — email, initial password, membership — rather
   * than invite one.
   *
   * **Its own flag, and deliberately narrower than `manageMembers`.** Inviting
   * asks somebody to come; this creates the credential they sign in with and
   * hands it to the admin, who then has to pass it on. That is a different act
   * from changing a role, and `member: ["create"]` cannot express the
   * difference — the organization plugin's own statement is held by the
   * governance lead too. So this reads `role: ["update"]`, the one statement
   * `platform_admin` holds alone and no tenant may re-assign, exactly as
   * `viewTrash` does and for the same reason: a lock somebody widens on purpose
   * in code, not by editing a matrix.
   */
  addMembers: boolean;
  /** Rewrite what the other roles mean. Platform admin only, by construction. */
  editRoles: boolean;
}

/**
 * Why an affordance is disabled, worded exactly like the refusal behind it.
 *
 * `requirePermission()` builds its 403 from this same function, so the tooltip a
 * user reads before clicking and the error they would get after clicking are one
 * string. Two hand-written phrasings drift, and then the UI says "ask an admin"
 * while the server says "forbidden" — which reads as two different problems.
 *
 * It names the action rather than saying "forbidden" because the user's next
 * move is only obvious if the message says so.
 */
export function refusalNote(action: string): string {
  return `You do not have permission to ${action}. Ask an organization admin.`;
}

export function uiPermissions(
  role: string | null | undefined,
  /* This organization's edits. Threaded rather than read here so the tenant
   * boundary stays the one place a caller's authority is resolved — and so a
   * screen cannot accidentally render the shipped matrix for a tenant that has
   * changed it. */
  grants?: OrgGrants,
): UiPermissions {
  return {
    editLibrary: can(role, { control: ["update"] }, grants),
    /* Threaded through the tenant's grants like its neighbours: an organisation
     * that moves SoA scope onto another role has to see this follow. */
    editSoa: can(role, { framework: ["update"] }, grants),
    answerControls: can(role, { answer: ["update"] }, grants),
    editRegisters: can(role, { risk: ["update"] }, grants),
    editInventory: can(role, { system: ["update"] }, grants),
    /* Threaded like its neighbours: `system` is an editable resource, so a
     * tenant that takes `create` off a role has to see Register and Import
     * refused rather than enabled from the shipped matrix. */
    registerSystems: can(role, { system: ["create"] }, grants),
    /* Threaded for the same reason, and separately from `create`: removing a
     * system from the register is the one inventory action that takes evidence
     * of a decision out of view. */
    deleteSystems: can(role, { system: ["delete"] }, grants),
    /* Derived from the registry so a new register is covered by existing it,
     * not by somebody remembering to add a line here. */
    records: Object.fromEntries(
      RECORD_KIND_IDS.map((kind) => [
        kind,
        {
          create: can(
            role,
            { [RECORD_KINDS[kind].resource]: ["create"] } as PermissionRequest,
            grants,
          ),
          update: can(
            role,
            { [RECORD_KINDS[kind].resource]: ["update"] } as PermissionRequest,
            grants,
          ),
          export: can(
            role,
            { [RECORD_KINDS[kind].resource]: ["export"] } as PermissionRequest,
            grants,
          ),
          delete: can(
            role,
            { [RECORD_KINDS[kind].resource]: ["delete"] } as PermissionRequest,
            grants,
          ),
        },
      ]),
    ) as UiPermissions["records"],
    /* Not threaded through the tenant's grants, and that is the point: this is
     * a temporary lock to the platform admin while the retention window is new,
     * so it reads the one statement a tenant cannot re-assign. Widening it is a
     * code change somebody makes on purpose, not a matrix edit. */
    viewTrash: can(role, { role: ["update"] }),
    runAi: can(role, { ai: ["assess"] }, grants),
    draftWithAi: can(role, { ai: ["draft"] }, grants),
    useCopilot: can(role, { ai: ["answer"] }, grants),
    autoMap: can(role, { ai: ["map"] }, grants),
    editPolicies: can(role, { policy: ["update"] }, grants),
    approvePolicies: can(role, { policy: ["approve"] }, grants),
    approveSignOff: can(role, { signoff: ["approve"] }, grants),
    assignReviewers: can(role, { review: ["assign"] }, grants),
    verifyFindings: can(role, { finding: ["verify"] }, grants),
    manageMembers: can(role, { member: ["update"] }, grants),
    /* Off the one statement a tenant cannot re-assign, and without grants for
     * that reason — creating a credential is the platform admin's, and it stays
     * so until somebody widens it here on purpose. */
    addMembers: can(role, { role: ["update"] }),
    /* Not editable and deliberately not derived from the grants: this is the
     * flag on the screen that edits them. */
    editRoles: can(role, { role: ["update"] }),
  };
}
