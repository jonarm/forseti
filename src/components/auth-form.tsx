"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT } from "@/lib/password-policy";

export type OAuthProvider = "google" | "microsoft";

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: "Continue with Google",
  microsoft: "Continue with Microsoft",
};

/**
 * Sign-in and sign-up share this form.
 *
 * The two flows differ only in one field, one endpoint and where they land
 * afterwards, and keeping them together means the error handling and the OAuth
 * block can't drift apart between the two screens.
 */
export function AuthForm({
  mode,
  providers,
  next,
}: {
  mode: "sign-in" | "sign-up";
  providers: OAuthProvider[];
  next?: string;
}) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // A brand-new account has no organization, so it always goes to onboarding.
  // An existing session returns to wherever the proxy interrupted them.
  const destination = isSignUp ? "/onboarding" : (next ?? "/overview");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });

      if (result.error) {
        setError(result.error.message ?? "That didn't work. Please try again.");
        return;
      }

      router.push(destination);
      // The destination is a Server Component reading the new session; without
      // this it can render from a cache populated while signed out.
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  async function handleOAuth(provider: OAuthProvider) {
    setError(null);
    setPending(true);
    try {
      await authClient.signIn.social({ provider, callbackURL: destination });
    } catch {
      setError(`Could not start ${provider} sign-in.`);
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">
            {isSignUp ? "Create your account" : "Sign in"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isSignUp
              ? "You'll set up your company next."
              : "Welcome back."}
          </p>
        </div>

        {providers.length > 0 && (
          <>
            <div className="space-y-2">
              {providers.map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={pending}
                  onClick={() => handleOAuth(p)}
                >
                  {PROVIDER_LABEL[p]}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              // The same constant `auth.ts` configures Better Auth from; the
              // server is still the one that enforces it.
              minLength={isSignUp ? MIN_PASSWORD_LENGTH : undefined}
              required
            />
            {isSignUp && (
              <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical/10 p-2.5 text-xs text-critical">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          {isSignUp ? "Already have an account? " : "No account yet? "}
          <Link
            href={isSignUp ? "/sign-in" : "/sign-up"}
            className="text-foreground underline underline-offset-4"
          >
            {isSignUp ? "Sign in" : "Create one"}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
