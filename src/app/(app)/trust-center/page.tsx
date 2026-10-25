import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { TrustCenter } from "../_ams/trust-center";

/**
 * The trust centre - one page, two audiences.
 *
 * Internal by default, with the customer view a switch away and the difference
 * between them stated rather than silently applied.
 */
export const dynamic = "force-dynamic";

export default async function TrustCenterPage() {
  const { data, permissions } = await amsPage();
  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <TrustCenter />
    </WorkspaceProvider>
  );
}
