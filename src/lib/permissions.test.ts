import {
  RECORD_KIND_IDS as ROLE_KINDS,
  RECORD_KINDS,
} from "./ams/record-kinds";
import { describe, expect, it } from "vitest";

import {
  EDITABLE_RESOURCES,
  FIXED_ROLE,
  FORBIDDEN_GRANTS,
  ROLE_ORDER,
  can,
  defaultGrants,
  effectiveGrants,
  normaliseRole,
  refusedGrant,
  statement,
  uiPermissions,
  type OrgGrants,
  type PermissionRequest,
  type RoleName,
} from "./permissions";

/**
 * The permission matrix.
 *
 * Authorization is the one kind of bug that is silent in both directions: too
 * loose and anybody can rewrite the control library, too tight and the people
 * doing the work are locked out of it, and neither shows up in a typecheck. So
 * the matrix is asserted in full rather than sampled — every role against every
 * statement, with the expected answer written out.
 *
 * Two splits are being protected. A **governance lead** owns what a control
 * *says*; a **system owner** evidences it; an **auditor** reads it. And a
 * **reviewer** approves what a system owner wrote, holding *fewer* statements
 * than the person whose work they are approving — which is the reason the suite
 * cannot be a simple privilege ladder.
 */

/** Every `resource: action` pair the vocabulary defines. */
const EVERY_PERMISSION: Array<[string, string]> = Object.entries(statement).flatMap(
  ([resource, actions]) => (actions as readonly string[]).map((a) => [resource, a] as [string, string]),
);

/** Exactly what each role may do. Anything not listed must be refused. */
const GRANTED: Record<RoleName, Record<string, readonly string[]>> = {
  auditor: {
    // Every statement the auditor holds is `export` — take a register away,
    // change nothing in it. Also the fallback for an unrecognised role string,
    // which is why the only thing it may do had to be something membership
    // already allows — see the note on `auditor` in permissions.ts.
    system: ["export"],
    useCase: ["export"],
    risk: ["export"],
    finding: ["export"],
    evidence: ["export"],
    assessment: ["export"],
    questionnaire: ["export"],
    intake: ["export"],
  },
  reviewer: {
    // The whole role. It approves and it rejects; it writes none of what it is
    // approving, which is what makes the approval worth having. The register
    // statements are all reads, `finding: verify` excepted — attesting a fix
    // happened is the reviewer's other half.
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
  },
  system_owner: {
    system: ["create", "update", "delete", "export"],
    useCase: ["create", "update", "delete", "export"],
    answer: ["update"],
    evidence: ["create", "delete", "export"],
    risk: ["create", "update", "delete", "export"],
    asset: ["create", "update", "delete"],
    assessment: ["create", "update", "delete", "export"],
    questionnaire: ["create", "update", "delete", "export"],
    intake: ["create", "update", "delete", "export"],
    // Remediates a finding; `verify` is deliberately absent, because the rule is
    // that somebody other than the owner attests the fix happened.
    finding: ["create", "update", "delete", "export"],
    // Writes and drafts policies; `approve` is deliberately absent, and is the
    // other action a system owner is refused.
    policy: ["create", "update", "delete"],
    ai: ["assess", "answer", "draft"],
  },
  governance_lead: {
    system: ["create", "update", "delete", "export"],
    useCase: ["create", "update", "delete", "export"],
    control: ["create", "update", "delete"],
    crosswalk: ["update"],
    framework: ["update"],
    answer: ["update"],
    evidence: ["create", "delete", "export"],
    risk: ["create", "update", "delete", "export"],
    asset: ["create", "update", "delete"],
    assessment: ["create", "update", "delete", "export"],
    questionnaire: ["create", "update", "delete", "export"],
    intake: ["create", "update", "delete", "export"],
    finding: ["create", "update", "delete", "verify", "export"],
    policy: ["create", "update", "delete", "approve"],
    signoff: ["approve", "reject"],
    review: ["assign"],
    ai: ["assess", "answer", "map", "draft"],
    profile: ["update"],
    // Inherited verbatim from Better Auth's `adminAc`. Teams are not used in
    // Forseti; the statements come along with the built-in role and are written
    // out here so the matrix states what is actually granted, not what we assume.
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  },
  platform_admin: {
    // The editor's own key. Held here and nowhere else: a role that could widen
    // who edits the matrix could widen anything, one step later.
    role: ["update"],
    system: ["create", "update", "delete", "export"],
    useCase: ["create", "update", "delete", "export"],
    control: ["create", "update", "delete"],
    crosswalk: ["update"],
    framework: ["update"],
    answer: ["update"],
    evidence: ["create", "delete", "export"],
    risk: ["create", "update", "delete", "export"],
    asset: ["create", "update", "delete"],
    assessment: ["create", "update", "delete", "export"],
    questionnaire: ["create", "update", "delete", "export"],
    intake: ["create", "update", "delete", "export"],
    finding: ["create", "update", "delete", "verify", "export"],
    policy: ["create", "update", "delete", "approve"],
    signoff: ["approve", "reject"],
    review: ["assign"],
    ai: ["assess", "answer", "map", "draft"],
    profile: ["update"],
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  },
};

