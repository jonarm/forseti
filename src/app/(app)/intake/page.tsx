import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { RequestQueue } from "../_ams/request-queue";

/**
 * The governance lead's queue.
 *
 * The home screen for the person who lives in this product: what has come in,
 * what is waiting on them, and how long it has been waiting.
 */
export const dynamic = "force-dynamic";

export default async function IntakeQueuePage() {
  const { data, permissions } = await amsPage();
  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <RequestQueue />
    </WorkspaceProvider>
  );
}
