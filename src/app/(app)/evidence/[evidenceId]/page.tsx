import { notFound } from "next/navigation";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { EvidenceRecord } from "../../_ams/evidence-record";

/** One document, and everything resting on it. */
export const dynamic = "force-dynamic";

export default async function EvidenceRecordPage({
  params,
}: {
  params: Promise<{ evidenceId: string }>;
}) {
  const { evidenceId } = await params;
  const { data, ws, permissions } = await amsPage({ activitySubjectId: evidenceId });
  const evidence = ws.evidenceById(evidenceId);
  if (!evidence) notFound();

  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <EvidenceRecord evidence={evidence} />
    </WorkspaceProvider>
  );
}
