"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";

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
import { riskScore } from "@/lib/ams/fixtures/registers";
import { riskBand, RISK_STATUS, TREATMENT } from "@/lib/ams/risk-scale";
import { TONE_TEXT } from "@/lib/ams/tone";
import type { Risk } from "@/lib/ams/types";
import { Checkbox } from "@/components/ui/checkbox";
import { RECORD_KINDS } from "@/lib/ams/record-kinds";
import { AddRiskDialog } from "./add-risk-dialog";
import { EmptyState } from "./empty-state";
import { ImportDialog } from "./import-dialog";
import {
  RegisterActions,
  RegisterCreateButton,
  RegisterExportButton,
  RegisterImportButton,
} from "./register-actions";
import { useSelection } from "./use-selection";
import { useRouter } from "next/navigation";
import { StatusBadge } from "./status-badge";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * The risk register.
 *
 * Sorted by **residual** score descending, not inherent. Inherent is what the
 * risk would be if nobody did anything, which is a useful number exactly once —
 * when you decide what to do. Residual is what you are actually carrying, and a
 * register ordered by inherent puts the well-treated risks at the top and the
 * ones still hurting you halfway down.
 *
 * The column that earns its place is the last one: who accepted what remains.
 * Every risk here has an owner, because owners are easy. Four have no acceptor,
 * which is an open internal audit finding in this fixture set and the honest
 * state of most registers — treatment gets done, and nobody senior ever signs
 * for the residue.
 */

const TH =
  "sticky top-0 z-10 bg-background border-b border-border px-3 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const TD = "border-b border-border/60 px-3 py-2.5 align-top";

const LENSES: Record<string, { label: string; match: (risk: Risk) => boolean }> = {
  unaccepted: {
    label: "Residual not accepted by anyone",
    match: (risk) => risk.acceptedById === null,
  },
  high: {
    label: "High residual",
    match: (risk) => riskScore(risk.residualLikelihood, risk.residualImpact) >= 12,
  },
  untreated: {
    label: "Treatment has not moved the number",
    match: (risk) =>
      riskScore(risk.residualLikelihood, risk.residualImpact) >=
      riskScore(risk.inherentLikelihood, risk.inherentImpact),
  },
};

