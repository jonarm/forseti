import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { RequestReview } from "../../_ams/request-review";

/**
 * One request, triaged and decided.
 *
 * The id is resolved inside the component against the client store as well as
 * the workspace, because a request submitted during this session exists only in
 * that store. It says so plainly rather than throwing a 404 at somebody who has
 * just pressed submit.
 */
export const dynamic = "force-dynamic";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  const { data, permissions } = await amsPage({
    activitySubjectId: requestId,
    /* Scoped to this request. The queue renders a dozen of these and wants none
     * of their notes, so they are not part of the register read. */
    intakeNotesFor: requestId,
  });
  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <RequestReview requestId={requestId} />
    </WorkspaceProvider>
  );
}
