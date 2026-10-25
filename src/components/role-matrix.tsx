"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  FIXED_ROLE,
  ROLE_BLURB,
  ROLE_LABEL,
  ROLE_ORDER,
  refusalNote,
  type RoleGrants,
  type RoleName,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * What each role means, and — for the roles a tenant may change — the switches
 * that change it.
 *
 * **The matrix was only ever asserted in a test file.** Every screen in the
 * product branches on `uiPermissions()`, the routes branch on `can()`, and the
 * one place stating the whole shape in full was `permissions.test.ts`. An
 * administrator deciding who to make a reviewer had `ROLE_BLURB`'s one sentence
 * and nothing else. So this reads as a grid first: it is worth having even for
 * an organization that never edits a cell.
 *
 * **Three things are visibly not editable, each for its own reason, and each
 * says so rather than being filtered out.** A missing row reads as a bug and
 * invites somebody to go looking for the setting.
 *
 *   - `platform_admin` — Better Auth's `creatorRole`. The plugin's last-one-out
 *     protections key off it, and it is the role holding the permission to edit
 *     the others. A tenant that could edit it could lock itself out.
 *   - `organization`, `member`, `invitation` — policed by the organization
 *     plugin from a definition fixed at startup, so an edit here would apply to
 *     this app's routes and not to the library's own endpoints.
 *   - The forbidden pairs — a system owner approving their own sign-off, an
 *     owner verifying their own fix, a reviewer appointing their own reviewer.
 *     Those are the product's segregation of duties; a matrix that could switch
 *     them off would let an organization configure away the thing that makes its
 *     records defensible.
 *
 * The last group is refused by the *store*, not by this component. What is here
 * is the courtesy that saves a round trip; the sentence the server would return
 * is the sentence shown.
 */

export interface RoleMatrixRow {
  role: RoleName;
  /** What it means here — the default, or this organization's edit of it. */
  grants: RoleGrants;
  /** Whether a row has been changed from what the product ships. */
  customised: boolean;
}

const BTN =
  "inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-40";

export function RoleMatrix({
  rows,
  resources,
  editableResources,
  forbidden,
  canEdit,
}: {
  rows: RoleMatrixRow[];
  /** Every resource in the vocabulary, with its actions. Rendered in order. */
  resources: Array<{ resource: string; actions: string[] }>;
  editableResources: string[];
  /** `role:resource:action` triples the product refuses, with the reason. */
  forbidden: Array<{ role: RoleName; resource: string; action: string; why: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const byRole = new Map(rows.map((row) => [row.role, row]));

  function forbiddenReason(role: RoleName, resource: string, action: string) {
    return forbidden.find(
      (rule) => rule.role === role && rule.resource === resource && rule.action === action,
    )?.why;
  }

  function held(role: RoleName, resource: string, action: string): boolean {
    return Boolean(byRole.get(role)?.grants[resource]?.includes(action));
  }

  /**
   * Send the role's whole matrix, not the one cell that moved.
   *
   * The store takes the complete set a caller wants for that role — the same
   * contract the link tables use — because a partial write cannot distinguish
   * "the reviewer no longer verifies findings" from "the finding row was not
   * sent".
   */
  async function toggle(role: RoleName, resource: string, action: string) {
    const row = byRole.get(role);
    if (!row) return;

    const next: Record<string, string[]> = {};
    for (const editable of editableResources) {
      next[editable] = [...(row.grants[editable] ?? [])];
    }

    const actions = new Set(next[resource] ?? []);
    if (actions.has(action)) actions.delete(action);
    else actions.add(action);
    next[resource] = [...actions];

    await send(role, next, `${ROLE_LABEL[role]} updated.`);
  }

  async function reset(role: RoleName) {
    await send(role, null, `${ROLE_LABEL[role]} is back to the default permissions.`);
  }

  async function send(role: RoleName, grants: Record<string, string[]> | null, ok: string) {
    setBusy(role);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/role-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, grants }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The refusal names the rule and why it exists. Shown as it arrived —
        // rewording it here would give the reader a second, weaker explanation.
        throw new Error(payload.error ?? "Could not save that change.");
      }
      setNote(ok);
      // The permissions every screen renders from come from the server.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          {refusalNote("change what a role means")} You can see what each role
          may do.
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical/10 p-3 text-sm text-critical">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}
      {note && <p className="text-xs text-ok">{note}</p>}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="px-4 py-2.5 text-left font-mono text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                  Permission
                </th>
                {ROLE_ORDER.map((role) => (
                  <th
                    key={role}
                    className="px-3 py-2.5 text-center font-mono text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground"
                    title={ROLE_BLURB[role]}
                  >
                    {ROLE_LABEL[role]}
                    {byRole.get(role)?.customised && (
                      <span className="ml-1 text-brand" title="Changed from the default">
                        •
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map(({ resource, actions }) => {
                const fixedResource = !editableResources.includes(resource);
                return actions.map((action, index) => (
                  <tr
                    key={`${resource}:${action}`}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs">
                        {index === 0 ? resource : ""}
                        <span className="text-muted-foreground">
                          {index === 0 ? ": " : "· "}
                          {action}
                        </span>
                      </span>
                      {fixedResource && index === 0 && (
                        <p className="text-[0.7rem] text-muted-foreground/70">
                          Enforced by the auth library from a fixed definition —
                          not changeable per organization.
                        </p>
                      )}
                    </td>

                    {ROLE_ORDER.map((role) => {
                      const why = forbiddenReason(role, resource, action);
                      const fixedRole = role === FIXED_ROLE;
                      const locked = fixedRole || fixedResource || Boolean(why);
                      const on = held(role, resource, action);

                      return (
                        <td key={role} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!canEdit || locked || busy !== null}
                            aria-label={`${ROLE_LABEL[role]} — ${resource}: ${action}`}
                            onChange={() => toggle(role, resource, action)}
                            title={
                              why ??
                              (fixedRole
                                ? `${ROLE_LABEL[FIXED_ROLE]} runs the tenant and holds the permission to edit the other roles. It cannot be changed.`
                                : fixedResource
                                  ? "Membership and invitations are enforced by the auth library from a fixed definition. An edit here would apply to this app and not to it."
                                  : canEdit
                                    ? undefined
                                    : refusalNote("change what a role means"))
                            }
                            className={cn(
                              "size-3.5 accent-brand",
                              locked && "cursor-not-allowed opacity-40",
                            )}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {ROLE_ORDER.filter(
            (role) => role !== FIXED_ROLE && byRole.get(role)?.customised,
          ).map((role) => (
            <button
              key={role}
              type="button"
              className={BTN}
              disabled={busy !== null}
              onClick={() => reset(role)}
            >
              {busy === role ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="size-3" aria-hidden />
              )}
              Reset {ROLE_LABEL[role]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
