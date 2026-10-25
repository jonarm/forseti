import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { configuredOAuthProviders } from "@/lib/oauth-providers";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Already signed in — don't show a sign-in form to someone with a session.
  if (await getSession()) redirect("/overview");

  const { next } = await searchParams;

  // Only accept a same-site path back, so `?next=` can't be used to bounce
  // someone to an external site off the back of a sign-in link.
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return (
    <AuthForm mode="sign-in" providers={configuredOAuthProviders()} next={safeNext} />
  );
}
