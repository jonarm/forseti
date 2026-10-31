/** Install reference definitions into one existing tenant without demo records. */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiControl, aiFramework, aiFrameworkNode, organization } from "@/db/schema";
import { ISO_42001, ISO_42001_CONTROLS, ISO_42001_NODES } from "./ams/fixtures/framework-iso-42001";

export async function initializeReferenceFramework(organizationSlug: string) {
  if (!organizationSlug.trim()) throw new Error("An existing organization slug is required.");
  const [tenant] = await db.select({ id: organization.id }).from(organization)
    .where(eq(organization.slug, organizationSlug));
  if (!tenant) throw new Error("The requested organization does not exist.");

  // Neon HTTP has no interactive transactions. Insert-only, idempotent steps
  // make a partial initialization safe to rerun without overwriting edits.
  const frameworks = await db.insert(aiFramework).values({
    ...ISO_42001, organizationId: tenant.id, enabled: true,
  }).onConflictDoNothing({ target: [aiFramework.organizationId, aiFramework.id] })
    .returning();

  const nodes = await db.insert(aiFrameworkNode).values(ISO_42001_NODES.map((node, position) => ({
    ...node, organizationId: tenant.id, position,
  }))).onConflictDoNothing({ target: [aiFrameworkNode.organizationId, aiFrameworkNode.id] })
    .returning();

  const controls = await db.insert(aiControl).values(ISO_42001_CONTROLS.map((control, position) => ({
    ...control, organizationId: tenant.id, position,
  }))).onConflictDoNothing({ target: [aiControl.organizationId, aiControl.id] })
    .returning();

  return { frameworksAdded: frameworks.length, nodesAdded: nodes.length, controlsAdded: controls.length };
}
