"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

/** Slug the org name: lowercase, alphanumeric, dash-separated. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * First step of onboarding: create the organization and make it active.
 *
 * The organization is the tenant — until one exists and is set active, every
 * scoped read in the app has no id to filter on, which is why `AppLayout`
 * redirects here rather than rendering an empty dashboard.
 */
export function CreateOrganization() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const slug = toSlug(name);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!slug) {
      setError("Enter a company name using letters or numbers.");
      return;
    }

    setPending(true);
    try {
      const created = await authClient.organization.create({ name: name.trim(), slug });

      if (created.error) {
        setError(
          created.error.message ??
            "Could not create the organization. The name may already be taken.",
        );
        return;
      }

      // Creating does not select it. Without this the session still has no
      // activeOrganizationId and the app would bounce straight back here.
      const activated = await authClient.organization.setActive({
        organizationId: created.data.id,
      });

      if (activated.error) {
        setError("Organization created, but could not be selected. Reload to continue.");
        return;
      }

      router.push("/overview");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">Set up your company</h2>
          <p className="text-sm text-muted-foreground">
            Everything in Forseti — profiles, assessments, evidence — belongs to a
            company. You can invite colleagues to it once it exists.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Company name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Meridian Analytics"
              autoComplete="organization"
              required
            />
            {slug && (
              <p className="text-xs text-muted-foreground">
                Identifier: <span className="font-mono">{slug}</span>
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical/10 p-2.5 text-xs text-critical">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            Continue
            {!pending && <ArrowRight className="size-4" aria-hidden />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
