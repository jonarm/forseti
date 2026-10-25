"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ams/tone";
import {
  ASSESSMENT_STATUS,
  OVERSIGHT,
  RISK_TIER,
  USE_CASE_STATUS,
} from "@/lib/ams/labels";
import type { AIUseCase, RiskTier, UseCaseStatus } from "@/lib/ams/types";
import { RECORD_KINDS } from "@/lib/ams/record-kinds";
import { useWorkspace } from "@/lib/ams/workspace-context";
import { AddUseCaseDialog } from "./add-use-case-dialog";
import { EmptyState } from "./empty-state";
import { ImportDialog } from "./import-dialog";
import {
  RegisterActions,
  RegisterCreateButton,
  RegisterExportButton,
  RegisterImportButton,
} from "./register-actions";
import { StatusBadge } from "./status-badge";
import { useSelection } from "./use-selection";

/**
 * Every use case the organisation runs, on one screen.
 *
 * The detail page argues that a use case is an object rather than a description
 * of its system. This screen is what that argument costs if it is not made: as a
 * tab on a system profile a use case can only be read one system at a time, so
 * the question a regulator actually asks — *where does this inform decisions
 * about people, across everything you run* — gets answered by opening forty
 * profiles and remembering. Listing them together makes it a scan.
 *
 * **Ordered by risk tier descending, then by the two questions.** Not by system,
 * which would rebuild the grouping the profile tab already gives, and not by
 * name. The rows worth reading first are the high-tier ones that face customers
 * and inform decisions about people; sorting by anything else buries them among
 * the internal drafting assistants.
 *
 * Tier and oversight sit side by side because the pairing is the finding. A
 * high-risk use case with nobody watching the output is the row this register
 * exists to surface, and neither column says it alone.
 *
 * The toolbar is the shared one, mounted rather than reimplemented:
 * `RegisterActions` and `useSelection` for the tick boxes and the bulk delete,
 * `RegisterCreateButton` for the dialog. A second copy of either is how one
 * register starts confirming a deletion by counting rows while its neighbours
 * name them.
 *
 * **`systemId` is not a column anything here can change.** Moving a use case to
 * a different system is not a correction — see `POST /api/use-cases` — so the
 * register offers no way to do it in bulk either.
 */

const TH =
  "sticky top-0 z-10 bg-background border-b border-border px-3 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const TD = "border-b border-border/60 px-3 py-2.5 align-top";

/** The ladder, in the order attention should travel down it. */
const TIER_RANK: Record<RiskTier, number> = {
  unacceptable: 0,
  high: 1,
  limited: 2,
  minimal: 3,
};

/** The two questions, counted — a use case answering both leads its tier. */
function weight(useCase: AIUseCase) {
  return (useCase.informsDecisionsAboutPeople ? 2 : 0) + (useCase.facesCustomers ? 1 : 0);
}

