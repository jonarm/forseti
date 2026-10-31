import { randomUUID } from "node:crypto";

import { demoSeedPassword } from "../src/lib/demo-seed-config";

import { and, eq } from "drizzle-orm";

import { db } from "../src/db";
import { member, organization, user } from "../src/db/schema";
import { auth } from "../src/lib/auth";
import { seedAiManagementSystem } from "../src/lib/ai-seed";
import { linkAccountToPerson } from "../src/lib/ai-store";
import { SYSTEM_ACTOR } from "../src/lib/audit";
import { ROLE_LABEL, ROLE_ORDER, type RoleName } from "../src/lib/permissions";

/**
 * Seed the demo organization.
 *
 * Auto-seeding on read stopped making sense once data became tenant-scoped —
 * there is no "the" organization to seed into any more, and a page render is
 * the wrong place to be creating users. This is an explicit `npm run seed`
 * instead.
 *
 * The user is created through Better Auth's own API rather than by inserting
 * rows, so password hashing, id generation and the account record all match
 * what a real sign-up produces. A hand-inserted user would look right in the
 * database and then fail to sign in.
 *
 * Idempotent: re-running replaces the demo org's records without duplicating
 * the user or the organization.
 *
 * **One account per role, because a permission model you cannot sign into is a
 * permission model nobody checks.** The matrix is asserted in `permissions.test.ts`
 * and the flags reach the screens through `usePermissions()`, and neither of
 * those shows you what a reviewer actually sees. Until these existed the only
 * way in was as a platform admin, which is the one role for which every
 * affordance is enabled — so every screen looked correct by construction.
 */

const ORG_NAME = "Meridian Analytics";
const ORG_SLUG = "meridian-analytics";

// Explicit operator consent and a private password are required before main().
const DEMO_PASSWORD = demoSeedPassword({
  ALLOW_DEMO_SEED: process.env.ALLOW_DEMO_SEED,
  DEMO_PASSWORD: process.env.DEMO_PASSWORD,
});

/**
 * A sign-in for each of the five roles.
 *
 * Names and job titles echo `fixtures/people.ts` so the demo reads as one
 * organisation rather than as a test harness bolted to a mockup — signing in as
 * the reviewer and finding "A. Boateng, Head of Talent Acquisition" already
 * named on the records is the point.
 *
 * `demo@forseti.local` keeps the platform admin seat it has always had; the
 * documentation, the earlier database and every note written so far name it.
 */
const ACCOUNTS: Array<{
  email: string;
  name: string;
  role: RoleName;
  /**
   * The `ai_person` this account acts as, where there is one.
   *
   * **Declared, never inferred.** Every name here already matches a fixture
   * person exactly, so matching on the string would work — and would be the
   * first step towards a product that guesses which human signed something. The
   * seed states the claim the same way an admin does on the members screen, and
   * it lands through the same store function and leaves the same audit row.
   */
  personId?: string;
}> = [
  /* Deliberately unmatched: the platform admin is the seat that administers the
   * tenant, not one of the people its registers name. It is also the account
   * most demos sign in as, which makes it the honest live example of what an
   * unmatched caller looks like — decisions attributed to the account and to no
   * person, exactly as `acting-person.ts` says they should be. Match it from
   * Settings → Members to watch that change. */
  { email: "demo@forseti.local", name: "Demo User", role: "platform_admin" },
  { email: "lead@forseti.local", name: "R. Andersen", role: "governance_lead", personId: "p-anders" },
  { email: "owner@forseti.local", name: "S. Devi", role: "system_owner", personId: "p-devi" },
  { email: "reviewer@forseti.local", name: "A. Boateng", role: "reviewer", personId: "p-boateng" },
  { email: "auditor@forseti.local", name: "J. Marek", role: "auditor", personId: "p-marek" },
];

/**
 * A role nobody can sign in as is a role nobody tests.
 *
 * Checked rather than trusted: adding a sixth role to `permissions.ts` and
 * forgetting it here would leave it verifiable only by reading the matrix, which
 * is exactly the state this list exists to end.
 */
const missing = ROLE_ORDER.filter((role) => !ACCOUNTS.some((a) => a.role === role));
if (missing.length > 0) {
  throw new Error(
    `No demo account for: ${missing.join(", ")}. Add one to ACCOUNTS in scripts/seed.ts.`,
  );
}

