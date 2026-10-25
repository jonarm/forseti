"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";

import { ac, roles } from "./permissions";

/**
 * Browser-side auth. The plugin list must mirror `src/lib/auth.ts` — the client
 * derives its method surface from it, so a plugin enabled on the server but
 * missing here simply has no client methods, with no error to point at it.
 */
export const authClient = createAuthClient({
  // `ac` and `roles` mirror the server's, so the client's typed surface knows
  // `contributor` and `viewer` exist. Without them the plugin would still call
  // the endpoint, but with its built-in owner/admin/member vocabulary — and
  // assigning a role it had never heard of would be a type error here and a
  // rejection there.
  plugins: [organizationClient({ ac, roles }), twoFactorClient()],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  organization,
  useActiveOrganization,
  useListOrganizations,
} = authClient;
