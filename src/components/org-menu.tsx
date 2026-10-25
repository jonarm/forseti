"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Check, ChevronsUpDown, LogOut } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/**
 * Active organization and account actions.
 *
 * Switching organizations is a session mutation, not a client-side filter — it
 * changes `activeOrganizationId`, which is what every server-side query scopes
 * on. That is why it must be followed by `router.refresh()`: the Server
 * Components rendering the dashboard have to re-run against the new tenant, and
 * without it the previous org's data stays on screen.
 */
export function OrgMenu({
  collapsed,
  userName,
  userEmail,
  roleLabel,
}: {
  collapsed: boolean;
  userName: string | null;
  userEmail: string | null;
  roleLabel: string;
}) {
  const router = useRouter();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: organizations } = authClient.useListOrganizations();
  const [busy, setBusy] = useState(false);

  async function switchTo(organizationId: string) {
    if (organizationId === activeOrg?.id) return;
    setBusy(true);
    try {
      await authClient.organization.setActive({ organizationId });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <DropdownMenu>
      {/*
        Shows the signed-in email under the organization name.

        An organization name on its own reads as a label, not a control — the
        first person to use this could not find sign-out at all, because nothing
        said "this is your account". Surfacing the identity is what makes the
        menu discoverable; the chevron alone did not.
      */}
      <DropdownMenuTrigger
        disabled={busy}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
          collapsed && "justify-center px-0",
        )}
        aria-label="Account and organization menu"
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground"
          aria-hidden
        >
          {userName?.[0]?.toUpperCase() ?? <Building2 className="size-3.5" />}
        </span>
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
              <span className="truncate text-sidebar-accent-foreground">
                {activeOrg?.name ?? "No organization"}
              </span>
              {userEmail && (
                <span className="truncate text-xs text-muted-foreground">
                  {userEmail}
                </span>
              )}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent side="right" align="end" className="w-60">
        {/*
          `DropdownMenuLabel` is Base UI's Menu.GroupLabel, which throws unless
          it is inside a Menu.Group — it names a group rather than being free
          text. So the label and the organizations it describes are wrapped
          together, and the account identity below is a plain element, because
          it labels nothing.
        */}
        {(organizations?.length ?? 0) > 1 && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Switch organization
              </DropdownMenuLabel>
              {organizations?.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  onClick={() => switchTo(org.id)}
                  className="justify-between gap-2"
                >
                  <span className="truncate">{org.name}</span>
                  {org.id === activeOrg?.id && (
                    <Check className="size-3.5 shrink-0" aria-hidden />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}

        {/*
          Who you are signed in as, and — the part that is new — **what you are**.

          The role belongs here because this product's screens differ by role:
          an auditor meets a disabled Draft button and a reviewer cannot edit the
          assessment they are endorsing, and both are correct behaviour that
          reads as a broken page if you do not know which hat you are wearing.
          The email answers "whose account"; the role answers "why can I not do
          that", which is the question people actually arrive with.

          It is a label computed on the server, never the role itself — see the
          prop's own comment in `sidebar.tsx`.
        */}
        <div className="px-1.5 py-1.5">
          <p className="truncate text-sm text-foreground">{userName ?? "Signed in"}</p>
          {userEmail && (
            <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
          )}
          <p className="mt-1 inline-flex rounded border border-border px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
            {roleLabel}
          </p>
        </div>
        <DropdownMenuSeparator />

        {/*
          Members moved to the sidebar's Settings group. It used to live here on
          the argument that it is about the organization rather than the work —
          which is true and was the wrong trade: a menu nobody opens is a screen
          nobody finds, and managing who has access is not a rare enough act to
          be hidden behind an account chevron.
        */}
        <DropdownMenuItem onClick={handleSignOut} className="gap-2">
          <LogOut className="size-3.5" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