const ask = (resource: string, action: string) =>
  ({ [resource]: [action] }) as PermissionRequest;

describe("the matrix", () => {
  for (const role of ROLE_ORDER) {
    it(`grants ${role} exactly what it should, and nothing else`, () => {
      const wrong: string[] = [];

      for (const [resource, action] of EVERY_PERMISSION) {
        const expected = (GRANTED[role][resource] ?? []).includes(action);
        const actual = can(role, ask(resource, action));
        if (actual !== expected) {
          wrong.push(
            `${role} ${resource}:${action} — expected ${expected ? "allow" : "deny"}, got ${actual ? "allow" : "deny"}`,
          );
        }
      }

      expect(wrong).toEqual([]);
    });
  }

  it("covers every role the vocabulary defines", () => {
    // The matrix is only a full statement of the design while it has a row per
    // role. A sixth role added without a row here would otherwise be untested.
    expect(Object.keys(GRANTED).sort()).toEqual([...ROLE_ORDER].sort());
  });
});

describe("the library belongs to the governance lead", () => {
  // The requirement the permission layer exists for.
  const LIBRARY: PermissionRequest[] = [
    { control: ["create"] },
    { control: ["update"] },
    { control: ["delete"] },
    { crosswalk: ["update"] },
    { framework: ["update"] },
    { ai: ["map"] },
  ];

  it("refuses a system owner, a reviewer and an auditor", () => {
    for (const request of LIBRARY) {
      expect(can("system_owner", request), JSON.stringify(request)).toBe(false);
      expect(can("reviewer", request), JSON.stringify(request)).toBe(false);
      expect(can("auditor", request), JSON.stringify(request)).toBe(false);
    }
  });

  it("allows a governance lead and a platform admin", () => {
    for (const request of LIBRARY) {
      expect(can("governance_lead", request), JSON.stringify(request)).toBe(true);
      expect(can("platform_admin", request), JSON.stringify(request)).toBe(true);
    }
  });
});

describe("a system owner can still do the work", () => {
  it("answers assessments and attaches evidence", () => {
    // The failure mode on the other side: locking the people who evidence the
    // framework out of evidencing it.
    expect(can("system_owner", { answer: ["update"] })).toBe(true);
    expect(can("system_owner", { evidence: ["create"] })).toBe(true);
    expect(can("system_owner", { evidence: ["delete"] })).toBe(true);
  });

  it("works the registers and runs the assessment", () => {
    expect(can("system_owner", { risk: ["create"] })).toBe(true);
    expect(can("system_owner", { finding: ["update"] })).toBe(true);
    expect(can("system_owner", { ai: ["assess"] })).toBe(true);
    expect(can("system_owner", { ai: ["answer"] })).toBe(true);
  });

  it("cannot spend on auto-mapping, which rewrites the crosswalk", () => {
    expect(can("system_owner", { ai: ["map"] })).toBe(false);
  });

  it("writes and drafts policies but cannot approve one", () => {
    // The point of splitting `approve` out of `update`: drafting a policy is the
    // working loop, but only an approved document satisfies a control, so
    // approval is what moves the score and needs a second pair of eyes.
    expect(can("system_owner", { policy: ["create"] })).toBe(true);
    expect(can("system_owner", { policy: ["update"] })).toBe(true);
    expect(can("system_owner", { policy: ["delete"] })).toBe(true);
    expect(can("system_owner", { ai: ["draft"] })).toBe(true);

    expect(can("system_owner", { policy: ["approve"] })).toBe(false);
    expect(can("auditor", { policy: ["approve"] })).toBe(false);
    expect(can("reviewer", { policy: ["approve"] })).toBe(true);
    expect(can("governance_lead", { policy: ["approve"] })).toBe(true);
    expect(can("platform_admin", { policy: ["approve"] })).toBe(true);
  });
});