export function UseCaseRegister() {
  const { useCases: USE_CASES, systemById, getSystemsForUseCase, personById, assessmentById } =
    useWorkspace();

  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<RiskTier | "all">("all");
  const [status, setStatus] = useState<UseCaseStatus | "all">("all");
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const router = useRouter();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return USE_CASES.filter((useCase) => {
      /* The baseline, deliberately. This register is org-wide and has no
       * system to resolve a pairing against — filtering by the tier of a
       * purpose *somewhere* would return rows whose badge disagrees with
       * the filter that found them. A system's own tabs read
       * `effectiveTier` instead, where there is a system to read it for. */
      if (tier !== "all" && useCase.riskTier !== tier) return false;
      if (status !== "all" && useCase.status !== status) return false;
      if (!q) return true;
      const systems = useCase.systemIds
        .map((id) => systemById(id)?.name ?? "")
        .join(" ");
      return `${useCase.name} ${systems} ${useCase.businessUnit} ${personById(useCase.ownerId).name}`
        .toLowerCase()
        .includes(q);
    }).sort(
      (a, b) =>
        TIER_RANK[a.riskTier] - TIER_RANK[b.riskTier] ||
        weight(b) - weight(a) ||
        a.name.localeCompare(b.name),
    );
  }, [USE_CASES, systemById, personById, query, tier, status]);

  /*
   * The tick boxes. `USE_CASES` rather than `rows` is the first argument on
   * purpose: a use case ticked before a filter was applied is still selected and
   * still going, and the confirmation still names it.
   */
  const selection = useSelection(USE_CASES, rows);

  const high = USE_CASES.filter(
    (u) => u.riskTier === "high" || u.riskTier === "unacceptable",
  ).length;
  const deciding = USE_CASES.filter((u) => u.informsDecisionsAboutPeople).length;
  const unoverseen = USE_CASES.filter(
    (u) => u.oversightLevel === "none" && u.status !== "retired",
  ).length;
  /* Distinct systems reached, not a partition: a purpose served by three
   * tools contributes all three, and the same tool serving four purposes
   * contributes once. `USE_CASES.length` and this no longer multiply out. */
  const systemCount = new Set(USE_CASES.flatMap((u) => u.systemIds)).size;
  const filtered = tier !== "all" || status !== "all" || query !== "";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">Use cases</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The jobs the tools are actually doing — the level at which risk is real
          and the level a regulator asks about. {USE_CASES.length} recorded,
          reaching {systemCount} system{systemCount === 1 ? "" : "s"},{" "}
          <span className={cn(high > 0 && "text-warn")}>
            {high} at high tier or above
          </span>
          ,{" "}
          <span className={cn(deciding > 0 && "text-warn")}>
            {deciding} informing decisions about people
          </span>
          {unoverseen > 0 && (
            <>
              ,{" "}
              {/* The colour comes from the state itself. `OVERSIGHT.none` is
                * already critical in `labels.ts`, and restating the class here
                * is how the two drift apart. */}
              <span className={TONE_TEXT[OVERSIGHT.none.tone]}>
                {unoverseen} with nobody watching the output
              </span>
            </>
          )}
          .
        </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RegisterImportButton
            def={RECORD_KINDS.useCase}
            action="import use cases from a spreadsheet"
            onClick={() => setImportOpen(true)}
          />
          <RegisterExportButton
            def={RECORD_KINDS.useCase}
            onClick={() => setExportOpen(true)}
          />
          <RegisterCreateButton
            def={RECORD_KINDS.useCase}
            label="Add use case"
            action="add a use case"
            onClick={() => setAddOpen(true)}
          />
        </div>
      </header>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        def={RECORD_KINDS.useCase}
        onImported={() => router.refresh()}
      />

      {/* The new row arrives from the next server render rather than being
        * spliced in here — see `create-dialog.tsx` for why a register never
        * shows a record it has not been told was saved. */}
      <AddUseCaseDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => router.refresh()}
      />

      <RegisterActions
        def={RECORD_KINDS.useCase}
        selection={selection}
        shown={rows}
        total={USE_CASES.length}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        deleteNote="The risks filed against them stay on the risk register, pointing at a use case nobody can open until it is restored or the retention window ends."
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
            placeholder="Search use case, system, unit, owner…"
            className="h-8 pl-8 text-sm"
            aria-label="Search use cases"
          />
        </div>

        <Select
          value={tier}
          onValueChange={(next) => setTier((next ?? "all") as RiskTier | "all")}
        >
          <SelectTrigger size="sm" aria-label="Risk tier" className="font-normal">
            <SelectValue>
              {tier === "all" ? "All tiers" : `${RISK_TIER[tier].label} risk`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            {(Object.keys(RISK_TIER) as RiskTier[]).map((value) => (
              <SelectItem key={value} value={value}>
                {RISK_TIER[value].label} risk
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={status}
          onValueChange={(next) => setStatus((next ?? "all") as UseCaseStatus | "all")}
        >
          <SelectTrigger size="sm" aria-label="Status" className="font-normal">
            <SelectValue>
              {status === "all" ? "All statuses" : USE_CASE_STATUS[status].label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(USE_CASE_STATUS) as UseCaseStatus[]).map((value) => (
              <SelectItem key={value} value={value}>
                {USE_CASE_STATUS[value].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtered && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setTier("all");
              setStatus("all");
              setQuery("");
            }}
          >
            <X aria-hidden />
            Clear
          </Button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} of {USE_CASES.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="px-6 py-6">
            <EmptyState
              title={filtered ? "Nothing matches those filters" : "No use cases recorded"}
              body={
                filtered
                  ? "Clear the search, or widen the tier and status filters, to see the rest of the register."
                  : "A system with no use cases has not really been assessed — the risk lives in what people do with it, not in the licence. Add the jobs your tools are actually doing, or import the usage sheet you already keep."
              }
              action={
                filtered ? undefined : (
                  <RegisterCreateButton
                    def={RECORD_KINDS.useCase}
                    label="Add use case"
                    action="add a use case"
                    onClick={() => setAddOpen(true)}
                  />
                )
              }
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
                          ? "Deselect every use case"
                          : "Select every use case"
                      }
                    />
                    Use case
                  </div>
                </th>
                <th className={TH}>System</th>
                <th className={TH}>Owner</th>
                <th className={TH}>Tier</th>
                <th className={TH}>Oversight</th>
                <th className={TH}>Assessment</th>
                <th className={cn(TH, "text-right")}>Users</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((useCase) => {
                const systems = getSystemsForUseCase(useCase.id);
                const owner = personById(useCase.ownerId);
                const assessment = useCase.assessmentId
                  ? assessmentById(useCase.assessmentId)
                  : undefined;
                return (
                  <tr
                    key={useCase.id}
                    className={cn(
                      "group transition-colors hover:bg-secondary/40",
                      selection.isSelected(useCase.id) && "bg-secondary/60",
                    )}
                  >
                    <td className={cn(TD, "max-w-sm")}>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          checked={selection.isSelected(useCase.id)}
                          onCheckedChange={() => selection.toggle(useCase.id)}
                          aria-label={`Select ${useCase.name}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/use-cases/${useCase.id}`}
                              className="font-medium underline-offset-4 group-hover:underline"
                            >
                              {useCase.name}
                            </Link>
                            <StatusBadge
                              label={USE_CASE_STATUS[useCase.status].label}
                              tone={USE_CASE_STATUS[useCase.status].tone}
                            />
                          </div>
                          <p className="mt-0.5 text-[0.75rem] leading-snug text-muted-foreground/70">
                            {useCase.description}
                          </p>
                          {(useCase.facesCustomers ||
                            useCase.informsDecisionsAboutPeople) && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {useCase.facesCustomers && (
                                <StatusBadge label="Customer facing" tone="warn" />
                              )}
                              {useCase.informsDecisionsAboutPeople && (
                                <StatusBadge
                                  label="Informs decisions about people"
                                  tone="critical"
                                />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={cn(TD, "text-[0.8125rem] text-muted-foreground")}>
                      {/* Every system, each its own link. Comma-separated
                        * rather than stacked: the column is already narrow and
                        * most rows still hold one. */}
                      {systems.length > 0
                        ? systems.map((system, index) => (
                            <span key={system.id}>
                              {index > 0 && ", "}
                              <Link
                                href={`/inventory/${system.id}`}
                                className="underline-offset-4 hover:text-foreground hover:underline"
                              >
                                {system.name}
                              </Link>
                            </span>
                          ))
                        : "—"}
                      <span className="block text-[0.75rem] text-muted-foreground/60">
                        {useCase.businessUnit}
                      </span>
                    </td>
                    <td className={cn(TD, "text-[0.8125rem] text-muted-foreground")}>
                      {owner.name}
                      <span className="block text-[0.75rem] text-muted-foreground/60">
                        {owner.role}
                      </span>
                    </td>
                    <td className={TD}>
                      <StatusBadge
                        label={RISK_TIER[useCase.riskTier].label}
                        tone={RISK_TIER[useCase.riskTier].tone}
                      />
                    </td>
                    <td className={TD}>
                      <StatusBadge
                        label={OVERSIGHT[useCase.oversightLevel].label}
                        tone={OVERSIGHT[useCase.oversightLevel].tone}
                        title={OVERSIGHT[useCase.oversightLevel].blurb}
                      />
                    </td>
                    <td className={TD}>
                      {assessment ? (
                        <Link
                          href={`/assessments/${assessment.id}`}
                          className="inline-block transition-opacity hover:opacity-75"
                          title="Open assessment"
                        >
                          <StatusBadge
                            label={ASSESSMENT_STATUS[assessment.status].label}
                            tone={ASSESSMENT_STATUS[assessment.status].tone}
                          />
                        </Link>
                      ) : (
                        /* Not a gap on its own — a low-risk use is defensibly
                         * covered by its system's assessment. The tier in the
                         * column beside it is what makes this cell worth
                         * reading. */
                        <span className="text-[0.75rem] text-muted-foreground/60">
                          Covered by system
                        </span>
                      )}
                    </td>
                    <td className={cn(TD, "text-right tabular text-muted-foreground")}>
                      {useCase.approxUsers > 0 ? useCase.approxUsers : "—"}
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
