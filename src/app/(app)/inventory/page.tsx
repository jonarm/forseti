import { Suspense } from "react";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { InventoryTable } from "../_ams/inventory-table";

/**
 * The AI inventory.
 *
 * The page resolves the tenant and hands its own systems to the table.
 * Everything interactive - search, the four filters, sorting, both dialogs -
 * stays client state inside `InventoryTable`.
 */
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const { data, ws, permissions } = await amsPage();

  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      {/* The table seeds its filters from the URL, which needs a boundary. */}
      <Suspense fallback={null}>
        <InventoryTable initialSystems={ws.systems} />
      </Suspense>
    </WorkspaceProvider>
  );
}