describe("a reviewer approves what somebody else wrote", () => {
  /**
   * The role that is not a rung on a ladder.
   *
   * Every other role in the set is a superset or subset of its neighbour. A
   * reviewer is neither: it holds approvals a system owner is refused, and is
   * refused the authoring a system owner holds. Asserting both directions is
   * what stops the role being quietly "fixed" into an ordinary rung.
   */
  it("holds the approvals", () => {
    expect(can("reviewer", { signoff: ["approve"] })).toBe(true);
    expect(can("reviewer", { signoff: ["reject"] })).toBe(true);
    expect(can("reviewer", { policy: ["approve"] })).toBe(true);
    expect(can("reviewer", { finding: ["verify"] })).toBe(true);
  });

  it("cannot choose its own reviewer", () => {
    // The move that would empty an approval of meaning while leaving a record
    // that looks exactly like a properly assigned one.
    expect(can("reviewer", { review: ["assign"] })).toBe(false);
    expect(can("governance_lead", { review: ["assign"] })).toBe(true);
  });

  it("authors nothing it could then approve", () => {
    expect(can("reviewer", { answer: ["update"] })).toBe(false);
    expect(can("reviewer", { policy: ["create"] })).toBe(false);
    expect(can("reviewer", { policy: ["update"] })).toBe(false);
    expect(can("reviewer", { finding: ["create"] })).toBe(false);
    expect(can("reviewer", { finding: ["update"] })).toBe(false);
    expect(can("reviewer", { evidence: ["create"] })).toBe(false);
    expect(can("reviewer", { risk: ["update"] })).toBe(false);
  });

  it("spends nothing on the model", () => {
    // A reviewer reads and decides. Nothing in the role needs a model call, and
    // a role that cannot author has no use for one that drafts.
    for (const action of ["assess", "answer", "map", "draft"]) {
      expect(can("reviewer", ask("ai", action)), action).toBe(false);
    }
  });

  it("is the only role that can approve without being able to author", () => {
    // Stated as a property rather than a list, so a future role that quietly
    // acquires the same shape has to be considered rather than slipping in.
    const approvesWithoutAuthoring = ROLE_ORDER.filter(
      (role) =>
        can(role, { signoff: ["approve"] }) && !can(role, { answer: ["update"] }),
    );
    expect(approvesWithoutAuthoring).toEqual(["reviewer"]);
  });
});

describe("a finding is verified by somebody other than its owner", () => {
  it("splits `verify` away from the role that does the remediation", () => {
    // The schema holds the fields and the caller enforces the rule, but the rule
    // is only enforceable at all because the two acts are different statements.
    expect(can("system_owner", { finding: ["update"] })).toBe(true);
    expect(can("system_owner", { finding: ["verify"] })).toBe(false);

    expect(can("reviewer", { finding: ["update"] })).toBe(false);
    expect(can("reviewer", { finding: ["verify"] })).toBe(true);
  });
});

