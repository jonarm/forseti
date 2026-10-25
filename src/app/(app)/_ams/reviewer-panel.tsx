"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, UserRoundCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { refusalNote } from "@/lib/permissions";
import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";
import type { AuditSubjectKind } from "@/lib/audit";
import type { ReviewAssignment } from "@/lib/ams/types";

/**
 * Who reviews this record, at each stage.
 *
 * **This is the answer to "are Legal and Security roles?".** They are not: a
 * role says who *may* approve at all, and this says who is approving *this*.
 * Encoding them as roles would mean a new role every time the workflow gained a
 * step, and would still not name the person standing at the stage — the only
 * thing anybody actually wants to know when a document stops moving.
 *
 * **Assignment and sign-off are a split, not a duplicate.** This panel records
 * who *should* review; the sign-off bar below records where the chain has got to
 * and when. A stage's assignee here is an account and the chain's is an
 * `ai_person`, which used to mean the two could not be compared at all. They can
 * now: `ai_account_person` records who an account is, and each row below resolves
 * through it, so both halves finally name the same human in the same words.
 *
 * **What that resolution buys is a reading, not a gate.** The chain's stages and
 * this panel's are different vocabularies — three judgements about a document
 * versus five desks it crosses — and mapping one onto the other would be
 * inventing a correspondence nobody declared. More to the point, advancing the
 * chain does not persist yet, so gating it on identity would be a claim the code
 * cannot keep. What is worth saying is said: an assignee nobody has matched to a
 * person is one the chain cannot recognise, and the row says so rather than
 * looking complete.
 *
 * A member picker rather than a free-text field, because an assignment that can
 * name somebody who cannot sign in is an assignment nobody can act on. The store
 * checks the same thing again on the way in — this is the courtesy.
 */

/** The stages a record clears, in the order a review actually runs. */
const STAGES: Array<{ id: string; label: string; blurb: string }> = [
  { id: "legal", label: "Legal", blurb: "Contract, lawful basis, and what we may tell a customer." },
  { id: "privacy", label: "Privacy", blurb: "Personal data, retention, and the rights of the people in it." },
  { id: "security", label: "Security", blurb: "Access, tenancy and what leaves the estate." },
  { id: "governance", label: "Governance", blurb: "The management system's own view: does this belong in scope." },
  { id: "exec_sponsor", label: "Exec sponsor", blurb: "Accepts the residual risk on behalf of the business." },
];

export interface AssignableMember {
  userId: string;
  label: string;
  /** Shown beside the name so the picker does not offer an auditor to approve. */
  roleLabel: string;
}

export function ReviewerPanel({
  subjectKind,
  subjectId,
  members,
  assignments,
}: {
  subjectKind: AuditSubjectKind;
  subjectId: string;
  members: AssignableMember[];
  assignments: ReviewAssignment[];
}) {
  const router = useRouter();
  const { assignReviewers } = usePermissions();
  const { personForAccount } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byStage = new Map(assignments.map((a) => [a.stage, a.assigneeUserId]));

  async function assign(stage: string, assigneeUserId: string) {
    setBusy(stage);
    setError(null);
    try {
      const res = await fetch("/api/review-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectKind,
          subjectId,
          stage,
          // The empty option clears the stage; the route reads that as a
          // deliberate unassignment rather than a malformed request.
          assigneeUserId: assigneeUserId || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not save that assignment.");
      // Server Components hold the assignments, so they have to re-run.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-baseline gap-2">
          <UserRoundCheck className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="text-sm font-medium">Reviewers</h2>
            <p className="text-[0.8125rem] text-muted-foreground">
              Who is accountable for each stage. Legal and Security are
              assignments, not roles — the same person may cover several, and who
              covers what differs per system.
            </p>
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-[0.8125rem] text-critical">
            {error}
          </p>
        )}

        <ul className="divide-y divide-border/60">
          {STAGES.map((stage) => {
            const assigned = byStage.get(stage.id) ?? "";
            const person = assigned ? personForAccount(assigned) : undefined;
            return (
              <li
                key={stage.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm">{stage.label}</p>
                  <p className="text-xs text-muted-foreground">{stage.blurb}</p>

                  {/* The reconciliation, and the only thing this panel says
                    * about the chain: which person the assigned account is, in
                    * the same words the assessment's own sign-off uses. */}
                  {assigned &&
                    (person ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Signs as{" "}
                        <span className="text-foreground">{person.name}</span> —{" "}
                        {person.role}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-warn">
                        This account is not matched to a person, so the sign-off
                        chain cannot recognise them. Settings → Members.
                      </p>
                    ))}
                </div>

                <div className="flex items-center gap-2">
                  {busy === stage.id && (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
                  )}
                  <select
                    value={assigned}
                    disabled={!assignReviewers || busy !== null}
                    title={
                      assignReviewers ? undefined : refusalNote("assign a reviewer")
                    }
                    onChange={(e) => assign(stage.id, e.target.value)}
                    aria-label={`Reviewer for ${stage.label}`}
                    className={cn(
                      "rounded border border-border bg-secondary/40 px-2 py-1 text-xs",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                    )}
                  >
                    <option value="">Nobody yet</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.label} — {m.roleLabel}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            );
          })}
        </ul>

        {!assignReviewers && (
          <p className="text-[0.6875rem] text-muted-foreground/70">
            Read only. Naming a reviewer is a governance lead&apos;s decision —
            deliberately not a reviewer&apos;s, because choosing your own reviewer
            empties the approval of meaning.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
