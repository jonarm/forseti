import { requireOrgContext } from "./session";
import { readWorkspace, type WorkspaceScope } from "./ai-store";
import { workspace, type Workspace, type WorkspaceData } from "./ams/workspace";
import { uiPermissions, type UiPermissions } from "./permissions";

/**
 * What every AI management system page does before it renders anything.
 *
 * Three steps that must not be skipped or reordered, which is why they are one
 * call rather than three lines copied into fourteen pages:
 *
 *  1. **Resolve the tenant.** `src/proxy.ts` only checks that a session cookie
 *     exists; every page re-checks here, and this is that check.
 *  2. **Read that tenant's workspace**, and nobody else's — `organizationId`
 *     comes from the session and is never accepted from the request.
 *  3. **Return the three halves.** `data` is plain arrays for `WorkspaceProvider`
 *     to hand to the client subtree; `ws` is the same data with its lookups, for
 *     whatever the page derives on the server; `permissions` is what this caller
 *     may do, as booleans.
 *
 * **`permissions` is `uiPermissions()`, never the role.** A client handed a role
 * has to re-derive what it means, and then there are two matrices that can
 * disagree — offering something the route refuses, or hiding something it would
 * allow. Resolving it here rather than per page is what stops a screen inventing
 * its own answer, and it is why `WorkspaceProvider` requires it: a page that
 * forgets is a compile error rather than a screen that quietly offers
 * everything to everyone.
 *
 * Pages that carry this must also `export const dynamic = "force-dynamic"`. A
 * session-dependent page served from the cache is one tenant's registers shown
 * to another, and it fails silently — the build is clean and the page is fast.
 */
export async function amsPage(scope: WorkspaceScope = {}): Promise<{
  organizationId: string;
  data: WorkspaceData;
  ws: Workspace;
  permissions: UiPermissions;
}> {
  const { organizationId, role, grants } = await requireOrgContext();
  const data = await readWorkspace(organizationId, scope);
  return {
    organizationId,
    data,
    ws: workspace(data),
    /* The tenant's own matrix, not just the shipped one. A page resolving
     * permissions without it would offer an affordance the route then refuses,
     * or hide one it would allow — the two-matrices failure this helper exists
     * to prevent, one layer further in. */
    permissions: uiPermissions(role, grants),
  };
}