describe("an auditor can change nothing", () => {
  /*
   * This used to read "an auditor holds nothing", and it was true until the
   * inventory export needed a statement. The invariant that actually mattered
   * was never the empty object — it was that the role cannot move anything, and
   * that the fallback for an unrecognised role string is safe. `system:
   * ["export"]` keeps both: it copies rows membership already displays, and it
   * writes nothing but an audit entry.
   *
   * So the test is now the rule rather than the shape: every permission is
   * refused except the one read, and that exception is named. A second
   * statement arriving here should fail this and be argued for on its own.
   */
  const ALLOWED = new Set([
    "system:export",
    "useCase:export",
    "risk:export",
    "finding:export",
    "evidence:export",
    "assessment:export",
    "questionnaire:export",
    "intake:export",
  ]);

  it("is refused every permission except taking a copy of a register", () => {
    for (const [resource, action] of EVERY_PERMISSION) {
      const key = `${resource}:${action}`;
      expect(can("auditor", ask(resource, action)), key).toBe(ALLOWED.has(key));
    }
  });

  it("holds nothing that writes", () => {
    // Stated separately from the loop above so the property survives somebody
    // adding a resource: whatever else appears in the vocabulary, an auditor
    // must not be able to create, update, delete, approve or verify any of it.
    const writes = EVERY_PERMISSION.filter(([, action]) => action !== "export");

    for (const [resource, action] of writes) {
      expect(can("auditor", ask(resource, action)), `${resource}:${action}`).toBe(
        false,
      );
    }
  });

  it("is still the safe landing place for a role string nobody recognises", () => {
    // The reason the auditor's one statement had to be a read.
    expect(can("nonsense", { system: ["export"] })).toBe(true);
    expect(can("nonsense", { system: ["create"] })).toBe(false);
    expect(can("nonsense", { system: ["delete"] })).toBe(false);
  });
});

describe("normaliseRole", () => {
  it("resolves Forseti's first four role names", () => {
    // `drizzle/0012` rewrites the column, so a migrated database holds none of
    // these. They must keep resolving anyway — a restored backup or a row the
    // migration missed has to land somewhere sensible.
    expect(normaliseRole("owner")).toBe("platform_admin");
    expect(normaliseRole("admin")).toBe("governance_lead");
    expect(normaliseRole("contributor")).toBe("system_owner");
    expect(normaliseRole("viewer")).toBe("auditor");
  });

  it("maps Better Auth's legacy `member` to a system owner", () => {
    // Accounts created before any permission was enforced carry `member`, which
    // meant "can do everything". It becomes a system owner: keeps the work,
    // loses the library.
    expect(normaliseRole("member")).toBe("system_owner");
    expect(can("member", { answer: ["update"] })).toBe(true);
    expect(can("member", { control: ["update"] })).toBe(false);
  });

  it("preserves what each legacy role could actually do", () => {
    // The alias table is only correct if it is privilege-preserving. Asserting
    // the whole matrix per alias catches a mapping that reads plausibly and
    // silently promotes or demotes everybody holding it.
    const SAME: Array<[string, RoleName]> = [
      ["owner", "platform_admin"],
      ["admin", "governance_lead"],
      ["contributor", "system_owner"],
      ["viewer", "auditor"],
      ["member", "system_owner"],
    ];

    for (const [legacy, current] of SAME) {
      for (const [resource, action] of EVERY_PERMISSION) {
        expect(
          can(legacy, ask(resource, action)),
          `${legacy} → ${current} on ${resource}:${action}`,
        ).toBe(can(current, ask(resource, action)));
      }
    }
  });

  it("treats an unrecognised role as read-only, never as a grant", () => {
    // A typo in the column has to cost access, not confer it.
    for (const value of ["superuser", "Administrator", "", "  ", "null", "lead"]) {
      expect(normaliseRole(value), value).toBe("auditor");
    }
    expect(normaliseRole(null)).toBe("auditor");
    expect(normaliseRole(undefined)).toBe("auditor");
  });

  it("does not resolve inherited object properties as roles", () => {
    // `roles` and the alias table are plain objects, so a lookup that used `in`
    // would answer true for `constructor` and `toString` and hand the caller
    // whatever sat at that key.
    for (const value of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(normaliseRole(value), value).toBe("auditor");
    }
  });

  it("is case- and whitespace-insensitive for the roles it knows", () => {
    expect(normaliseRole(" Governance_Lead ")).toBe("governance_lead");
    expect(normaliseRole("PLATFORM_ADMIN")).toBe("platform_admin");
    expect(normaliseRole(" Admin ")).toBe("governance_lead");
  });

  it("refuses everything for a missing role", () => {
    expect(can(null, { answer: ["update"] })).toBe(false);
    expect(can(undefined, { control: ["update"] })).toBe(false);
  });
});

