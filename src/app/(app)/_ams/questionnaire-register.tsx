"use client";

import Link from "next/link";
import { useState } from "react";

import { cn } from "@/lib/utils";
import {
  QUESTIONNAIRE_STATUS,
  REQUESTER_TYPE,
} from "@/lib/ams/fixtures/questionnaires";
import { formatDate, isOverdue } from "@/lib/ams/labels";
import { StatusBadge } from "./status-badge";
import { useWorkspace } from "@/lib/ams/workspace-context";
import { Checkbox } from "@/components/ui/checkbox";
import { RECORD_KINDS } from "@/lib/ams/record-kinds";
import { RegisterActions, RegisterExportButton } from "./register-actions";
import { useSelection } from "./use-selection";

/**
 * Inbound questionnaires, ordered by what is closest to breaching a commitment.
 *
 * Small enough not to need filters — an organisation this size gets a handful a
 * quarter, and the whole complaint is that each one takes eleven days rather
 * than that there are hundreds of them.
 */
const TH =
  "border-b border-border px-3 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const TD = "border-b border-border/60 px-3 py-2.5 align-top";

export function QuestionnaireRegister() {
  const { personById, questionnaires: QUESTIONNAIRES } = useWorkspace();
  const rows = [...QUESTIONNAIRES].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const open = QUESTIONNAIRES.filter((q) => q.status !== "submitted").length;
  const [exportOpen, setExportOpen] = useState(false);

  /* This register has no filters, so `rows` is everything in due order — the
   * hook's two arguments are the same list, and the "outside the current
   * filters" note it can produce simply never fires. */
  const selection = useSelection(QUESTIONNAIRES, rows);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">Questionnaires</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          What customers, prospects and insurers ask before they will sign.{" "}
          <span className="text-foreground">{open} open</span>. Each answer is
          drafted from the control set, the policy library and the evidence
          register, with the citations attached — and nothing is sent until a
          person accepts it.
        </p>
        </div>
        <div className="shrink-0">
          <RegisterExportButton
            def={RECORD_KINDS.questionnaire}
            onClick={() => setExportOpen(true)}
          />
        </div>
      </header>

      <RegisterActions
        def={RECORD_KINDS.questionnaire}
        selection={selection}
        shown={rows}
        total={QUESTIONNAIRES.length}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        deleteNote="Their questions go out of view with them. Whoever sent them is still waiting, so the trail keeps the record that they arrived."
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={TH}>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selection.allShown}
                    indeterminate={!selection.allShown && selection.someShown}
                    disabled={rows.length === 0}
                    onCheckedChange={selection.toggleAllShown}
                    aria-label={
                      selection.allShown
                        ? "Deselect every questionnaire"
                        : "Select every questionnaire"
                    }
                  />
                  Questionnaire
                </div>
              </th>
              <th className={TH}>From</th>
              <th className={TH}>Owner</th>
              <th className={TH}>Questions</th>
              <th className={TH}>Status</th>
              <th className={cn(TH, "text-right")}>Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => {
              const late = q.status !== "submitted" && isOverdue(q.dueAt);
              return (
                <tr
                  key={q.id}
                  className={cn(
                    "group transition-colors hover:bg-secondary/40",
                    selection.isSelected(q.id) && "bg-secondary/60",
                  )}
                >
                  <td className={cn(TD, "max-w-sm")}>
                    <div className="flex items-start gap-2">
                      <Checkbox
                        className="mt-0.5"
                        checked={selection.isSelected(q.id)}
                        onCheckedChange={() => selection.toggle(q.id)}
                        aria-label={`Select ${q.title}`}
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/questionnaires/${q.id}`}
                          className="font-medium underline-offset-4 group-hover:underline"
                        >
                          {q.title}
                        </Link>
                        <p className="mt-0.5 text-[0.75rem] leading-snug text-muted-foreground/70">
                          {q.note}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className={cn(TD, "text-[0.8125rem] text-muted-foreground")}>
                    {q.requester}
                    <span className="block text-[0.75rem] text-muted-foreground/60">
                      {REQUESTER_TYPE[q.requesterType]}
                    </span>
                  </td>
                  <td className={cn(TD, "text-[0.8125rem] text-muted-foreground")}>
                    {personById(q.ownerId).name}
                  </td>
                  <td className={cn(TD, "tabular text-muted-foreground")}>
                    {q.questions.length || "—"}
                  </td>
                  <td className={TD}>
                    <StatusBadge
                      label={QUESTIONNAIRE_STATUS[q.status].label}
                      tone={QUESTIONNAIRE_STATUS[q.status].tone}
                    />
                  </td>
                  <td
                    className={cn(
                      TD,
                      "text-right tabular",
                      late ? "text-critical" : "text-muted-foreground",
                    )}
                  >
                    {formatDate(q.dueAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
