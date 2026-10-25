"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowUpDown, Plus, Search, Trash2, Upload, X } from "lucide-react";

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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ASSESSMENT_STATUS,
  DISCOVERED_VIA,
  LIFECYCLE,
  ORIGIN,
  RISK_TIER,
  formatDate,
  isOverdue,
} from "@/lib/ams/labels";
import { coverageTone, TONE_FILL, TONE_TEXT, TONE_TRACK } from "@/lib/ams/tone";
import type { AISystem, LifecycleStage, RiskTier, SystemOrigin } from "@/lib/ams/types";
import { RegisterActions, RegisterExportButton } from "./register-actions";
import { useSelection } from "./use-selection";
import { ImportDialog } from "./import-dialog";
import { RegisterSystemDialog } from "./register-system-dialog";
import { StatusBadge } from "./status-badge";
import { refusalNote } from "@/lib/permissions";
import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";
import { RECORD_KINDS } from "@/lib/ams/record-kinds";

/**
 * The register, and the screen the product is judged on.
 *
 * Everything here is subordinate to reading a row quickly. One line per system,
 * no wrapping, numbers right-aligned and tabular, and colour only on the three
 * columns where a value means somebody has to act — risk tier, assessment
 * status and coverage. Origin and lifecycle stay grey on purpose: a system at
 * pilot stage is not a warning, and if everything is coloured then the overdue
 * row stops being visible, which is the only row that matters.
 *
 * **Every row comes from the server.** Registering and importing both persist,
 * so the list is the prop and never a copy of it held in state: state seeded
 * from props ignores every later render, which is exactly how a saved system
 * fails to appear until a hard reload. Both dialogs write, then this refreshes,
 * and the new rows arrive in `initialSystems` like any other.
 */

type SortKey = "name" | "useCases" | "approxUsers" | "coverage" | "nextReviewDate";
type Filters = {
  origin: SystemOrigin | "all";
  riskTier: RiskTier | "all";
  lifecycle: LifecycleStage | "all";
  genAi: "all" | "yes" | "no";
};

const NO_FILTERS: Filters = {
  origin: "all",
  riskTier: "all",
  lifecycle: "all",
  genAi: "all",
};

const TH =
  "sticky top-0 z-10 bg-background px-3 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap border-b border-border";
const TD = "px-3 py-2 whitespace-nowrap";

