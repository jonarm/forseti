import { Suspense } from "react";
import { notFound } from "next/navigation";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { SoaWorkbench } from "../../_ams/soa-workbench";

/**
 * A framework and its Statement of Applicability.
 *
 * The segment is the framework id, so a second standard is data rather than a
 * new route. `readWorkspace` resolves it against the organisation's own
 * frameworks; an id it does not have is a 404 rather than an empty shell,
 * because an empty framework page invites the reader to assume it is loading.
 */
export const dynamic = "force-dynamic";

export default async function FrameworkPage({
  params,
}: {
  params: Promise<{ frameworkId: string }>;
}) {
  const { frameworkId } = await params;
  const { data, ws, permissions } = await amsPage({ frameworkId });
  if (ws.framework?.id !== frameworkId) notFound();

  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      {/* The workbench reads its clause and lens filters from the URL. */}
      <Suspense fallback={null}>
        <SoaWorkbench />
      </Suspense>
    </WorkspaceProvider>
  );
}
