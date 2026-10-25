import { headers } from "next/headers";

import { AccessHistory } from "@/components/access-history";
import { MembersTable, type MemberRow } from "@/components/members-table";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { readAccountPeople, readActivityByKind, readPeople } from "@/lib/ai-store";
import { normaliseRole, uiPermissions } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Who is in this organization, and what they may do.
 *
 * Roles existed in the database long before anything read them, and there was no
 * way to change one without calling Better Auth's endpoints by hand. That made
 * "admin-only" mean "owner-only" in practice: the person who created the
 * organization was the only admin and had no way to make another.
 *
 * The list is read on the server rather than fetched by the client, so an
 * unprivileged visitor never receives the membership list at all — hiding a
 * table the browser has already been sent is not a boundary.
 */
export default async function MembersPage() {
  const { organizationId, userId, role, grants } = await requireOrgContext();
  // The tenant's own matrix, like every other screen — a page that resolved
  // permissions from the shipped one would disagree with the routes it calls.
  const permissions = uiPermissions(role, grants);

  let members: MemberRow[] = [];
  let failed = false;

  try {
    const result = await auth.api.listMembers({
      headers: await headers(),
      query: { organizationId },
    });

    members = (result?.members ?? []).map(
      (m: {
        id: string;
        userId: string;
        role: string;
        user?: { name?: string | null; email?: string | null };
      }) => ({
        id: m.id,
        userId: m.userId,
        role: normaliseRole(m.role),
        name: m.user?.name ?? null,
        email: m.user?.email ?? null,
        isYou: m.userId === userId,
      }),
    );
  } catch (err) {
    // Same contract as `readData`: a page must not 500 because a list failed.
    console.error("[members]", err);
    failed = true;
  }

  /*
   * The trail behind the list. Read by kind, which is the query `subject_kind`
   * and its index exist for — without them this would mean pattern-matching id
   * prefixes, which is a guess dressed up as a query.
   *
   * Degrades to an empty list like every other read: losing the history costs a
   * panel, and must never cost the page somebody came here to use.
   */
  const history = await readActivityByKind(organizationId, "member", 50);

  /*
   * The two halves of "acts as": everyone the registers can name, and the links
   * that already exist. Both degrade to empty, which is also what a brand new
   * organization genuinely has — the column then offers nothing but "Not
   * matched", which is the truth rather than a broken picker.
   */
  const [people, accountPeople] = await Promise.all([
    readPeople(organizationId),
    readAccountPeople(organizationId),
  ]);

  /* Names for whoever is still here. Anyone who has left resolves to their id,
   * which is correct — the record outlives the membership it describes. */
  const names = new Map<string, string>();
  for (const m of members) {
    const label = m.name || m.email;
    if (label) {
      names.set(m.userId, label);
      if (m.email) names.set(m.email, label);
    }
  }

  return (
    <>
      <PageHeader
        title="Members"
        description="Who can see this organization, and what each of them can change."
        actions={
          <span className="font-mono text-xs text-muted-foreground">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        }
      />

      <div className="space-y-4 px-8 py-6">
        {failed ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Could not load the member list. Refresh to try again.
            </CardContent>
          </Card>
        ) : (
          <MembersTable
            members={members}
            people={people}
            accountPeople={accountPeople}
            canManage={permissions.manageMembers}
            /* Narrower than `manageMembers` on purpose — minting a credential is
             * the platform admin's, and `permissions.ts` says why. */
            canAdd={permissions.addMembers}
            organizationId={organizationId}
          />
        )}

        <AccessHistory events={history} names={names} />
      </div>
    </>
  );
}