describe("uiPermissions", () => {
  it("says what each role sees, and never leaks the role itself", () => {
    expect(uiPermissions("governance_lead")).toEqual({
      editLibrary: true,
      editSoa: true,
      answerControls: true,
      editRegisters: true,
      editInventory: true,
      registerSystems: true,
      deleteSystems: true,
      runAi: true,
      draftWithAi: true,
      useCopilot: true,
      autoMap: true,
      editPolicies: true,
      approvePolicies: true,
      approveSignOff: true,
      assignReviewers: true,
      verifyFindings: true,
      manageMembers: true,
      addMembers: false,
      viewTrash: false,
      editRoles: false,
      records: expect.any(Object),
    });

    expect(uiPermissions("system_owner")).toEqual({
      editLibrary: false,
      /* Evidences the framework, does not decide what is in scope. The one
       * line between this role and a governance lead. */
      editSoa: false,
      answerControls: true,
      editRegisters: true,
      editInventory: true,
      registerSystems: true,
      deleteSystems: true,
      runAi: true,
      draftWithAi: true,
      useCopilot: true,
      autoMap: false,
      // Writes policies, cannot approve one — the split the policy screens rest
      // on, asserted here so a widened role cannot pass unnoticed.
      editPolicies: true,
      approvePolicies: false,
      approveSignOff: false,
      assignReviewers: false,
      verifyFindings: false,
      manageMembers: false,
      addMembers: false,
      viewTrash: false,
      editRoles: false,
      records: expect.any(Object),
    });

    expect(uiPermissions("reviewer")).toEqual({
      // The inverse shape of a system owner, and the reason the UI needs the
      // flags rather than a rank: a reviewer sees an enabled Approve beside a
      // disabled Edit, which is exactly the affordance the role wants.
      editLibrary: false,
      editSoa: false,
      answerControls: false,
      editRegisters: false,
      editInventory: false,
      registerSystems: false,
      deleteSystems: false,
      runAi: false,
      draftWithAi: false,
      useCopilot: false,
      autoMap: false,
      editPolicies: false,
      approvePolicies: true,
      approveSignOff: true,
      assignReviewers: false,
      verifyFindings: true,
      manageMembers: false,
      addMembers: false,
      viewTrash: false,
      editRoles: false,
      records: expect.any(Object),
    });

    expect(uiPermissions("auditor")).toEqual({
      editLibrary: false,
      editSoa: false,
      answerControls: false,
      editRegisters: false,
      editInventory: false,
      registerSystems: false,
      deleteSystems: false,
      runAi: false,
      draftWithAi: false,
      useCopilot: false,
      autoMap: false,
      editPolicies: false,
      approvePolicies: false,
      approveSignOff: false,
      assignReviewers: false,
      verifyFindings: false,
      manageMembers: false,
      addMembers: false,
      viewTrash: false,
      editRoles: false,
      records: expect.any(Object),
    });
  });

  it("shows the trash to the platform admin and to nobody else", () => {
    /*
     * The requirement stated as a requirement, rather than left implicit in the
     * four full-shape assertions above — none of which is the platform admin.
     * The retention window destroys records on a schedule, and while that is
     * new the screen showing it is restricted to the one role that can act on
     * it. If this ever needs widening it should fail here first.
     */
    expect(uiPermissions("platform_admin").viewTrash).toBe(true);

    for (const role of ROLE_ORDER.filter((r) => r !== "platform_admin")) {
      expect(uiPermissions(role).viewTrash).toBe(false);
    }
    // An unrecognised role is not a way in either.
    expect(uiPermissions("nonsense").viewTrash).toBe(false);
    expect(uiPermissions(null).viewTrash).toBe(false);
  });

  it("lets the platform admin add a user, and nobody else", () => {
    /*
     * Stated as a requirement rather than left implicit above. Creating an
     * account is not the same act as inviting one: the credential exists, and
     * briefly the admin holds it. `member: ["create"]` cannot express that —
     * the governance lead holds it too — so this reads the one statement
     * `platform_admin` has alone. If it ever needs widening it should fail here
     * first.
     */
    expect(uiPermissions("platform_admin").addMembers).toBe(true);

    for (const role of ROLE_ORDER.filter((r) => r !== "platform_admin")) {
      expect(uiPermissions(role).addMembers).toBe(false);
    }
    expect(uiPermissions("nonsense").addMembers).toBe(false);
    expect(uiPermissions(null).addMembers).toBe(false);

    // A governance lead may invite and may change a role. It may not mint one.
    expect(uiPermissions("governance_lead").manageMembers).toBe(true);
    expect(uiPermissions("governance_lead").addMembers).toBe(false);
  });

  it("cannot be handed the power to create accounts by a matrix edit", () => {
    // Same reasoning as the trash: `role: ["update"]` is excluded from
    // EDITABLE_RESOURCES, so no grant a customer writes turns this on.
    const grants: OrgGrants = {
      governance_lead: { role: ["update"], member: ["create"] },
    };

    expect(uiPermissions("governance_lead", grants).addMembers).toBe(false);
  });

  it("cannot be handed the trash by a tenant editing its own matrix", () => {
    // Derived off `role: ["update"]`, which is excluded from EDITABLE_RESOURCES
    // — so there is no grant a customer can write that turns this on.
    const grants: OrgGrants = {
      auditor: { role: ["update"], system: ["delete"] },
    };

    expect(uiPermissions("auditor", grants).viewTrash).toBe(false);
  });

  it("agrees with `can` for every flag it exposes", () => {
    // The UI object exists so the client never re-derives the matrix. It is only
    // safe while it stays a projection of `can` rather than a second opinion.
    for (const role of [...ROLE_ORDER, "member", "contributor", "nonsense"]) {
      const ui = uiPermissions(role);
      expect(ui.editLibrary).toBe(can(role, { control: ["update"] }));
      expect(ui.answerControls).toBe(can(role, { answer: ["update"] }));
      expect(ui.editRegisters).toBe(can(role, { risk: ["update"] }));
      expect(ui.runAi).toBe(can(role, { ai: ["assess"] }));
      expect(ui.autoMap).toBe(can(role, { ai: ["map"] }));
      // The two flags whose statements a route actually checks. They exist so
      // the UI stops agreeing with the server by coincidence — assert them
      // against `can` for the same reason the others are here.
      expect(ui.draftWithAi).toBe(can(role, { ai: ["draft"] }));
      expect(ui.useCopilot).toBe(can(role, { ai: ["answer"] }));
      expect(ui.editInventory).toBe(can(role, { system: ["update"] }));
      expect(ui.registerSystems).toBe(can(role, { system: ["create"] }));
      expect(ui.deleteSystems).toBe(can(role, { system: ["delete"] }));
      /* The map is derived from the registry, so it is asserted the same way:
       * every kind, against the statement its resource actually names. */
      for (const kind of ROLE_KINDS) {
        const resource = RECORD_KINDS[kind].resource;
        expect(ui.records[kind].export, `${kind}.export`).toBe(
          can(role, { [resource]: ["export"] } as PermissionRequest),
        );
        expect(ui.records[kind].delete, `${kind}.delete`).toBe(
          can(role, { [resource]: ["delete"] } as PermissionRequest),
        );
        expect(ui.records[kind].create, `${kind}.create`).toBe(
          can(role, { [resource]: ["create"] } as PermissionRequest),
        );
        expect(ui.records[kind].update, `${kind}.update`).toBe(
          can(role, { [resource]: ["update"] } as PermissionRequest),
        );
      }
      /* Locked to the platform admin while the retention window is new, off a
       * statement no tenant may re-assign — so unlike its neighbours it is
       * asserted without grants, exactly as it is derived. */
      expect(ui.viewTrash).toBe(can(role, { role: ["update"] }));
      expect(ui.editPolicies).toBe(can(role, { policy: ["update"] }));
      expect(ui.approvePolicies).toBe(can(role, { policy: ["approve"] }));
      expect(ui.approveSignOff).toBe(can(role, { signoff: ["approve"] }));
      expect(ui.assignReviewers).toBe(can(role, { review: ["assign"] }));
      expect(ui.verifyFindings).toBe(can(role, { finding: ["verify"] }));
      expect(ui.manageMembers).toBe(can(role, { member: ["update"] }));
      /* Like `viewTrash`, off a statement no tenant may re-assign — so it is
       * asserted without grants, exactly as it is derived. */
      expect(ui.addMembers).toBe(can(role, { role: ["update"] }));
    }
  });
});

