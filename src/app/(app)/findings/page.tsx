import { Suspense } from "react";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { FindingRegister } from "../_ams/finding-register";

/** Findings, and where each one came from. */
export const dynamic = "force-dynamic";

export default async function FindingsPage() {
  const { data, permissions } = await amsPage();
  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <Suspense fallback={null}>
        <FindingRegister />
      </Suspense>
    </WorkspaceProvider>
  );
}
