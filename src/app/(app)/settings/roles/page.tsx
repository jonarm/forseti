import { PageHeader } from "@/components/page-header";
import { AccessHistory } from "@/components/access-history";
import { RoleMatrix, type RoleMatrixRow } from "@/components/role-matrix";
import { Card, CardContent } from "@/components/ui/card";
import { readActivityByKind } from "@/lib/ai-store";
import {
  EDITABLE_RESOURCES,
  FORBIDDEN_GRANTS,
  ROLE_ORDER,
  effectiveGrants,
  statement,
  uiPermissions,
} from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * What each role may do, and what this organization has changed about it.
 *
 * The matrix existed in full in exactly one place — `permissions.test.ts` — so
 * an administrator choosing between "reviewer" and "system owner" had a
 * one-sentence blurb and no way to see the difference. This screen is the grid,
 * and for most organizations that is all it will ever be: the shipped roles are
 * a governance function's org chart and are meant to fit without editing.
 *
 * Where a customer's process genuinely differs, the editable cells are the
 * domain permissions — the control library, the registers, the AI actions. What
 * is *not* editable is on screen and explained rather than absent, because a
 * missing switch reads as a bug and sends somebody looking for it:
 * `platform_admin` because it runs the tenant and holds the permission to edit
 * the others; membership and invitations because Better Auth enforces those from
 * a definition fixed at startup; and the segregation-of-duties pairs because
 * they are what makes the records defensible.
 *
 * Read on the server and handed down as booleans and grants, never as the
 * caller's role — the same rule every other screen follows.
 */
export default async function RolesPage() {
  const { organizationId, role, grants } = await requireOrgContext();
  const permissions = uiPermissions(role, grants);

  const rows: RoleMatrixRow[] = ROLE_ORDER.map((name) => ({
    role: name,
    grants: effectiveGrants(name, grants),
    customised: Boolean(grants[name]),
  }));

  /* Every resource in the vocabulary, editable ones first — the cells somebody
   * came here to change should not be below a fold of ones they cannot. */
  const resources = Object.entries(statement)
    .map(([resource, actions]) => ({
      resource,
      actions: [...(actions as readonly string[])],
    }))
    .sort((a, b) => {
      const editable = (r: string) => (EDITABLE_RESOURCES.includes(r) ? 0 : 1);
      return editable(a.resource) - editable(b.resource) ||
        a.resource.localeCompare(b.resource);
    });

  /* Role changes and matrix edits share the `organization` and `member` kinds,
   * and belong on one list: "who may do what here" is one question. Degrades to
   * empty like every other read. */
  const history = await readActivityByKind(organizationId, "organization", 50);

  return (
    <>
      <PageHeader
        title="Roles"
        description="What each role may do here — and, where your process differs from ours, what to change about it."
      />

      <div className="space-y-4 px-8 py-6">
        <Card>
          <CardContent className="py-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
            The five roles are a governance function&rsquo;s org chart rather than
            a privilege ladder. A <span className="text-foreground">reviewer</span>{" "}
            deliberately holds <em>fewer</em> permissions than an{" "}
            <span className="text-foreground">AI system owner</span>, and one the
            owner must never hold — the whole value of an approval is that the
            author could not grant it to themselves. Cells that stay locked are
            the places that rule is enforced; hover one for the reason.
          </CardContent>
        </Card>

        <RoleMatrix
          rows={rows}
          resources={resources}
          editableResources={[...EDITABLE_RESOURCES]}
          forbidden={FORBIDDEN_GRANTS}
          canEdit={permissions.editRoles}
        />

        <AccessHistory events={history} names={new Map()} />
      </div>
    </>
  );
}
