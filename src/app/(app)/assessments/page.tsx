import { Suspense } from "react";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { AssessmentRegister } from "../_ams/assessment-register";

/** The assessment register - five records, not one sample. */
export const dynamic = "force-dynamic";

export default async function AssessmentsPage() {
  const { data, permissions } = await amsPage();
  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <Suspense fallback={null}>
        <AssessmentRegister />
      </Suspense>
    </WorkspaceProvider>
  );
}
