import Link from "next/link";
import { redirect } from "next/navigation";

import { requireOrgContext } from "@/lib/session";
import { readFrameworks } from "@/lib/ai-store";
import { EmptyState } from "../_ams/empty-state";

/**
 * The frameworks hub, which usually does not render.
 *
 * It exists so that "Frameworks" is one entry in the sidebar rather than one
 * per standard: this resolves whichever the organisation has in scope and hands
 * off to it. Adding a second standard then costs a row of data and nothing else.
 *
 * A redirect rather than a list because with one framework a list is a page
 * whose only purpose is to be clicked through. When there are several this
 * becomes the chooser, and the sidebar entry does not change.
 */
export const dynamic = "force-dynamic";

export default async function FrameworksPage() {
  const { organizationId } = await requireOrgContext();
  const frameworks = await readFrameworks(organizationId);

  if (frameworks.length > 0) redirect(`/frameworks/${frameworks[0].id}`);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Frameworks</h1>
      </header>
      <EmptyState
        title="No standard is in scope yet"
        body="A framework is what a Statement of Applicability is written against, and what readiness is measured in. Until one is in scope there is nothing to be applicable to."
        action={
          <Link href="/inventory" className="text-sm text-primary hover:underline">
            Start with the AI inventory
          </Link>
        }
      />
    </div>
  );
}
