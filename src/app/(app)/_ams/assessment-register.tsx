"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  assessmentProgress,
  currentStage,
} from "@/lib/ams/fixtures/assessments";
import { IMPACT_TEMPLATE } from "@/lib/ams/fixtures/assessment-template";
import { ASSESSMENT_STATUS, formatDate, isOverdue } from "@/lib/ams/labels";
import { coverageTone, TONE_FILL, TONE_TEXT, TONE_TRACK } from "@/lib/ams/tone";
import type { AssessmentStatus } from "@/lib/ams/types";
import { Checkbox } from "@/components/ui/checkbox";
import { RECORD_KINDS } from "@/lib/ams/record-kinds";
import { EmptyState } from "./empty-state";
import { OpenAssessmentDialog } from "./open-assessment-dialog";
import {
  RegisterActions,
  RegisterCreateButton,
  RegisterExportButton,
} from "./register-actions";
import { useSelection } from "./use-selection";
import { StatusBadge } from "./status-badge";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * Every impact assessment, and who is holding each one up.
 *
 * The column that matters is "waiting on". An assessment register that shows
 * status alone tells you a document is *in progress*, which everybody already
 * knew; what unblocks a quarter is knowing that three of them are sitting with
 * the same approver. Status is where it is, the assignee is why it is not
 * moving.
 *
 * Sorted by due date, overdue first, because the thing an auditor asks for is
 * the one that lapsed.
 */

const TH =
  "sticky top-0 z-10 bg-background border-b border-border px-3 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const TD = "border-b border-border/60 px-3 py-2.5 align-top";