export function InventoryTable({ initialSystems }: { initialSystems: AISystem[] }) {
  const { personById, coverageForSystem, getUseCasesForSystem } = useWorkspace();
  const { registerSystems, viewTrash } = usePermissions();
  const router = useRouter();
  // Filters seed from the URL so the dashboard can link into a filtered view and
  // a filtered inventory is a link somebody can send. They stay local state
  // after that: this table is edited constantly during a demo, and pushing every
  // keystroke into the URL would fight the browser's back button.
  const params = useSearchParams();

  const systems = initialSystems;
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(() => ({
    origin: (params.get("origin") as Filters["origin"]) ?? "all",
    riskTier: (params.get("risk") as Filters["riskTier"]) ?? "all",
    lifecycle: (params.get("lifecycle") as Filters["lifecycle"]) ?? "all",
    genAi: (params.get("genai") as Filters["genAi"]) ?? "all",
  }));
  /** Set by the dashboard when it links at the systems nobody registered. */
  const [discoveredOnly, setDiscoveredOnly] = useState(params.get("discovered") === "1");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  /** Rows added in this session, marked so the demo can point at what changed. */
  const [added, setAdded] = useState<Set<string>>(new Set());

  const activeFilters =
    (Object.keys(filters) as (keyof Filters)[]).filter((k) => filters[k] !== "all").length +
    (discoveredOnly ? 1 : 0);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    const matched = systems.filter((s) => {
      if (filters.origin !== "all" && s.origin !== filters.origin) return false;
      if (filters.riskTier !== "all" && s.riskTier !== filters.riskTier) return false;
      if (filters.lifecycle !== "all" && s.lifecycleStage !== filters.lifecycle)
        return false;
      if (filters.genAi !== "all" && s.isGenAi !== (filters.genAi === "yes"))
        return false;
      if (
        discoveredOnly &&
        (!s.discoveredVia || s.discoveredVia === "manual" || s.discoveredVia === "import")
      )
        return false;
      if (!q) return true;
      // Search covers what someone actually types: the tool, who sold it, who
      // owns it, and the team that uses it.
      return [s.name, s.vendor, s.businessUnit, personById(s.ownerId).name]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });

    const direction = sort.dir === "asc" ? 1 : -1;
    // Coverage is derived from the applicability join rather than stored on the
    // row, so sorting has to compute it the same way the cell renders it.
    const key = (s: AISystem) => {
      if (sort.key === "coverage") return coverageForSystem(s.id).percent;
      if (sort.key === "useCases") return getUseCasesForSystem(s.id).length;
      return s[sort.key];
    };

    return [...matched].sort((a, b) => {
      const l = key(a);
      const r = key(b);
      if (typeof l === "number" && typeof r === "number") return (l - r) * direction;
      return String(l).localeCompare(String(r)) * direction;
    });
  }, [
    systems,
    personById,
    coverageForSystem,
    getUseCasesForSystem,
    query,
    filters,
    discoveredOnly,
    sort,
  ]);

  /**
   * The tick boxes, and everything derived from them.
   *
   * `systems` rather than `rows` is the first argument on purpose: a row ticked
   * before a filter was applied is still selected and still going, and the
   * confirmation still names it. The hook derives the records from that list
   * rather than counting the id set, so a delete followed by a refresh cannot
   * leave a phantom count behind — see `use-selection.ts` for the rest.
   */
  const selection = useSelection(systems, rows);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  }

  /**
   * New rows are already in the database by the time this runs, so they are
   * fetched rather than pushed: `router.refresh()` re-runs the page and they
   * arrive through `initialSystems` carrying whatever the server actually
   * stored. All this does is make sure they can be seen — marked as new, with
   * anything that would filter them out cleared, because a new row a filter
   * hides looks exactly like nothing happened.
   */
  function arrived(ids: string[]) {
    setAdded((prev) => new Set([...prev, ...ids]));
    setFilters(NO_FILTERS);
    setDiscoveredOnly(false);
    setQuery("");
    router.refresh();
  }

  const genAiCount = systems.filter((s) => s.isGenAi).length;
  const unassessed = systems.filter((s) => s.assessmentStatus === "not_started").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">AI Inventory</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every AI system the organisation runs, however it arrived.{" "}
            <span className="text-foreground">{systems.length} systems</span>,{" "}
            {genAiCount} generative, {unassessed} never assessed.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Absent rather than disabled — the one deliberate exception to this
            * screen's "refused means disabled and explained" rule. A disabled
            * Trash button advertises that systems are being destroyed on a
            * schedule to the roles specifically not being shown that yet, which
            * is a worse answer than no button. The page refuses on its own too;
            * a hidden link is not a gate. */}
          <RegisterExportButton
            def={RECORD_KINDS.system}
            onClick={() => setExportOpen(true)}
          />
          {viewTrash && (
            <Button
              variant="ghost"
              size="sm"
              render={<Link href="/trash" />}
            >
              <Trash2 aria-hidden />
              Trash
            </Button>
          )}
          <ImportButton
            allowed={registerSystems}
            onClick={() => setImportOpen(true)}
          />
          <RegisterButton
            allowed={registerSystems}
            onClick={() => setRegisterOpen(true)}
          />
        </div>
      </header>

      <RegisterActions
        def={RECORD_KINDS.system}
        selection={selection}
        shown={rows}
        total={systems.length}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        deleteNote="Their use cases, risks and control claims go out of view with them, and the inventory's coverage figures recompute without them."
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
            placeholder="Search system, vendor, owner…"
            className="h-8 pl-8 text-sm"
            aria-label="Search the inventory"
          />
        </div>

        <FilterSelect
          label="Origin"
          value={filters.origin}
          onChange={(v) => setFilters((f) => ({ ...f, origin: v as Filters["origin"] }))}
          options={[
            ["all", "All origins"],
            ...(Object.keys(ORIGIN) as SystemOrigin[]).map(
              (o) => [o, ORIGIN[o].label] as [string, string],
            ),
          ]}
        />
        <FilterSelect
          label="Risk"
          value={filters.riskTier}
          onChange={(v) => setFilters((f) => ({ ...f, riskTier: v as Filters["riskTier"] }))}
          options={[
            ["all", "All risk tiers"],
            ...(Object.keys(RISK_TIER) as RiskTier[]).map(
              (t) => [t, `${RISK_TIER[t].label} risk`] as [string, string],
            ),
          ]}
        />
        <FilterSelect
          label="Lifecycle"
          value={filters.lifecycle}
          onChange={(v) =>
            setFilters((f) => ({ ...f, lifecycle: v as Filters["lifecycle"] }))
          }
          options={[
            ["all", "All stages"],
            ...(Object.keys(LIFECYCLE) as LifecycleStage[]).map(
              (l) => [l, LIFECYCLE[l].label] as [string, string],
            ),
          ]}
        />
        <FilterSelect
          label="GenAI"
          value={filters.genAi}
          onChange={(v) => setFilters((f) => ({ ...f, genAi: v as Filters["genAi"] }))}
          options={[
            ["all", "Generative and not"],
            ["yes", "Generative only"],
            ["no", "Non-generative only"],
          ]}
        />

        {discoveredOnly && (
          <Button variant="ghost" size="xs" onClick={() => setDiscoveredOnly(false)}>
            <X aria-hidden />
            Found, not declared
          </Button>
        )}

        {(activeFilters > 0 || query) && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setFilters(NO_FILTERS);
              setDiscoveredOnly(false);
              setQuery("");
            }}
          >
            <X aria-hidden />
            Clear
          </Button>
        )}

        <p className="ml-auto text-xs text-muted-foreground tabular">
          {rows.length === systems.length
            ? `${systems.length} systems`
            : `${rows.length} of ${systems.length} systems`}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <SortableTh
                label="System"
                pinned
                leading={
                  /* Inside the pinned column rather than in one of its own.
                   * A separate sticky tick-box column has to be offset by
                   * exactly its own width, and a table with `auto` layout hands
                   * spare width to whichever columns it likes — on a wide
                   * screen the two pinned columns would drift apart and
                   * overlap. Here there is one sticky offset and nothing to
                   * keep in sync, and the boxes stay reachable while the table
                   * is scrolled sideways. */
                  <Checkbox
                    checked={selection.allShown}
                    indeterminate={!selection.allShown && selection.someShown}
                    disabled={rows.length === 0}
                    onCheckedChange={selection.toggleAllShown}
                    aria-label={
                      selection.allShown
                        ? "Deselect the systems in view"
                        : "Select the systems in view"
                    }
                  />
                }
                active={sort.key === "name"}
                dir={sort.dir}
                onClick={() => toggleSort("name")}
              />
              <th className={TH}>Vendor</th>
              <th className={TH}>Origin</th>
              <th className={cn(TH, "text-center")}>GenAI</th>
              <th className={TH}>Business unit</th>
              <th className={TH}>Owner</th>
              <th className={TH}>Stage</th>
              <th className={TH}>Risk tier</th>
              <th className={TH}>Assessment</th>
              {/* "Reaching", not "of": a purpose served by three tools counts
                * for all three, so this column no longer sums to the use case
                * register's own total. Both numbers are right and they are
                * answering different questions. */}
              <SortableTh
                label="Use cases reaching"
                align="right"
                active={sort.key === "useCases"}
                dir={sort.dir}
                onClick={() => toggleSort("useCases")}
              />
              <SortableTh
                label="Users"
                align="right"
                active={sort.key === "approxUsers"}
                dir={sort.dir}
                onClick={() => toggleSort("approxUsers")}
              />
              <SortableTh
                label="ISO 42001"
                align="right"
                active={sort.key === "coverage"}
                dir={sort.dir}
                onClick={() => toggleSort("coverage")}
              />
              <SortableTh
                label="Next review"
                align="right"
                active={sort.key === "nextReviewDate"}
                dir={sort.dir}
                onClick={() => toggleSort("nextReviewDate")}
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((system) => {
              const owner = personById(system.ownerId);
              const overdue = isOverdue(system.nextReviewDate);
              const useCases = getUseCasesForSystem(system.id).length;
              return (
                <tr
                  key={system.id}
                  className={cn(
                    "group border-b border-border/60 transition-colors hover:bg-secondary/40",
                    added.has(system.id) && "bg-primary/[0.06]",
                    selection.isSelected(system.id) && "bg-secondary/60",
                  )}
                >
                  <td
                    className={cn(
                      TD,
                      "sticky left-0 z-[1] border-b border-border/60 bg-background group-hover:bg-secondary/40",
                      added.has(system.id) && "bg-primary/[0.06]",
                      selection.isSelected(system.id) && "bg-secondary/60",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selection.isSelected(system.id)}
                        onCheckedChange={() => selection.toggle(system.id)}
                        aria-label={`Select ${system.name}`}
                      />
                      <Link
                        href={`/inventory/${system.id}`}
                        className="font-medium underline-offset-4 group-hover:underline"
                      >
                        {system.name}
                      </Link>
                      {system.discoveredVia &&
                        system.discoveredVia !== "manual" &&
                        system.discoveredVia !== "import" && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="rounded border border-warn/30 bg-warn/10 px-1 font-mono text-[0.6rem] uppercase tracking-wider text-warn">
                                  Found
                                </span>
                              }
                            />
                            <TooltipContent>
                              {DISCOVERED_VIA[system.discoveredVia]} — nobody registered it
                            </TooltipContent>
                          </Tooltip>
                        )}
                      {added.has(system.id) && (
                        <span className="rounded border border-brand/30 bg-brand/10 px-1 font-mono text-[0.6rem] uppercase tracking-wider text-brand">
                          New
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={cn(TD, "border-b border-border/60 text-muted-foreground")}>
                    {system.vendor}
                  </td>
                  <td className={cn(TD, "border-b border-border/60")}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="cursor-help text-muted-foreground">
                            {ORIGIN[system.origin].label}
                          </span>
                        }
                      />
                      <TooltipContent className="max-w-72">
                        {ORIGIN[system.origin].blurb}
                      </TooltipContent>
                    </Tooltip>
                  </td>
                  <td className={cn(TD, "border-b border-border/60 text-center")}>
                    {system.isGenAi ? (
                      <StatusBadge label="GenAI" tone="info" />
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>
                  <td className={cn(TD, "border-b border-border/60 text-muted-foreground")}>
                    {system.businessUnit}
                  </td>
                  <td className={cn(TD, "border-b border-border/60")}>
                    {system.ownerId ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="cursor-help text-muted-foreground">
                              {owner.name}
                            </span>
                          }
                        />
                        <TooltipContent>
                          {owner.role} · {owner.businessUnit}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-warn">Unassigned</span>
                    )}
                  </td>
                  <td className={cn(TD, "border-b border-border/60 text-muted-foreground")}>
                    {LIFECYCLE[system.lifecycleStage].label}
                  </td>
                  <td className={cn(TD, "border-b border-border/60")}>
                    <StatusBadge
                      label={RISK_TIER[system.riskTier].label}
                      tone={RISK_TIER[system.riskTier].tone}
                    />
                  </td>
                  <td className={cn(TD, "border-b border-border/60")}>
                    <StatusBadge
                      label={ASSESSMENT_STATUS[system.assessmentStatus].label}
                      tone={ASSESSMENT_STATUS[system.assessmentStatus].tone}
                    />
                  </td>
                  {/*
                    Zero renders as a zero, not as the dash `Users` uses for
                    nothing recorded. The two absences are different facts: a
                    system nobody counted the users of is unknown, a system with
                    no use cases is known to have none — and that one is a
                    governance gap somebody should see rather than skip over.
                  */}
                  <td
                    className={cn(
                      TD,
                      "border-b border-border/60 text-right tabular",
                      useCases === 0 ? "text-warn" : "text-muted-foreground",
                    )}
                  >
                    {useCases}
                  </td>
                  <td
                    className={cn(
                      TD,
                      "border-b border-border/60 text-right text-muted-foreground tabular",
                    )}
                  >
                    {system.approxUsers || "—"}
                  </td>
                  <td className={cn(TD, "border-b border-border/60")}>
                    <Coverage percent={coverageForSystem(system.id).percent} />
                  </td>
                  <td
                    className={cn(
                      TD,
                      "border-b border-border/60 text-right tabular",
                      overdue ? "text-critical" : "text-muted-foreground",
                    )}
                  >
                    {formatDate(system.nextReviewDate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
            <p className="text-sm font-medium">No systems match these filters</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {systems.length === 0
                ? "Nothing has been registered yet. Import the spreadsheet you already keep, or register the first system by hand."
                : "Every system is still here — the current combination of search and filters just excludes all of them."}
            </p>
            <div className="flex items-center gap-2 pt-1">
              {systems.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFilters(NO_FILTERS);
                    setDiscoveredOnly(false);
                    setQuery("");
                  }}
                >
                  Clear filters
                </Button>
              )}
              <ImportButton
                allowed={registerSystems}
                onClick={() => setImportOpen(true)}
              />
              <RegisterButton
                allowed={registerSystems}
                onClick={() => setRegisterOpen(true)}
              />
            </div>
          </div>
        )}
      </div>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        def={RECORD_KINDS.system}
        onImported={arrived}
      />
      <RegisterSystemDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        onRegistered={(system) => arrived([system.id])}
      />

    </div>
  );
}

