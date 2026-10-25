import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { readReviewAssignments } from "@/lib/ai-store";
import { auth } from "@/lib/auth";
import { ROLE_LABEL, normaliseRole } from "@/lib/permissions";
import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { AssessmentRenderer } from "../../_ams/assessment-renderer";
import { ReviewerPanel, type AssignableMember } from "../../_ams/reviewer-panel";

/**
 * One impact assessment.
 *
 * The page resolves the instance from this organisation's own records; the form
 * is rendered from `IMPACT_TEMPLATE`, which the renderer walks without knowing a
 * single question.
 */
export const dynamic = "force-dynamic";

export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  const { organizationId, data, ws, permissions } = await amsPage({
    activitySubjectId: assessmentId,
  });
  const assessment = ws.assessmentById(assessmentId);
  if (!assessment) notFound();

  const assignments = await readReviewAssignments(organizationId, {
    kind: "assessment",
    id: assessmentId,
  });

  /*
   * The picker's options are **accounts**, not `ai_person` records, because an
   * assignment names somebody who has to sign in and act. Read here rather than
   * through `readWorkspace()` for the same reason: membership belongs to Better
   * Auth, and copying it into the workspace would give two answers to who is in
   * this organisation.
   *
   * A failure costs the picker its options, never the page — same contract as
   * every store read.
   */
  let members: AssignableMember[] = [];
  try {
    const result = await auth.api.listMembers({
      headers: await headers(),
      query: { organizationId },
    });
    members = (result?.members ?? []).map(
      (m: {
        userId: string;
        role: string;
        user?: { name?: string | null; email?: string | null };
      }) => ({
        userId: m.userId,
        label: m.user?.name || m.user?.email || m.userId,
        roleLabel: ROLE_LABEL[normaliseRole(m.role)],
      }),
    );
  } catch (err) {
    console.error("[assessment] member list failed", err);
  }

  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <AssessmentRenderer assessment={assessment} />
      <div className="px-8 pb-8">
        <ReviewerPanel
          subjectKind="assessment"
          subjectId={assessmentId}
          members={members}
          assignments={assignments}
        />
      </div>
    </WorkspaceProvider>
  );
}