/**
 * Create the account if it is new, and return it either way.
 *
 * Through Better Auth's own API rather than by inserting rows, so password
 * hashing, id generation and the account record all match what a real sign-up
 * produces. A hand-inserted user looks right in the database and then cannot
 * sign in — the failure this function exists to avoid.
 */
async function ensureUser(email: string, name: string) {
  const [existing] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (existing) return { row: existing, created: false };

  await auth.api.signUpEmail({ body: { name, email, password: DEMO_PASSWORD } });

  const [created] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (!created) throw new Error(`Failed to create ${email}.`);
  return { row: created, created: true };
}

async function main() {
  // --- users ----------------------------------------------------------------
  const owners = new Map<string, string>();
  for (const account of ACCOUNTS) {
    const { row, created } = await ensureUser(account.email, account.name);
    owners.set(account.email, row.id);
    console.log(`${created ? "created" : "found"} user ${account.email}`);
  }


  // --- organization ---------------------------------------------------------
  let [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.slug, ORG_SLUG))
    .limit(1);

  if (!org) {
    const id = randomUUID();
    [org] = await db
      .insert(organization)
      .values({ id, name: ORG_NAME, slug: ORG_SLUG, createdAt: new Date() })
      .returning();
    console.log(`created organization "${ORG_NAME}" (${ORG_SLUG})`);
  } else {
    console.log(`organization "${ORG_NAME}" already exists`);
  }

  // --- memberships ----------------------------------------------------------
  /* Inserted directly rather than through the organization plugin, which is the
   * one place in the app that is right. The plugin's `afterAddMember` hook
   * resolves the acting user from `next/headers`, and there is no request here —
   * it would log a failure per member and attribute each one to nobody. A seed
   * is not somebody exercising their permissions; it is the fixture arriving. */
  for (const account of ACCOUNTS) {
    const userId = owners.get(account.email)!;
    const [existing] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, org.id), eq(member.userId, userId)))
      .limit(1);

    if (existing) {
      /* Re-seeding restores the intended role. Testing what an auditor sees
       * usually means demoting somebody, and leaving them demoted turns the next
       * run's "why can I not do anything" into a ten-minute detour. */
      if (existing.role !== account.role) {
        await db
          .update(member)
          .set({ role: account.role })
          .where(eq(member.id, existing.id));
        console.log(`  ${account.email}: ${existing.role} -> ${account.role}`);
      }
      continue;
    }

    await db.insert(member).values({
      id: randomUUID(),
      organizationId: org.id,
      userId,
      role: account.role,
      createdAt: new Date(),
    });
    console.log(`  ${account.email}: ${ROLE_LABEL[account.role]}`);
  }

  // The AI management system loads from the same fixture files the mockup was
  // approved against, so the demo and the design stay one artefact.
  await seedAiManagementSystem(org.id);
  console.log("seeded the AI management system from the playground fixtures");

  // --- who each account is ---------------------------------------------------
  /* After the fixtures, because the person has to exist before an account can
   * be said to be them — the foreign key is composite and would refuse it.
   *
   * `SYSTEM_ACTOR` rather than a fabricated user: "the seed said so" and "an
   * administrator said so" are different facts and the trail should not confuse
   * them. Re-running writes nothing when the link is unchanged, so the audit
   * trail does not grow a row per seed. */
  for (const account of ACCOUNTS) {
    if (!account.personId) continue;
    const userId = owners.get(account.email)!;
    const outcome = await linkAccountToPerson(
      org.id,
      { userId, personId: account.personId },
      SYSTEM_ACTOR,
    );
    if (!outcome.ok) {
      /* Loud rather than fatal: the rest of the demo is correct without it, and
       * a seed that dies at the last step leaves a half-loaded database. */
      console.warn(`  could not match ${account.email} to ${account.personId}: ${outcome.reason}`);
    } else {
      console.log(`  ${account.email} acts as ${account.personId}`);
    }
  }

  console.log("\nDone. Demo accounts use the operator-provided DEMO_PASSWORD; it is not printed.");
  for (const account of ACCOUNTS) {
    console.log(`  ${account.email.padEnd(24)} ${ROLE_LABEL[account.role]}`);
  }
  console.log("\nThis is synthetic demo data — see src/lib/ams/fixtures/.");
}

main().catch((err) => {
  console.error("\nSeed failed:", err);
  process.exit(1);
});
