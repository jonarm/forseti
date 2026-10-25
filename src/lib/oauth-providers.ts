import type { OAuthProvider } from "@/components/auth-form";

/**
 * Which social providers are actually configured.
 *
 * The auth config registers a provider only when both of its env vars are
 * present, so the buttons have to be derived the same way — otherwise a
 * deployment without Google credentials renders a button that dead-ends.
 * Server-only: this reads secrets' presence, never their values.
 */
export function configuredOAuthProviders(): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.push("google");
  }
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    providers.push("microsoft");
  }
  return providers;
}
