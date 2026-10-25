import { redirect } from "next/navigation";

import { DemoBanner } from "@/components/demo-banner";
import { Sidebar } from "@/components/sidebar";
import { ROLE_LABEL, normaliseRole } from "@/lib/permissions";
import {
  NoActiveOrganizationError,
  UnauthenticatedError,
  getSession,
  requireOrgContext,
} from "@/lib/session";

/**
 * The signed-in shell.
 *
 * This is also the first real gate: `src/proxy.ts` only checks that a session
 * cookie exists, so an unauthenticated request that gets past it lands here and
 * is turned away before any page renders. Individual pages still resolve their
 * own context — a layout does not guarantee a child ran after it — but this
 * catches the common case early and routes the two failure modes differently.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let roleLabel = "";
  try {
    const { role } = await requireOrgContext();
    /* Resolved here, as a label, because the sidebar is a client component and
     * the role must not cross that boundary — see the prop's comment. */
    roleLabel = ROLE_LABEL[normaliseRole(role)];
  } catch (err) {
    if (err instanceof UnauthenticatedError) redirect("/sign-in");
    // Signed in but no organization yet — that is onboarding, not an error.
    if (err instanceof NoActiveOrganizationError) redirect("/onboarding");
    throw err;
  }

  // The identity for the account menu. Read here rather than in the client so
  // the name, the email and the role are one consistent answer.
  const session = await getSession();

  return (
    <>
      <DemoBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          userName={session?.user?.name ?? null}
          userEmail={session?.user?.email ?? null}
          roleLabel={roleLabel}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </>
  );
}
