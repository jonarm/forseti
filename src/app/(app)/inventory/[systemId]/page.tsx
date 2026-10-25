import { notFound } from "next/navigation";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { SystemProfile } from "../../_ams/system-profile";

/**
 * Screen 2 — the AI system profile.
 *
 * The page resolves the record and nothing else; the nine tabs and everything
 * they read live in `SystemProfile`, which takes the workspace from context
 * rather than receiving eleven arrays as props.
 *
 * There used to be a third outcome here: an id minted by the register form or
 * the import dialog resolved to a page explaining that the row existed only in
 * the inventory's client state. Both of those write to the database now, so
 * every id the inventory can link to is one this page can read. An id that is
 * not found is genuinely not found.
 */
export const dynamic = "force-dynamic";

export default async function SystemProfilePage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = await params;
  const { data, ws, permissions } = await amsPage({ activitySubjectId: systemId });
  const system = ws.systemById(systemId);

  if (!system) notFound();

  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <SystemProfile system={system} />
    </WorkspaceProvider>
  );
}
