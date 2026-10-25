"use client";

/**
 * The workspace, made available to the client half of a screen.
 *
 * Most of this product's interactive surfaces — the SoA workbench, the risk
 * record, the inventory table — are client components several levels below the
 * page, and each needs to walk between registers. Threading eighteen arrays
 * through as props would put the plumbing in every signature between here and
 * there, and the first component someone forgets to update is the one that
 * quietly keeps its fixture import.
 *
 * So the page provides once and the leaves read. What crosses the boundary is
 * `WorkspaceData` — plain arrays; the lookups are rebuilt on this side, because
 * a closure cannot be serialised and there is no reason to try.
 *
 * `useWorkspace` throws when there is no provider. That is deliberate: the
 * alternative is a component silently rendering an empty register and looking
 * like an organisation with no risks.
 *
 * **Permissions ride along, behind their own hook.** They arrive from the same
 * `amsPage()` call and are provided once for the same reason the workspace is —
 * the affordance that needs to know is several levels below the page. They get a
 * separate context and a separate hook rather than becoming a field on
 * `Workspace`, because they are a fact about the *caller* and everything else
 * here is a fact about the *organisation*: a derived function that took
 * permissions alongside the registers would eventually use one to compute the
 * other, and a readiness figure that changes with who is looking at it is a
 * different product.
 *
 * What crosses is `UiPermissions` — plain booleans, never the role. See
 * `permissions.ts` for why the client is never told which role it holds.
 */
import { createContext, useContext, useMemo } from "react";

import type { UiPermissions } from "@/lib/permissions";
import { workspace, type Workspace, type WorkspaceData } from "./workspace";

const WorkspaceContext = createContext<Workspace | null>(null);
const PermissionsContext = createContext<UiPermissions | null>(null);

export function WorkspaceProvider({
  data,
  permissions,
  children,
}: {
  data: WorkspaceData;
  permissions: UiPermissions;
  children: React.ReactNode;
}) {
  const value = useMemo(() => workspace(data), [data]);
  return (
    <WorkspaceContext.Provider value={value}>
      <PermissionsContext.Provider value={permissions}>
        {children}
      </PermissionsContext.Provider>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): Workspace {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  }
  return value;
}

/**
 * What this caller may do.
 *
 * Throws without a provider for the same reason `useWorkspace` does, and it
 * matters more here: the safe-looking fallback is an object of `false`, which
 * renders every action disabled and reads exactly like a permission problem.
 * Somebody would spend an afternoon on it.
 */
export function usePermissions(): UiPermissions {
  const value = useContext(PermissionsContext);
  if (!value) {
    throw new Error("usePermissions must be used inside a WorkspaceProvider");
  }
  return value;
}