/**
 * Register, refused or not.
 *
 * One component because the header and the empty state must not drift: this is
 * the affordance the register grew a permission for, and a second copy is a
 * second place for somebody to forget the gate. Refused means **disabled and
 * explained**, never absent — a missing button reads as a product that cannot
 * do the thing, and the person then goes looking for a feature rather than for
 * an admin.
 */
function RegisterButton({
  allowed,
  onClick,
}: {
  allowed: boolean;
  onClick: () => void;
}) {
  return (
    <GatedButton
      allowed={allowed}
      onClick={onClick}
      action="register an AI system"
      icon={<Plus aria-hidden />}
      label="Register AI system"
    />
  );
}

/**
 * Import, refused or not.
 *
 * Gated on the same flag as Register, because the import route
 * checks the same statement: importing a spreadsheet is registering nine
 * systems at once, and there is no coherent role that may do one and not the
 * other. The flag's name reads oddly here; a second flag off one statement
 * would read worse, and would drift.
 */
function ImportButton({
  allowed,
  onClick,
}: {
  allowed: boolean;
  onClick: () => void;
}) {
  return (
    <GatedButton
      allowed={allowed}
      onClick={onClick}
      action="import an AI inventory"
      icon={<Upload aria-hidden />}
      label="Import inventory"
      variant="outline"
    />
  );
}

