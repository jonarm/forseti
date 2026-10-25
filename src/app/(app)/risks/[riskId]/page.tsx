import { notFound } from "next/navigation";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { RiskRecord } from "../../_ams/risk-record";

export const dynamic = "force-dynamic";

export default async function RiskPage({
  params,
}: {
  params: Promise<{ riskId: string }>;
}) {
  const { riskId } = await params;
  const { data, ws, permissions } = await amsPage({ activitySubjectId: riskId });
  const risk = ws.risks.find((r) => r.id === riskId);
  if (!risk) notFound();

  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <RiskRecord risk={risk} />
    </WorkspaceProvider>
  );
}
