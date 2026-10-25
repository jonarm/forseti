import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

/**
 * Better Auth's own endpoints — sign-in, sign-up, OAuth callbacks, organization
 * and two-factor operations. The catch-all path is `/api/auth/[...all]` because
 * the client derives its request URLs from that base; changing it means
 * changing `basePath` in the auth config to match.
 */
export const { GET, POST } = toNextJsHandler(auth);
