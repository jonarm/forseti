/** Exercise the real reference installer against a disposable in-memory database. */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test/pglite";
import { aiControl, aiFramework, aiFrameworkNode, aiSystem, aiPerson, aiPolicy, aiEvidence, aiApplicability, organization, user } from "@/db/schema";
import { ISO_42001_CONTROLS, ISO_42001_NODES } from "./ams/fixtures/framework-iso-42001";

let testDb: TestDb;
let close: () => Promise<void>;
vi.mock("@/db", () => ({ get db() { return testDb; } }));
const { initializeReferenceFramework } = await import("./reference-init");

beforeAll(async () => { ({ db: testDb, close } = await createTestDb()); });
afterAll(async () => close());
beforeEach(async () => {
  await testDb.delete(organization);
  await testDb.insert(organization).values([
    { id: "org-a", slug: "alpha", name: "Alpha", createdAt: new Date() },
    { id: "org-b", slug: "beta", name: "Beta", createdAt: new Date() },
  ]);
});

it("adds only reference definitions to the explicitly selected organization", async () => {
  expect(await initializeReferenceFramework("alpha")).toEqual({
    frameworksAdded: 1, nodesAdded: ISO_42001_NODES.length, controlsAdded: ISO_42001_CONTROLS.length,
  });
  expect(await testDb.select().from(aiFrameworkNode)).toHaveLength(ISO_42001_NODES.length);
  const controls = await testDb.select().from(aiControl);
  expect(controls).toHaveLength(ISO_42001_CONTROLS.length);
  expect(controls.every((c) => c.organizationId === "org-a")).toBe(true);
  expect(await testDb.select().from(aiFramework).where(eq(aiFramework.organizationId, "org-b")))
    .toEqual([]);
  for (const table of [aiSystem, aiPerson, aiPolicy, aiEvidence, aiApplicability, user]) {
    expect(await testDb.select().from(table)).toEqual([]);
  }
});

it("is repeatable and preserves existing reference edits", async () => {
  await initializeReferenceFramework("alpha");
  await testDb.update(aiControl).set({ shortTitle: "Operator's edited title" })
    .where(eq(aiControl.id, ISO_42001_CONTROLS[0].id));
  expect(await initializeReferenceFramework("alpha"))
    .toEqual({ frameworksAdded: 0, nodesAdded: 0, controlsAdded: 0 });
  const [control] = await testDb.select().from(aiControl)
    .where(eq(aiControl.id, ISO_42001_CONTROLS[0].id));
  expect(control.shortTitle).toBe("Operator's edited title");
});

it.each(["missing", ""])("refuses an absent organization without inserting anything", async (slug) => {
  await expect(initializeReferenceFramework(slug)).rejects.toThrow();
  expect(await testDb.select().from(aiFramework)).toEqual([]);
});
