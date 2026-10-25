"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";

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
import { REQUEST_STATUS, daysWaiting } from "@/lib/ams/fixtures/requests";
import { REVIEW_TYPE, triage } from "@/lib/ams/fixtures/intake";
import { ORIGIN, formatDate } from "@/lib/ams/labels";
import type { RequestStatus, SystemOrigin } from "@/lib/ams/types";
import { Checkbox } from "@/components/ui/checkbox";
import { RECORD_KINDS } from "@/lib/ams/record-kinds";
import { EmptyState } from "./empty-state";
import { RegisterActions, RegisterExportButton } from "./register-actions";
import { useSelection } from "./use-selection";
import { Ref, StatusBadge } from "./status-badge";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * The governance lead's actual home screen.
 *
 * A queue answers one question before any other: what is waiting on me, and how
 * long has it been waiting. So the default filter is open requests only, the
 * ageing column is always visible, and anything past its service level is the
 * one thing on the row wearing colour.
 *
 * The review type column shows the *recommendation* for anything not yet
 * decided and the *decision* for anything that is — computed by running the
 * triage rules here rather than read from a stored field, for the same reason
 * coverage is derived. A recommendation frozen at submission time tells you
 * what the rules used to say, which is worse than useless when someone is
 * trying to work out whether an old decision still holds.
 */

const TH =
  "sticky top-0 z-10 bg-background border-b border-border px-3 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const TD = "border-b border-border/60 px-3 py-2.5 whitespace-nowrap";

/** Days after which an open request is late, by the review type it is heading for. */
const SLA_DAYS: Record<string, number> = { endorsement: 10, noting: 5 };