export function RiskRegister() {
  const { personById, systemById, getUseCase, underminingFindings, risks: RISKS } = useWorkspace();
  const params = useSearchParams();

  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<string | null>(params.get("lens"));
  const [status, setStatus] = useState<Risk["status"] | "all">(
    (params.get("status") as Risk["status"]) ?? "all",
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const router = useRouter();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return RISKS.filter((risk) => {
      if (lens && !LENSES[lens]?.match(risk)) return false;
      if (status !== "all" && risk.status !== status) return false;
      if (!q) return true;
      const system = risk.systemId ? systemById(risk.systemId)?.name : "";
      return `${risk.title} ${system} ${personById(risk.ownerId).name}`
        .toLowerCase()
        .includes(q);
    }).sort(
      (a, b) =>
        riskScore(b.residualLikelihood, b.residualImpact) -
        riskScore(a.residualLikelihood, a.residualImpact),
    );
  }, [RISKS, personById, systemById, query, lens, status]);

  /*
   * The tick boxes. `RISKS` rather than `rows` is the first argument on
   * purpose: a risk ticked before a lens was applied is still selected and
   * still going, and the confirmation still names it.
   */
  const selection = useSelection(RISKS, rows);

  /* Risks whose treatment has an open finding against it. */
  const undermined = useMemo(
    () =>
      new Map(
        RISKS.map((risk) => [risk.id, underminingFindings(risk.id).length] as const),
      ),
    [RISKS, underminingFindings],
  );

  const unaccepted = RISKS.filter((r) => r.acceptedById === null).length;
  const high = RISKS.filter(
    (r) => riskScore(r.residualLikelihood, r.residualImpact) >= 12,
  ).length;
  const filtered = Boolean(lens) || status !== "all" || query !== "";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">Risk register</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Ordered by what we are still carrying, not by what it would have been
          untreated. {RISKS.length} risks,{" "}
          <span className="text-warn">{high} at high residual</span>,{" "}
          <span className={cn(unaccepted > 0 && "text-warn")}>
            {unaccepted} with nobody named as having accepted the residue
          </span>
          .
        </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RegisterImportButton
            def={RECORD_KINDS.risk}
            action="import risks from a spreadsheet"
            onClick={() => setImportOpen(true)}
          />
          <RegisterExportButton
            def={RECORD_KINDS.risk}
            onClick={() => setExportOpen(true)}
          />
          <RegisterCreateButton
            def={RECORD_KINDS.risk}
            label="Add risk"
            action="add a risk"
            onClick={() => setAddOpen(true)}
          />
        </div>
      </header>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        def={RECORD_KINDS.risk}
        onImported={() => router.refresh()}
      />

      {/* The new row arrives from the next server render rather than being
        * spliced in here — see `create-dialog.tsx` for why a register never
        * shows a record it has not been told was saved. */}
      <AddRiskDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => router.refresh()}
      />

      <RegisterActions
        def={RECORD_KINDS.risk}
        selection={selection}
        shown={rows}
        total={RISKS.length}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        deleteNote="Their treatment history and any findings linked to them go out of view with them, and the register's counts recompute without them."
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
            placeholder="Search risk, system, owner…"
            className="h-8 pl-8 text-sm"
            aria-label="Search risks"
          />
        </div>

        <Select
          value={status}
          onValueChange={(next) => setStatus((next ?? "all") as Risk["status"] | "all")}
        >
          <SelectTrigger size="sm" aria-label="Status" className="font-normal">
            <SelectValue>
              {status === "all" ? "All statuses" : RISK_STATUS[status].label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(RISK_STATUS) as Risk["status"][]).map((value) => (
              <SelectItem key={value} value={value}>
                {RISK_STATUS[value].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {lens && LENSES[lens] && (
          <Button variant="ghost" size="xs" onClick={() => setLens(null)}>
            <X aria-hidden />
            {LENSES[lens].label}
          </Button>
        )}

        {filtered && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setLens(null);
              setStatus("all");
              setQuery("");
            }}
          >
            <X aria-hidden />
            Clear
          </Button>
        )}

        <p className="ml-auto text-xs tabular text-muted-foreground">
          {rows.length} of {RISKS.length} risks
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing matches these filters"
              body="Every risk is still here — this combination just excludes all of them."
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
                          ? "Deselect the risks in view"
                          : "Select the risks in view"
                      }
                    />
                    Risk
                  </div>
                </th>
                <th className={TH}>Linked to</th>
                <th className={cn(TH, "text-right")}>Inherent</th>
                <th className={TH}>Treatment</th>
                <th className={cn(TH, "text-right")}>Residual</th>
                <th className={TH}>Owner</th>
                <th className={TH}>Residual accepted by</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((risk) => {
                const inherent = riskScore(risk.inherentLikelihood, risk.inherentImpact);
                const residual = riskScore(risk.residualLikelihood, risk.residualImpact);
                const system = risk.systemId ? systemById(risk.systemId) : undefined;
                const useCase = risk.useCaseId ? getUseCase(risk.useCaseId) : undefined;

                return (
                  <tr
                    key={risk.id}
                    className={cn(
                      "group transition-colors hover:bg-secondary/40",
                      selection.isSelected(risk.id) && "bg-secondary/60",
                    )}
                  >
                    <td className={cn(TD, "max-w-md")}>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          checked={selection.isSelected(risk.id)}
                          onCheckedChange={() => selection.toggle(risk.id)}
                          aria-label={`Select ${risk.title}`}
                        />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/risks/${risk.id}`}
                            className="font-medium whitespace-normal underline-offset-4 group-hover:underline"
                          >
                            {risk.title}
                          </Link>
                        </div>
                      </div>
                    </td>
                    {/*
                      Every linked object is a link. A risk register whose
                      "linked to" column is text makes you go and find the system
                      yourself, which is the moment people stop using the
                      register and go back to the spreadsheet.
                    */}
                    <td className={cn(TD, "text-[0.8125rem] text-muted-foreground")}>
                      {system ? (
                        <Link
                          href={`/inventory/${system.id}`}
                          className="block truncate underline-offset-4 hover:text-foreground hover:underline"
                        >
                          {system.name}
                        </Link>
                      ) : (
                        <span className="block text-muted-foreground/60">
                          Organisation-wide
                        </span>
                      )}
                      {useCase && (
                        <Link
                          href={`/use-cases/${useCase.id}`}
                          className="block truncate text-[0.75rem] text-muted-foreground/60 underline-offset-4 hover:text-foreground hover:underline"
                        >
                          {useCase.name}
                        </Link>
                      )}
                      <Link
                        href={`/risks/${risk.id}`}
                        className="block text-[0.75rem] text-muted-foreground/50 underline-offset-4 hover:text-foreground hover:underline"
                      >
                        {risk.controlIds.length} control
                        {risk.controlIds.length === 1 ? "" : "s"}
                      </Link>
                      {undermined.get(risk.id) ? (
                        <span className="mt-0.5 block text-[0.75rem] text-warn">
                          {undermined.get(risk.id)} open finding
                          {undermined.get(risk.id) === 1 ? "" : "s"} against the
                          treatment
                        </span>
                      ) : null}
                    </td>
                    <td className={cn(TD, "text-right")}>
                      <Score value={inherent} muted />
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <span className="text-[0.8125rem] text-muted-foreground">
                        {TREATMENT[risk.treatment].label}
                      </span>
                      <ArrowRight
                        className="ml-1 inline size-3 text-muted-foreground/30"
                        aria-hidden
                      />
                    </td>
                    <td className={cn(TD, "text-right")}>
                      <Score value={residual} />
                    </td>
                    <td className={cn(TD, "text-[0.8125rem] text-muted-foreground")}>
                      {personById(risk.ownerId).name}
                    </td>
                    <td className={cn(TD, "text-[0.8125rem]")}>
                      {risk.acceptedById ? (
                        <span className="text-muted-foreground">
                          {personById(risk.acceptedById).name}
                        </span>
                      ) : (
                        <span className="text-warn">Nobody</span>
                      )}
                    </td>
                    <td className={TD}>
                      <StatusBadge
                        label={RISK_STATUS[risk.status].label}
                        tone={RISK_STATUS[risk.status].tone}
                      />
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

/**
 * A likelihood × impact score.
 *
 * The number is always present and the colour only bands it — a monochrome
 * screenshot of this table still ranks correctly, which is the test.
 */
function Score({ value, muted = false }: { value: number; muted?: boolean }) {
  const band = riskBand(value);
  return (
    <span
      className={cn(
        "tabular text-sm",
        muted ? "text-muted-foreground/60" : TONE_TEXT[band.tone],
      )}
      title={`${band.label} — ${value} of 25`}
    >
      {value}
    </span>
  );
}
