import { redirect } from "next/navigation";

import { CreateOrganization } from "@/components/create-organization";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Onboarding: signed in, but no organization yet.
 *
 * Lives under `(auth)` rather than `(app)` because the app shell requires an
 * active organization — routing it through there would loop back to here.
 */
export default async function OnboardingPage() {
  const session = await getSession();

  if (!session) redirect("/sign-in");
  // Already has a tenant selected — nothing to onboard.
  if (session.session.activeOrganizationId) redirect("/overview");

  return <CreateOrganization />;
}
