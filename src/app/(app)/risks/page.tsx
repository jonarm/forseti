import { Suspense } from "react";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { RiskRegister } from "../_ams/risk-register";

/** The risk register, ordered by what we are still carrying. */
export const dynamic = "force-dynamic";

export default async function RisksPage() {
  const { data, permissions } = await amsPage();
  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <Suspense fallback={null}>
        <RiskRegister />
      </Suspense>
    </WorkspaceProvider>
  );
}
