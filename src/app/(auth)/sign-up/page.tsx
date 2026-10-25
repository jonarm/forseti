import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { configuredOAuthProviders } from "@/lib/oauth-providers";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if (await getSession()) redirect("/overview");

  return <AuthForm mode="sign-up" providers={configuredOAuthProviders()} />;
}
