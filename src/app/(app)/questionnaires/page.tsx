import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { QuestionnaireRegister } from "../_ams/questionnaire-register";

/** Inbound questionnaires. */
export const dynamic = "force-dynamic";

export default async function QuestionnairesPage() {
  const { data, permissions } = await amsPage();
  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <QuestionnaireRegister />
    </WorkspaceProvider>
  );
}
