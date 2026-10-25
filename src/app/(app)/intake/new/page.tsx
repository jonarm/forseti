import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { IntakeWizard } from "../../_ams/intake-wizard";

/** The requester's form. */
export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  const { data, permissions } = await amsPage();
  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <IntakeWizard />
    </WorkspaceProvider>
  );
}
