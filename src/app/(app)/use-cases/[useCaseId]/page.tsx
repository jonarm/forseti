import { notFound } from "next/navigation";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { UseCaseRecord } from "../../_ams/use-case-record";

/**
 * A use case, on its own page.
 *
 * This route exists to make decision 1 undeniable. If a use case were only a
 * card on the system profile it would read as a description of the system —
 * something you list, like a feature. Giving it a URL, its own risk tier, its
 * own oversight and its own assessment makes it the object it actually is: the
 * level at which risk is real and the level a regulator asks about.
 *
 * The route is flat rather than nested under the system because the risk
 * register links to use cases directly, and nesting would force a system id
 * into every one of those links for no gain.
 *
 * The record itself is a client component because it is an editor — a use case
 * is written down early and understood later, and the corrections have to land
 * on the register rather than in a conversation. See `use-case-record.tsx`.
 */
export const dynamic = "force-dynamic";

export default async function UseCasePage({
  params,
}: {
  params: Promise<{ useCaseId: string }>;
}) {
  const { useCaseId } = await params;
  const { data, ws, permissions } = await amsPage({ activitySubjectId: useCaseId });
  const useCase = ws.getUseCase(useCaseId);
  if (!useCase) notFound();

  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <UseCaseRecord useCase={useCase} />
    </WorkspaceProvider>
  );
}