/**
 * A button that says why it is refused.
 *
 * Refused means **disabled and explained**, never absent — a missing button
 * reads as a product that cannot do the thing, and the person then goes looking
 * for a feature rather than for an admin.
 */
function GatedButton({
  allowed,
  onClick,
  action,
  icon,
  label,
  variant,
}: {
  allowed: boolean;
  onClick: () => void;
  /** The phrase the route's own `requirePermission` call passes. */
  action: string;
  icon: React.ReactNode;
  label: string;
  variant?: "outline" | "destructive" | "ghost";
}) {
  if (allowed) {
    return (
      <Button variant={variant} size="sm" onClick={onClick}>
        {icon}
        {label}
      </Button>
    );
  }

  return (
    <Tooltip>
      {/* The span carries the hover, and the button is `aria-disabled` rather
        * than `disabled`: a genuinely disabled control fires no pointer events,
        * so the tooltip would never open — and a refusal nobody can read is a
        * bug with no symptom. `onClick` is simply not wired. */}
      <TooltipTrigger
        render={
          <span tabIndex={0} className="inline-flex">
            <Button
              variant={variant}
              size="sm"
              aria-disabled
              className="pointer-events-none opacity-50"
            >
              {icon}
              {label}
            </Button>
          </span>
        }
      />
      {/* Worded exactly like the 403 the route would return, so the sentence
        * somebody reads before clicking is the sentence they would get after. */}
      <TooltipContent className="max-w-72">{refusalNote(action)}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Coverage: the number first, the bar second.
 *
 * The bar is there to make a column of percentages scannable, not to be read
 * precisely — so it is short, and the figure beside it is what anyone quotes.
 */
function Coverage({ percent }: { percent: number }) {
  const tone = coverageTone(percent);
  return (
    <div className="flex items-center justify-end gap-2">
      <span className={cn("w-8 text-right text-xs tabular", TONE_TEXT[tone])}>
        {percent}%
      </span>
      <div className={cn("h-1 w-14 overflow-hidden rounded-full", TONE_TRACK[tone])}>
        <div
          className={cn("h-full rounded-full", TONE_FILL[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = "left",
  pinned = false,
  leading,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
  /** Pins the column to the left edge. Only the name column earns this. */
  pinned?: boolean;
  /**
   * Rendered before the sort control, inside the same cell.
   *
   * Exists for the select-all tick box, which belongs in the pinned column but
   * must not be inside the sort button — a checkbox nested in a button is one
   * click that means two things.
   */
  leading?: React.ReactNode;
}) {
  return (
    <th
      className={cn(TH, align === "right" && "text-right", pinned && "left-0 z-20")}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <div className={cn("flex items-center gap-2", align === "right" && "justify-end")}>
        {leading}
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "inline-flex items-center gap-1 font-mono uppercase tracking-wider transition-colors hover:text-foreground",
            active && "text-foreground",
          )}
        >
          {align === "right" && (
            <ArrowUpDown className="size-3 opacity-60" aria-hidden />
          )}
          {label}
          {align === "left" && <ArrowUpDown className="size-3 opacity-60" aria-hidden />}
        </button>
      </div>
    </th>
  );
}

function FilterSelect({
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
  const isDefault = value === "all";

  return (
    <Select value={value} onValueChange={(next) => onChange(next ?? "all")}>
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn("font-normal", isDefault && "text-muted-foreground")}
      >
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
