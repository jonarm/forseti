"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  FINDING_SEVERITY,
  FINDING_SOURCE,
  FINDING_STATUS,
  findingAge,
} from "@/lib/ams/fixtures/registers";
import { formatDate, isOverdue } from "@/lib/ams/labels";
import type { Finding, FindingSource } from "@/lib/ams/types";
import { Checkbox } from "@/components/ui/checkbox";
import { RECORD_KINDS } from "@/lib/ams/record-kinds";
import { EmptyState } from "./empty-state";
import { RaiseFindingDialog } from "./raise-finding-dialog";
import { ImportDialog } from "./import-dialog";
import {
  RegisterActions,
  RegisterCreateButton,
  RegisterExportButton,
  RegisterImportButton,
} from "./register-actions";
import { useSelection } from "./use-selection";
import { useRouter } from "next/navigation";
import { Ref, StatusBadge } from "./status-badge";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * Findings, and where they came from.
 *
 * `source` is a column rather than a sentence in the summary because the mix is
 * the most useful thing on the screen. A register where everything was raised
 * by an external auditor describes a management system that never finds its own
 * problems — which is itself a nonconformity against the internal audit and
 * monitoring clauses, and one that can only be spotted if source is countable.
 *
 * The header therefore leads with the split. Six of these nine were found
 * before anyone outside the organisation asked, which is the number a
 * certification body reads as evidence the system is alive.
 */

const TH =
  "sticky top-0 z-10 bg-background border-b border-border px-3 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const TD = "border-b border-border/60 px-3 py-2.5 align-top";

