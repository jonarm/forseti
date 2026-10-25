import { Suspense } from "react";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { EvidenceRegister } from "../_ams/evidence-register";

/**
 * The evidence register.
 *
 * Three screens point here: the SoA's evidence list, the system profile's
 * Evidence tab and the dashboard's evidence panel.
 */
export const dynamic = "force-dynamic";

export default async function EvidencePage() {
  const { data, permissions } = await amsPage();
  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      {/* Filters seed from the URL so the dashboard can link a named view. */}
      <Suspense fallback={null}>
        <EvidenceRegister />
      </Suspense>
    </WorkspaceProvider>
  );
}
