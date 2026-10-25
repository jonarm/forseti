"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  FileCheck2,
  Gauge,
  Inbox,
  Layers,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Server,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Workflow,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { OrgMenu } from "@/components/org-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The whole product, in the order someone works through it.
 *
 * Discover what you run, govern it, then show a customer. The GDPR toolkit this
 * codebase grew from used to sit below in its own group; it is gone, and with
 * it the name collision that forced the separation — "policy" now means one
 * thing here, the thing an ISO 42001 control cites.
 *
 * **Groups must stay contiguous.** The heading below is emitted whenever the
 * group changes from the previous row, so one entry inserted mid-list prints
 * its heading twice.
 *
 * Frameworks deliberately get one entry rather than one each: `/frameworks`
 * resolves to whichever standard the organisation has in scope, so a second one
 * never touches this file.
 */
const NAV = [
  { href: "/overview", label: "Readiness", icon: Gauge, group: null },

  { href: "/inventory", label: "AI Inventory", icon: Server, group: "Discover" },
  { href: "/use-cases", label: "Use cases", icon: Workflow, group: "Discover" },
  { href: "/intake", label: "Intake & triage", icon: Inbox, group: "Discover" },

  { href: "/frameworks", label: "Frameworks", icon: Layers, group: "Govern" },
  { href: "/risks", label: "Risk register", icon: ShieldAlert, group: "Govern" },
  { href: "/findings", label: "Findings", icon: AlertTriangle, group: "Govern" },
  { href: "/evidence", label: "Evidence", icon: FileCheck2, group: "Govern" },
  {
    href: "/assessments",
    label: "Impact assessments",
    icon: ClipboardList,
    group: "Govern",
  },

  {
    href: "/questionnaires",
    label: "Questionnaires",
    icon: MessagesSquare,
    group: "Go to market",
  },
  { href: "/trust-center", label: "Trust centre", icon: ShieldCheck, group: "Go to market" },
  { href: "/audit-pack", label: "Audit pack", icon: FileCheck2, group: "Go to market" },

  { href: "/settings/members", label: "Members", icon: Users, group: "Settings" },
  { href: "/settings/roles", label: "Roles", icon: SlidersHorizontal, group: "Settings" },
  { href: "/integrations", label: "Integrations", icon: Plug, group: "Settings" },
] as const;

export function Sidebar({
  userName,
  userEmail,
  roleLabel,
}: {
  userName: string | null;
  userEmail: string | null;
  /**
   * The caller's role as a **label**, resolved on the server.
   *
   * Not the role itself. A client handed `governance_lead` can branch on it, and
   * the moment anything does there are two permission matrices that can
   * disagree — the rule `uiPermissions()` exists to keep. A label is a fact
   * about the person for them to read, not a fact for the code to act on.
   */
  roleLabel: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center border-b border-sidebar-border px-4",
          collapsed && "justify-center px-0",
        )}
      >
        <Link href="/overview" className="flex items-center gap-2.5 overflow-hidden">
          <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden />
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight">
              Forseti
            </span>
          )}
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV.map(({ href, label, icon: Icon, group }, i) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          // A heading whenever the group changes. Hidden when collapsed, where
          // the rail is icons only and a label would have nothing to sit beside.
          const heading =
            group && group !== NAV[i - 1]?.group && !collapsed ? (
              <p
                key={`${group}-heading`}
                className="px-3 pt-3 pb-1 font-mono text-[0.62rem] uppercase tracking-[0.11em] text-muted-foreground/60"
              >
                {group}
              </p>
            ) : null;

          const link = (
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );

          return (
            <Fragment key={href}>
              {heading}
              {/* When collapsed the label is gone, so surface it on hover. */}
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger render={link} />
                  <TooltipContent side="right">{label}</TooltipContent>
                </Tooltip>
              ) : (
                link
              )}
            </Fragment>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <OrgMenu
          collapsed={collapsed}
          userName={userName}
          userEmail={userEmail}
          roleLabel={roleLabel}
        />

        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 shrink-0" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="size-4 shrink-0" aria-hidden />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