export function FindingRegister() {
  const { personById, systemById, controlById, findings: FINDINGS } = useWorkspace();
  const params = useSearchParams();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Finding["status"] | "all" | "open">(
    (params.get("status") as Finding["status"]) ?? "open",
  );
  const [source, setSource] = useState<FindingSource | "all" | "external">(
    (params.get("source") as FindingSource) ?? "all",
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FINDINGS.filter((f) => {
      if (status === "open" && f.status === "closed") return false;
      if (status !== "all" && status !== "open" && f.status !== status) return false;
      if (source === "external" && !FINDING_SOURCE[f.source].external) return false;
      if (source !== "all" && source !== "external" && f.source !== source) return false;
      if (!q) return true;
      const system = f.systemId ? systemById(f.systemId)?.name ?? "" : "";
      return `${f.title} ${f.raisedBy} ${system}`.toLowerCase().includes(q);
    }).sort((a, b) => {
      const aLate = a.status !== "closed" && isOverdue(a.dueAt);
      const bLate = b.status !== "closed" && isOverdue(b.dueAt);
      if (aLate !== bLate) return aLate ? -1 : 1;
      return a.dueAt.localeCompare(b.dueAt);
    });
  }, [FINDINGS, systemById, query, status, source]);

  /*
   * The tick boxes. `FINDINGS` rather than `rows`: a finding ticked before the
   * status filter moved is still selected and still going, and the
   * confirmation still names it.
   */
  const selection = useSelection(FINDINGS, rows);

  const open = FINDINGS.filter((f) => f.status !== "closed");
  const late = open.filter((f) => isOverdue(f.dueAt)).length;
  const external = FINDINGS.filter((f) => FINDING_SOURCE[f.source].external).length;
  const ourselves = FINDINGS.length - external;
  const filtered = status !== "open" || source !== "all" || query !== "";
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">Findings</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {open.length} open
          {late > 0 && (
            <>
              , <span className="text-critical">{late} past due</span>
            </>
          )}
          . <span className="text-foreground">{ourselves} of {FINDINGS.length}</span> were
          found by us before anyone outside asked — the ratio a certification
          body reads as evidence the management system is actually running,
          rather than being run at by auditors.
        </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RegisterImportButton
            def={RECORD_KINDS.finding}
            action="import findings from a spreadsheet"
            onClick={() => setImportOpen(true)}
          />
          <RegisterExportButton
            def={RECORD_KINDS.finding}
            onClick={() => setExportOpen(true)}
          />
          <RegisterCreateButton
            def={RECORD_KINDS.finding}
            label="Raise finding"
            action="raise a finding"
            onClick={() => setRaiseOpen(true)}
          />
        </div>
      </header>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        def={RECORD_KINDS.finding}
        onImported={() => router.refresh()}
      />

      {/* The new row arrives from the next server render rather than being
        * spliced in here — see `create-dialog.tsx`. */}
      <RaiseFindingDialog
        open={raiseOpen}
        onOpenChange={setRaiseOpen}
        onRaised={() => router.refresh()}
      />

      <RegisterActions
        def={RECORD_KINDS.finding}
        selection={selection}
        shown={rows}
        total={FINDINGS.length}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        deleteNote="Their root cause, corrective action and any links to risks go out of view with them, and the open and overdue counts recompute without them."
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
            placeholder="Search finding, raiser, system…"
            className="h-8 pl-8 text-sm"
            aria-label="Search findings"
          />
        </div>

        <Select
          value={status}
          onValueChange={(next) =>
            setStatus((next ?? "open") as Finding["status"] | "all" | "open")
          }
        >
          <SelectTrigger size="sm" aria-label="Status" className="font-normal">
            <SelectValue>
              {status === "open"
                ? "Open findings"
                : status === "all"
                  ? "All statuses"
                  : FINDING_STATUS[status].label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open findings</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(FINDING_STATUS) as Finding["status"][]).map((value) => (
              <SelectItem key={value} value={value}>
                {FINDING_STATUS[value].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={source}
          onValueChange={(next) =>
            setSource((next ?? "all") as FindingSource | "all" | "external")
          }
        >
          <SelectTrigger size="sm" aria-label="Source" className="font-normal">
            <SelectValue>
              {source === "all"
                ? "All sources"
                : source === "external"
                  ? "Raised outside"
                  : FINDING_SOURCE[source].label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="external">Raised outside</SelectItem>
            {(Object.keys(FINDING_SOURCE) as FindingSource[]).map((value) => (
              <SelectItem key={value} value={value}>
                {FINDING_SOURCE[value].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtered && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setStatus("open");
              setSource("all");
              setQuery("");
            }}
          >
            <X aria-hidden />
            Reset
          </Button>
        )}

        <p className="ml-auto text-xs tabular text-muted-foreground">
          {rows.length} of {FINDINGS.length} findings
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing matches these filters"
              body="Every finding is still here — this combination just excludes all of them."
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
                          ? "Deselect the findings in view"
                          : "Select the findings in view"
                      }
                    />
                    Finding
                  </div>
                </th>
                <th className={TH}>Source</th>
                <th className={TH}>Raised by</th>
                <th className={TH}>Against</th>
                <th className={TH}>Severity</th>
                <th className={TH}>Owner</th>
                <th className={TH}>Status</th>
                <th className={cn(TH, "text-right")}>Age</th>
                <th className={cn(TH, "text-right")}>Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((finding) => {
                const system = finding.systemId ? systemById(finding.systemId) : undefined;
                const control = finding.controlId ? controlById(finding.controlId) : undefined;
                const late = finding.status !== "closed" && isOverdue(finding.dueAt);
                const src = FINDING_SOURCE[finding.source];

                return (
                  <tr
                    key={finding.id}
                    className={cn(
                      "group transition-colors hover:bg-secondary/40",
                      selection.isSelected(finding.id) && "bg-secondary/60",
                    )}
                  >
                    <td className={cn(TD, "max-w-sm")}>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          checked={selection.isSelected(finding.id)}
                          onCheckedChange={() => selection.toggle(finding.id)}
                          aria-label={`Select ${finding.title}`}
                        />
                        <Link
                          href={`/findings/${finding.id}`}
                          className="min-w-0 flex-1 font-medium whitespace-normal underline-offset-4 group-hover:underline"
                        >
                          {finding.title}
                        </Link>
                      </div>
                    </td>
                    <td className={TD}>
                      <StatusBadge
                        label={src.label}
                        tone={src.external ? "warn" : "neutral"}
                        title={src.blurb}
                      />
                    </td>
                    <td className={cn(TD, "max-w-56 text-[0.8125rem] text-muted-foreground")}>
                      <span className="block whitespace-normal">{finding.raisedBy}</span>
                    </td>
                    <td className={cn(TD, "text-[0.8125rem] text-muted-foreground")}>
                      {system ? (
                        <span className="block">{system.name}</span>
                      ) : (
                        <span className="block text-muted-foreground/60">
                          Organisation-wide
                        </span>
                      )}
                      {control && <Ref>{control.officialRef}</Ref>}
                    </td>
                    <td className={TD}>
                      <StatusBadge
                        label={FINDING_SEVERITY[finding.severity].label}
                        tone={FINDING_SEVERITY[finding.severity].tone}
                      />
                    </td>
                    <td className={cn(TD, "text-[0.8125rem] text-muted-foreground")}>
                      {personById(finding.ownerId).name}
                    </td>
                    <td className={TD}>
                      <StatusBadge
                        label={FINDING_STATUS[finding.status].label}
                        tone={FINDING_STATUS[finding.status].tone}
                        title={FINDING_STATUS[finding.status].blurb}
                      />
                    </td>
                    <td className={cn(TD, "text-right tabular text-muted-foreground")}>
                      {findingAge(finding)}d
                    </td>
                    <td
                      className={cn(
                        TD,
                        "text-right tabular",
                        late ? "text-critical" : "text-muted-foreground",
                      )}
                    >
                      {finding.status === "closed" ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        formatDate(finding.dueAt)
                      )}
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