describe("privilege ordering", () => {
  it("gives every role on the authoring line at least what the one below it has", () => {
    // A role that can do something the role above it cannot is almost always a
    // mistake, and it is invisible without checking.
    //
    // **`reviewer` is deliberately not on this line.** It is incomparable with
    // `system_owner` by design — each holds something the other is refused — so
    // including it here would fail, and "fixing" that failure would mean giving
    // a reviewer the authoring permissions that make their approval meaningless.
    const ranks: RoleName[] = [
      "auditor",
      "system_owner",
      "governance_lead",
      "platform_admin",
    ];

    for (let i = 1; i < ranks.length; i++) {
      const lower = ranks[i - 1];
      const higher = ranks[i];
      const lost: string[] = [];

      for (const [resource, action] of EVERY_PERMISSION) {
        if (can(lower, ask(resource, action)) && !can(higher, ask(resource, action))) {
          lost.push(`${higher} lacks ${resource}:${action} which ${lower} has`);
        }
      }

      expect(lost).toEqual([]);
    }
  });

  it("keeps a reviewer strictly below a governance lead", () => {
    // The one ordering a reviewer does participate in. A governance lead is the
    // approver of record in a small function, so anything a reviewer can do they
    // must be able to do too — otherwise a two-person company cannot approve.
    for (const [resource, action] of EVERY_PERMISSION) {
      if (can("reviewer", ask(resource, action))) {
        expect(
          can("governance_lead", ask(resource, action)),
          `governance_lead lacks ${resource}:${action}`,
        ).toBe(true);
      }
    }
  });

  it("keeps a system owner and a reviewer genuinely incomparable", () => {
    // Asserted rather than assumed: if either side ever becomes a subset of the
    // other, the separation of duties has quietly collapsed into a ladder.
    const ownerOnly = EVERY_PERMISSION.filter(
      ([r, a]) => can("system_owner", ask(r, a)) && !can("reviewer", ask(r, a)),
    );
    const reviewerOnly = EVERY_PERMISSION.filter(
      ([r, a]) => can("reviewer", ask(r, a)) && !can("system_owner", ask(r, a)),
    );

    expect(ownerOnly.length).toBeGreaterThan(0);
    expect(reviewerOnly.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------- what a tenant may change */

/**
 * Editable roles, and the three reasons a cell stays locked.
 *
 * The matrix above is what the product ships. This is what happens when a
 * customer's process differs — and, more to the point, what happens when
 * somebody tries to use that to switch off the thing the product sells.
 */
describe("tenant role grants", () => {
  /**
   * The equivalence that makes the customised path safe.
   *
   * `can()` has two implementations: the compiled role's own `authorize()` for
   * an organization that has changed nothing, and a subset check over the
   * effective grants for one that has. If those two ever disagreed, a tenant
   * editing one resource would silently acquire different semantics on every
   * other one. So they are checked against each other across the whole
   * vocabulary rather than trusted to look similar.
   */
  it("evaluates a customised role exactly as the compiled one does", () => {
    for (const role of ROLE_ORDER) {
      if (role === FIXED_ROLE) continue;
      // Overriding a role with its own defaults must change nothing at all.
      const grants: OrgGrants = { [role]: defaultGrants(role) };

      for (const [resource, action] of EVERY_PERMISSION) {
        const request = { [resource]: [action] } as PermissionRequest;
        expect(can(role, request, grants)).toBe(can(role, request));
      }
    }
  });

  it("uses the shipped matrix when a tenant has changed nothing", () => {
    // Also the shape a failed read degrades to — an empty object, never a map
    // of empty roles, because the second locks everybody out of everything.
    expect(can("system_owner", { answer: ["update"] }, {})).toBe(true);
    expect(can("system_owner", { answer: ["update"] }, undefined)).toBe(true);
  });

  it("takes a permission away when the tenant removes it", () => {
    const grants: OrgGrants = {
      system_owner: { ...defaultGrants("system_owner"), risk: [] },
    };
    expect(can("system_owner", { risk: ["update"] }, grants)).toBe(false);
    // And leaves the rest of the role alone.
    expect(can("system_owner", { answer: ["update"] }, grants)).toBe(true);
  });

  it("gives a permission when the tenant adds one", () => {
    const grants: OrgGrants = {
      reviewer: { ...defaultGrants("reviewer"), answer: ["update"] },
    };
    expect(can("reviewer", { answer: ["update"] }, grants)).toBe(true);
  });

  it("never honours an override of membership, however the row arrives", () => {
    // The plugin polices these from the `ac` it got at import, so an override
    // would apply to our routes and not to Better Auth's endpoints. A row
    // written directly into the table must not be able to do it either.
    const grants: OrgGrants = {
      system_owner: {
        ...defaultGrants("system_owner"),
        member: ["create", "update", "delete"],
      },
    };
    expect(can("system_owner", { member: ["update"] }, grants)).toBe(false);
    expect(effectiveGrants("system_owner", grants).member ?? []).toEqual([]);
  });

  it("never honours an override of the platform admin", () => {
    // The role that runs the tenant, and the one holding the permission to edit
    // the others. An editable creator role is a ladder to everything.
    const grants: OrgGrants = { [FIXED_ROLE]: { control: [] } };
    expect(can(FIXED_ROLE, { control: ["update"] }, grants)).toBe(true);
    expect(can(FIXED_ROLE, { role: ["update"] }, grants)).toBe(true);
  });

  it("holds the editor's own statement, and only the platform admin holds it", () => {
    for (const role of ROLE_ORDER) {
      expect(can(role, { role: ["update"] })).toBe(role === FIXED_ROLE);
    }
  });

  it("keeps the editor's own statement out of the editable set", () => {
    // A permission that can widen who holds it is not a permission.
    expect(EDITABLE_RESOURCES).not.toContain("role");
    expect(EDITABLE_RESOURCES).not.toContain("member");
    expect(EDITABLE_RESOURCES).not.toContain("invitation");
    expect(EDITABLE_RESOURCES).not.toContain("organization");
    // …while the domain permissions are all in it.
    expect(EDITABLE_RESOURCES).toContain("risk");
    expect(EDITABLE_RESOURCES).toContain("signoff");
    expect(EDITABLE_RESOURCES).toContain("ai");
  });

  describe("refusedGrant", () => {
    it("allows an ordinary change", () => {
      expect(refusedGrant("reviewer", { answer: ["update"] })).toBeNull();
    });

    it("refuses editing the platform admin at all", () => {
      expect(refusedGrant(FIXED_ROLE, { control: [] })).toMatch(/cannot be edited/i);
    });

    it("refuses a resource the auth library owns", () => {
      expect(refusedGrant("reviewer", { member: ["update"] })).toMatch(
        /cannot be re-assigned/i,
      );
    });

    it("refuses an action the vocabulary does not define", () => {
      expect(refusedGrant("reviewer", { risk: ["obliterate"] })).toMatch(
        /not a permission this product defines/i,
      );
    });

    it("refuses every segregation-of-duties pair, with its reason", () => {
      // The rules that make the records defensible. A matrix that could switch
      // them off would let an organization configure away the product.
      for (const rule of FORBIDDEN_GRANTS) {
        const refusal = refusedGrant(rule.role, { [rule.resource]: [rule.action] });
        expect(refusal).toContain(rule.why);
      }
    });

    it("refuses a system owner who could endorse their own assessment", () => {
      // Named explicitly as well as covered by the loop above, because this is
      // the one the whole management system leans on.
      expect(refusedGrant("system_owner", { signoff: ["approve"] })).toMatch(
        /second pair of eyes/i,
      );
    });
  });
});
