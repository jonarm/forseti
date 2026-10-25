import { notFound } from "next/navigation";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { FindingRecord } from "../../_ams/finding-record";

export const dynamic = "force-dynamic";

export default async function FindingPage({
  params,
}: {
  params: Promise<{ findingId: string }>;
}) {
  const { findingId } = await params;
  const { data, ws, permissions } = await amsPage({ activitySubjectId: findingId });
  const finding = ws.findingById(findingId);
  if (!finding) notFound();

  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <FindingRecord finding={finding} />
    </WorkspaceProvider>
  );
}
