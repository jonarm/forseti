-- The role column moves from Forseti's first four names to the five the
-- governance function actually has. `member.role` is text, so this is data, not
-- DDL — `db:generate` sees no schema diff and emits nothing, which is why this
-- migration is hand-written.
--
-- The mapping is privilege-preserving. Nobody gains or loses a permission here;
-- only the name changes:
--
--   owner       -> platform_admin    runs the tenant, can delete the org
--   admin       -> governance_lead   owns the library, the crosswalk, the members
--   contributor -> system_owner      answers, evidences, works the registers
--   viewer      -> auditor           read-only
--
-- `member` is Better Auth's own default and predates any enforcement, so it
-- meant "can do everything". `drizzle/0008` already moved it to `contributor`;
-- the case below is here for a row that migration missed — one written by an
-- older client, or restored from a backup taken before it ran.
--
-- **`platform_admin` is Better Auth's `creatorRole`** (see `src/lib/auth.ts`).
-- The plugin's last-one-out protections compare the stored string against that
-- exact value, so until this migration runs, an organization whose only owner is
-- stored as `owner` has no protected creator at all. That makes this a security
-- fix as much as a rename, and it is why the update is unconditional rather than
-- lazy.
--
-- Anything unrecognised is deliberately left alone rather than swept to
-- `auditor`. `normaliseRole()` already resolves an unknown string to read-only
-- at every call site, so an odd row is harmless; rewriting it here would destroy
-- the evidence of how it got there, which is the one thing worth keeping.
UPDATE "member" SET "role" = 'platform_admin'  WHERE "role" = 'owner';--> statement-breakpoint
UPDATE "member" SET "role" = 'governance_lead' WHERE "role" = 'admin';--> statement-breakpoint
UPDATE "member" SET "role" = 'system_owner'    WHERE "role" IN ('contributor', 'member');--> statement-breakpoint
UPDATE "member" SET "role" = 'auditor'         WHERE "role" = 'viewer';--> statement-breakpoint

-- Pending invitations carry a role too, and an invitation accepted after this
-- migration writes its stored string straight into `member`. Leaving them behind
-- would reintroduce the old names one acceptance at a time.
UPDATE "invitation" SET "role" = 'platform_admin'  WHERE "role" = 'owner';--> statement-breakpoint
UPDATE "invitation" SET "role" = 'governance_lead' WHERE "role" = 'admin';--> statement-breakpoint
UPDATE "invitation" SET "role" = 'system_owner'    WHERE "role" IN ('contributor', 'member');--> statement-breakpoint
UPDATE "invitation" SET "role" = 'auditor'         WHERE "role" = 'viewer';