export function RequestQueue() {
  const { personById, requests } = useWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<RequestStatus | "all" | "open">("open");
  const [origin, setOrigin] = useState<SystemOrigin | "all">("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((request) => {
      if (status === "open" && !REQUEST_STATUS[request.status].open) return false;
      if (status !== "all" && status !== "open" && request.status !== status) return false;
      if (origin !== "all" && request.submission.origin !== origin) return false;
      if (!q) return true;
      return [
        request.reference,
        request.submission.name,
        request.submission.businessUnit,
        personById(request.submittedById).name,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [requests, personById, query, status, origin]);

  const open = requests.filter((r) => REQUEST_STATUS[r.status].open);
  const [exportOpen, setExportOpen] = useState(false);

  /* The tick boxes. `requests` rather than `rows`: a request ticked before the
   * status filter moved is still selected and still going. */
  const selection = useSelection(requests, rows);
  const late = open.filter((r) => {
    const type = r.reviewType ?? triage(r.submission).suggested;
    return daysWaiting(r) > (SLA_DAYS[type] ?? 10);
  });
  const filtered = status !== "open" || origin !== "all" || query !== "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Intake &amp; triage</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every request to use AI, and what happened to it.{" "}
            <span className="text-foreground">{open.length} open</span>
            {late.length > 0 && (
              <>
                , <span className="text-critical">{late.length} past its service level</span>
              </>
            )}
            . A rejected request never becomes an inventory row — that is why a
            request is its own record.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RegisterExportButton
            def={RECORD_KINDS.intake}
            onClick={() => setExportOpen(true)}
          />
          <Button size="sm" render={<Link href="/intake/new" />}>
            <Plus aria-hidden />
            New request
          </Button>
        </div>
      </header>

      <RegisterActions
        def={RECORD_KINDS.intake}
        selection={selection}
        shown={rows}
        total={requests.length}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        deleteNote="The record that somebody asked goes out of view with them. Any inventory row a request produced stays — the system exists whether or not the request that proposed it does."
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
            placeholder="Search reference, request, requester…"
            className="h-8 pl-8 text-sm"
            aria-label="Search requests"
          />
        </div>

        <Filter
          label="Status"
          value={status}
          onChange={(v) => setStatus(v as RequestStatus | "all" | "open")}
          options={[
            ["open", "Open requests"],
            ["all", "All statuses"],
            ...(Object.keys(REQUEST_STATUS) as RequestStatus[]).map(
              (s) => [s, REQUEST_STATUS[s].label] as [string, string],
            ),
          ]}
        />
        <Filter
          label="Origin"
          value={origin}
          onChange={(v) => setOrigin(v as SystemOrigin | "all")}
          options={[
            ["all", "All origins"],
            ...(Object.keys(ORIGIN) as SystemOrigin[]).map(
              (o) => [o, ORIGIN[o].label] as [string, string],
            ),
          ]}
        />

        {filtered && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setStatus("open");
              setOrigin("all");
              setQuery("");
            }}
          >
            <X aria-hidden />
            Reset
          </Button>
        )}

        <p className="ml-auto text-xs tabular text-muted-foreground">
          {rows.length} of {requests.length} requests
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing matches these filters"
              body="Every request is still here — this combination of search and filters just excludes all of them. Reset to see the open queue."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setStatus("open");
                    setOrigin("all");
                    setQuery("");
                  }}
                >
                  Reset filters
                </Button>
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
                          ? "Deselect the requests in view"
                          : "Select the requests in view"
                      }
                    />
                    Ref
                  </div>
                </th>
                <th className={TH}>Request</th>
                <th className={TH}>Business unit</th>
                <th className={TH}>Origin</th>
                <th className={TH}>Requester</th>
                <th className={TH}>Submitted</th>
                <th className={TH}>Review type</th>
                <th className={TH}>Status</th>
                <th className={cn(TH, "text-right")}>Waiting</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((request) => {
                const suggested = triage(request.submission).suggested;
                const type = request.reviewType ?? suggested;
                const isOpen = REQUEST_STATUS[request.status].open;
                const days = daysWaiting(request);
                const overdue = isOpen && days > (SLA_DAYS[type] ?? 10);

                return (
                  <tr
                    key={request.id}
                    className={cn(
                      "group transition-colors hover:bg-secondary/40",
                      selection.isSelected(request.id) && "bg-secondary/60",
                    )}
                  >
                    <td className={cn(TD, "text-muted-foreground")}>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={selection.isSelected(request.id)}
                          onCheckedChange={() => selection.toggle(request.id)}
                          aria-label={`Select ${request.reference}`}
                        />
                        <Ref>{request.reference}</Ref>
                      </div>
                    </td>
                    <td className={TD}>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/intake/${request.id}`}
                          className="font-medium underline-offset-4 group-hover:underline"
                        >
                          {request.submission.name}
                        </Link>
                        {request.createdSystemId && (
                          <Link
                            href={`/inventory/${request.createdSystemId}`}
                            className="rounded border border-border px-1 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                            title="This request produced an inventory row"
                          >
                            In inventory
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className={cn(TD, "text-muted-foreground")}>
                      {request.submission.businessUnit}
                    </td>
                    <td className={cn(TD, "text-muted-foreground")}>
                      {request.submission.origin
                        ? ORIGIN[request.submission.origin].label
                        : "—"}
                    </td>
                    <td className={cn(TD, "text-muted-foreground")}>
                      {personById(request.submittedById).name}
                    </td>
                    <td className={cn(TD, "tabular text-muted-foreground")}>
                      {formatDate(request.submittedAt)}
                    </td>
                    <td className={cn(TD, "text-muted-foreground")}>
                      {REVIEW_TYPE[type].label}
                      {isOpen && !request.reviewType && (
                        <span className="ml-1.5 text-muted-foreground/50">suggested</span>
                      )}
                    </td>
                    <td className={TD}>
                      <StatusBadge
                        label={REQUEST_STATUS[request.status].label}
                        tone={REQUEST_STATUS[request.status].tone}
                      />
                    </td>
                    <td
                      className={cn(
                        TD,
                        "text-right tabular",
                        overdue ? "text-critical" : "text-muted-foreground",
                      )}
                    >
                      {isOpen ? `${days}d` : <span className="text-muted-foreground/40">—</span>}
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

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  const current = options.find(([v]) => v === value);
  return (
    <Select value={value} onValueChange={(next) => onChange(next ?? "all")}>
      <SelectTrigger size="sm" aria-label={label} className="font-normal">
        <SelectValue>{current?.[1] ?? label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
