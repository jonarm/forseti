import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { UseCaseRegister } from "../_ams/use-case-register";

/**
 * The use case register, beside the inventory rather than inside it.
 *
 * `/inventory` answers what we run; this answers what it is being used for, and
 * the second question is the one with the risk in it. Reading no search params,
 * so no `Suspense` boundary — the filters here are local state, and a use case
 * is arrived at from a link rather than from a saved lens.
 */
export const dynamic = "force-dynamic";

export default async function UseCasesPage() {
  const { data, permissions } = await amsPage();
  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <UseCaseRegister />
    </WorkspaceProvider>
  );
}