export function AssessmentRegister() {
  const ws = useWorkspace();
  const { personById, systemById, getUseCase, assessments: ASSESSMENTS } = ws;
  const params = useSearchParams();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AssessmentStatus | "all" | "open">(
    (params.get("status") as AssessmentStatus) ?? "all",
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ASSESSMENTS.filter((a) => {
      if (status === "open" && a.status === "approved") return false;
      if (status !== "all" && status !== "open" && a.status !== status) return false;
      if (!q) return true;
      const system = systemById(a.systemId)?.name ?? "";
      const useCase = a.useCaseId ? getUseCase(a.useCaseId)?.name ?? "" : "";
      return `${system} ${useCase}`.toLowerCase().includes(q);
    }).sort((a, b) => {
      const aLate = isOverdue(a.dueAt) && a.status !== "approved";
      const bLate = isOverdue(b.dueAt) && b.status !== "approved";
      if (aLate !== bLate) return aLate ? -1 : 1;
      return a.dueAt.localeCompare(b.dueAt);
    });
  }, [ASSESSMENTS, systemById, getUseCase, query, status]);

  const open = ASSESSMENTS.filter((a) => a.status !== "approved").length;
  const late = ASSESSMENTS.filter(
    (a) => a.status !== "approved" && isOverdue(a.dueAt),
  ).length;
  const filtered = status !== "all" || query !== "";
  const [exportOpen, setExportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const router = useRouter();

  /*
   * The tick boxes. `ASSESSMENTS` rather than `rows`: an assessment ticked
   * before the status filter moved is still selected and still going.
   */
  const selection = useSelection(ASSESSMENTS, rows);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">Impact assessments</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {ASSESSMENTS.length} assessments against {IMPACT_TEMPLATE.name} v
          {IMPACT_TEMPLATE.version}. <span className="text-foreground">{open} not yet approved</span>
          {late > 0 && (
            <>
              , <span className="text-critical">{late} past due</span>
            </>
          )}
          . Sorted by due date, overdue first — that is the one an auditor asks
          for.
        </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RegisterExportButton
            def={RECORD_KINDS.assessment}
            onClick={() => setExportOpen(true)}
          />
          <RegisterCreateButton
            def={RECORD_KINDS.assessment}
            label="Open assessment"
            action="open an impact assessment"
            onClick={() => setCreateOpen(true)}
          />
        </div>
      </header>

      {/* The new row arrives from the next server render rather than being
        * spliced in here — see `create-dialog.tsx`. */}
      <OpenAssessmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onOpened={() => router.refresh()}
      />

      <RegisterActions
        def={RECORD_KINDS.assessment}
        selection={selection}
        shown={rows}
        total={ASSESSMENTS.length}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        deleteNote="Their answers and the signatures given against them go out of view with them, and the systems they cover stop showing an assessment."
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
        <div className="relative w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search system or use case…"
            className="h-8 pl-8 text-sm"
            aria-label="Search assessments"
          />
        </div>

        <Select
          value={status}
          onValueChange={(next) =>
            setStatus((next ?? "all") as AssessmentStatus | "all" | "open")
          }
        >
          <SelectTrigger size="sm" aria-label="Status" className="font-normal">
            <SelectValue>
              {status === "all"
                ? "All statuses"
                : status === "open"
                  ? "Not yet approved"
                  : ASSESSMENT_STATUS[status].label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Not yet approved</SelectItem>
            {(Object.keys(ASSESSMENT_STATUS) as AssessmentStatus[]).map((value) => (
              <SelectItem key={value} value={value}>
                {ASSESSMENT_STATUS[value].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtered && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setStatus("all");
              setQuery("");
            }}
          >
            <X aria-hidden />
            Clear
          </Button>
        )}

        <p className="ml-auto text-xs tabular text-muted-foreground">
          {rows.length} of {ASSESSMENTS.length} assessments
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing matches these filters"
              body="Every assessment is still here — this combination just excludes all of them."
            />
          </div>
        ) : (
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
                          ? "Deselect the assessments in view"
                          : "Select the assessments in view"
                      }
                    />
                    Assessment
                  </div>
                </th>
                <th className={TH}>System</th>
                <th className={TH}>Owner</th>
                <th className={TH}>Status</th>
                <th className={TH}>Waiting on</th>
                <th className={cn(TH, "text-right")}>Answered</th>
                <th className={cn(TH, "text-right")}>Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((assessment) => {
                const system = systemById(assessment.systemId);
                const useCase = assessment.useCaseId
                  ? getUseCase(assessment.useCaseId)
                  : undefined;
                /*
                 * Naming an id that does not resolve.
                 *
                 * A use case can be removed on its own now, and `getUseCase`
                 * reads the live register — so an assessment that names one is
                 * left holding an id with nothing behind it. Falling through to
                 * "System-level assessment" would be the screen asserting
                 * something false: that this covers the whole system, when it
                 * covers one removed use of it. The row says what is true and
                 * stays findable in the trash until the window ends.
                 */
                const removedUseCase = Boolean(assessment.useCaseId) && !useCase;
                const subject = useCase
                  ? useCase.name
                  : removedUseCase
                    ? "A removed use case"
                    : "System-level assessment";
                const stage = currentStage(assessment);
                const progress = assessmentProgress(ws, assessment);
                const late = isOverdue(assessment.dueAt) && assessment.status !== "approved";
                const tone = coverageTone(progress.percent);

                return (
                  <tr
                    key={assessment.id}
                    className={cn(
                      "group transition-colors hover:bg-secondary/40",
                      selection.isSelected(assessment.id) && "bg-secondary/60",
                    )}
                  >
                    <td className={cn(TD, "max-w-xs")}>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          checked={selection.isSelected(assessment.id)}
                          onCheckedChange={() => selection.toggle(assessment.id)}
                          aria-label={`Select the assessment for ${
                            removedUseCase ? "a removed use case" : (useCase?.name ?? "the whole system")
                          }`}
                        />
                        <Link
                          href={`/assessments/${assessment.id}`}
                          className="min-w-0 flex-1 font-medium whitespace-normal underline-offset-4 group-hover:underline"
                        >
                          {subject}
                        </Link>
                      </div>
                    </td>
                    <td className={cn(TD, "text-[0.8125rem] text-muted-foreground")}>
                      {system?.name ?? "—"}
                    </td>
                    <td className={cn(TD, "text-[0.8125rem] text-muted-foreground")}>
                      {personById(assessment.signOff[0].assigneeId).name}
                    </td>
                    <td className={TD}>
                      <StatusBadge
                        label={ASSESSMENT_STATUS[assessment.status].label}
                        tone={ASSESSMENT_STATUS[assessment.status].tone}
                      />
                    </td>
                    <td className={cn(TD, "text-[0.8125rem]")}>
                      {stage ? (
                        <>
                          <span className="block text-muted-foreground">
                            {personById(stage.assigneeId).name}
                          </span>
                          <span className="block text-[0.75rem] text-muted-foreground/60">
                            {stage.label}
                          </span>
                        </>
                      ) : (
                        <span className="text-ok">Signed off</span>
                      )}
                    </td>
                    <td className={cn(TD, "text-right")}>
                      <div className="flex items-center justify-end gap-2">
                        <span className={cn("tabular text-xs", TONE_TEXT[tone])}>
                          {progress.done}/{progress.required}
                        </span>
                        <div
                          className={cn(
                            "h-1 w-14 overflow-hidden rounded-full",
                            TONE_TRACK[tone],
                          )}
                        >
                          <div
                            className={cn("h-full rounded-full", TONE_FILL[tone])}
                            style={{ width: `${progress.percent}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td
                      className={cn(
                        TD,
                        "text-right tabular",
                        late ? "text-critical" : "text-muted-foreground",
                      )}
                    >
                      {formatDate(assessment.dueAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
