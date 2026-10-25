import { notFound } from "next/navigation";

import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { QuestionnaireWorkbench } from "../../_ams/questionnaire-workbench";

export const dynamic = "force-dynamic";

export default async function QuestionnairePage({
  params,
}: {
  params: Promise<{ questionnaireId: string }>;
}) {
  const { questionnaireId } = await params;
  const { data, ws, permissions } = await amsPage();
  const questionnaire = ws.questionnaireById(questionnaireId);
  if (!questionnaire) notFound();

  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <QuestionnaireWorkbench questionnaire={questionnaire} />
    </WorkspaceProvider>
  );
}
