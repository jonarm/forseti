import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { AuditPack } from "../_ams/audit-pack";

/**
 * The audit evidence pack.
 *
 * The screen that proves the registers connect: assembled from all of them,
 * with a pre-flight list read from the same records rather than declared here.
 */
export const dynamic = "force-dynamic";

export default async function AuditPackPage() {
  const { data, permissions } = await amsPage();
  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <AuditPack />
    </WorkspaceProvider>
  );
}
