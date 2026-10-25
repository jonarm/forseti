"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Download, Paperclip, Search, Sparkles, Unlink, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  APPLICABILITY as APPLICABILITY_LABEL,
  EVIDENCE_TYPE,
  IMPLEMENTATION,
  VERIFICATION,
  formatDate,
  isOverdue,
} from "@/lib/ams/labels";
import type {
  AiSuggestion,
  Applicability,
  ControlApplicability,
  FrameworkControl,
  FrameworkNode,
  ImplementationStatus,
  SuggestionStatus,
} from "@/lib/ams/types";
import { TONE_TEXT, type Tone } from "@/lib/ams/tone";
import { hasUsableEvidence, isUsableEvidence } from "@/lib/ams/readiness";
import { CiteEvidenceDialog } from "./cite-evidence-dialog";
import { EmptyState } from "./empty-state";
import { Gated } from "./register-actions";
import { SoaExportDialog } from "./soa-export-dialog";
import { Ref, StatusBadge } from "./status-badge";
import { SuggestionCard } from "./suggestion-card";
import { refusalNote } from "@/lib/permissions";
import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";
import type { Workspace } from "@/lib/ams/workspace";
import {
  MIN_JUSTIFICATION,
  type ApplicabilityPatch,
} from "@/lib/ams/applicability-patch";
import { useApplicabilityPatch } from "./use-applicability-patch";

/**
 * The Statement of Applicability, which is the document ISO 42001 is really about.
 *
 * Three things this screen has to get right, and they are all consequences of
 * applicability being a join rather than a property:
 *
 *   - **Every row is per framework.** The table is the join filtered to one
 *     framework id. Add ISO 27001 and it is a second set of rows over the same
 *     controls with their own answers — nothing here would need restructuring,
 *     which is the payoff for having refused to hang these fields on the control.
 *   - **The consumption-only posture arrives already argued.** Eight development
 *     controls are pre-marked N/A with a justification that names the one
 *     internally built model rather than claiming the organisation builds
 *     nothing. A blanket exclusion is the lie an auditor finds in four minutes.
 *   - **An exclusion demands prose.** Change applicability to No or N/A and the
 *     justification becomes required; the AI will draft one, and nothing is
 *     written until a person accepts it.
 *
 * **Every edit is written as it is made**, one field at a time, through `POST
 * /api/applicability` — and nothing is layered over what comes back. The screen
 * held its edits in React state until it learned to write: applicability,
 * implementation status, owner and linked policy survived until the next
 * refresh and no further, and the only field that ever reached the database was
 * a justification accepted from an AI draft.
 *
 * **An exclusion is the one change that is held rather than sent.** Marking a
 * control No or N/A waits for a justification, because the route refuses an
 * unexplained exclusion and the button that drafts one only appears once the
 * control is being excluded — a screen that sent the applicability first would
 * be asking for prose it had just been refused for. The two commit together.
 */

const TH =
  "sticky top-0 z-10 bg-background border-b border-border px-3 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const TD = "border-b border-border/60 px-3 py-2 align-top";

/**
 * The named views the dashboard drills into.
 *
 * Every figure on the readiness screen has to land somewhere that shows the
 * rows behind it — a number you cannot click is a poster. Keeping the
 * definitions here rather than in the dashboard means the count and the filtered
 * list can never disagree: both ask this same predicate.
 */
const LENSES: Record<
  string,
  { label: string; match: (ws: Workspace, row: ControlApplicability) => boolean }
> = {
  unproven: {
    label: "Marked implemented, not provable",
    match: (ws, row) =>
      row.applicability === "yes" &&
      row.implementationStatus === "implemented" &&
      !hasUsableEvidence(ws, row),
  },
  "no-evidence": {
    label: "Applicable with no usable evidence",
    match: (ws, row) => row.applicability === "yes" && !hasUsableEvidence(ws, row),
  },
  "no-policy": {
    label: "Applicable, citing no policy",
    match: (_ws, row) => row.applicability === "yes" && !row.linkedPolicyId,
  },
  "expired-evidence": {
    label: "Relying on an expired document",
    match: (ws, row) =>
      row.linkedEvidenceIds.length > 0 &&
      !row.linkedEvidenceIds.some((id) => isUsableEvidence(ws, id)),
  },
  excluded: {
    label: "Excluded or not applicable",
    match: (_ws, row) => row.applicability !== "yes",
  },
};

export function SoaWorkbench() {
  const ws = useWorkspace();
  const {
    framework,
    nodes,
    applicability: APPLICABILITY,
    controlById,
    nodeById,
  } = ws;
  const params = useSearchParams();
  const router = useRouter();

  // All three come from the URL so another screen can link straight into a view,
  // and so a filtered SoA is a link somebody can paste to a colleague.
  const [selectedNode, setSelectedNode] = useState<string | null>(params.get("node"));
  const [lens, setLens] = useState<string | null>(params.get("lens"));
  /* `?control=` opens one row outright, which is what lets a link elsewhere in
   * the product mean *this control* rather than the clause it sits under. It is
   * read once, as the initial state, rather than kept in step with the URL: a
   * person who then closes the row has answered the question the link asked,
   * and re-opening it on the next render would be the screen arguing with them. */
  const [openControl, setOpenControl] = useState<string | null>(params.get("control"));
  const [query, setQuery] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

  /* Every commit is followed by a `router.refresh()`, so what the table renders
   * is the join as the database has it rather than a hopeful copy of it. */
  const patcher = useApplicabilityPatch(framework?.id ?? "");

  /** The join, filtered to this framework. */
  const rows: ControlApplicability[] = useMemo(
    () => APPLICABILITY.filter((row) => row.frameworkId === framework?.id),
    [APPLICABILITY, framework?.id],
  );

  const byControl = useMemo(
    () => new Map(rows.map((row) => [row.controlId, row])),
    [rows],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const control = controlById(row.controlId);
      if (!control) return false;
      if (selectedNode && control.nodeId !== selectedNode) return false;
      if (lens && !LENSES[lens]?.match(ws, row)) return false;
      if (!q) return true;
      return `${control.officialRef} ${control.shortTitle} ${control.requirementSummary}`
        .toLowerCase()
        .includes(q);
    });
  }, [ws, controlById, rows, selectedNode, lens, query]);

  function chooseNode(id: string | null) {
    setSelectedNode(id);
    const next = new URLSearchParams(params.toString());
    if (id) next.set("node", id);
    else next.delete("node");
    router.replace(next.toString() ? `?${next}` : "?", { scroll: false });
  }

  function clearLens() {
    setLens(null);
    const next = new URLSearchParams(params.toString());
    next.delete("lens");
    router.replace(next.toString() ? `?${next}` : "?", { scroll: false });
  }

  const counts = {
    applicable: rows.filter((r) => r.applicability === "yes").length,
    excluded: rows.filter((r) => r.applicability === "no").length,
    na: rows.filter((r) => r.applicability === "na").length,
    implemented: rows.filter((r) => r.implementationStatus === "implemented").length,
  };

  const clauses = nodes.filter((n) => n.kind === "management_clause");
  const annex = nodes.filter((n) => n.kind === "annex_a");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{framework?.name}</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {framework?.description}
          </p>
          <p className="pt-1 text-sm text-muted-foreground">
            <span className="text-foreground">{counts.applicable} applicable</span> ·{" "}
            {counts.na} not applicable · {counts.excluded} excluded ·{" "}
            {counts.implemented} implemented, of {rows.length} controls
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
          <Download aria-hidden />
          Export SoA
        </Button>
      </header>

      {/* Above the table rather than in the row that failed. A refusal reported
        * beside a cell somebody has already scrolled past is a refusal nobody
        * reads, and the row itself has gone back to showing the saved value —
        * which is the honest thing for it to show and the reason the sentence
        * has to appear somewhere else. */}
      {patcher.error && (
        <div className="flex items-start gap-3 border-b border-critical/30 bg-critical/5 px-6 py-2.5">
          <p className="flex-1 text-xs leading-relaxed text-critical">{patcher.error}</p>
          <button
            type="button"
            onClick={patcher.dismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-critical/70 transition-colors hover:text-critical"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------ the tree */}
        <nav className="w-64 shrink-0 overflow-y-auto border-r border-border p-3">
          <button
            type="button"
            onClick={() => chooseNode(null)}
            className={cn(
              "mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              selectedNode === null
                ? "bg-secondary font-medium"
                : "text-muted-foreground hover:bg-secondary/50",
            )}
          >
            All controls
            <span className="ml-auto tabular text-xs text-muted-foreground/60">
              {rows.length}
            </span>
          </button>

          <TreeGroup
            heading="Management clauses"
            nodes={clauses}
            selected={selectedNode}
            onSelect={chooseNode}
            byControl={byControl}
          />
          <TreeGroup
            heading="Annex A"
            nodes={annex}
            selected={selectedNode}
            onSelect={chooseNode}
            byControl={byControl}
          />
        </nav>

        {/* ------------------------------------------------------ the table */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            <div className="relative w-64">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search reference or control…"
                className="h-8 pl-8 text-sm"
                aria-label="Search controls"
              />
            </div>
            {selectedNode && (
              <Button variant="ghost" size="xs" onClick={() => chooseNode(null)}>
                <X aria-hidden />
                {nodeById(selectedNode)?.officialRef} only
              </Button>
            )}
            {/*
              Arriving from a dashboard figure means arriving pre-filtered. The
              chip says which view you are in and gets you out of it — landing in
              a filtered table with no way back reads as missing data.
            */}
            {lens && LENSES[lens] && (
              <Button variant="ghost" size="xs" onClick={clearLens}>
                <X aria-hidden />
                {LENSES[lens].label}
              </Button>
            )}
            <p className="ml-auto text-xs tabular text-muted-foreground">
              {visible.length} control{visible.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {visible.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No controls here"
                  body="Nothing in this part of the standard matches the current search. Clear it, or pick another clause on the left."
                />
              </div>
            ) : (
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className={TH}>Ref</th>
                    <th className={TH}>Control</th>
                    <th className={TH}>Applicability</th>
                    <th className={cn(TH, "min-w-64")}>Justification</th>
                    <th className={TH}>Implementation</th>
                    <th className={TH}>Owner</th>
                    <th className={TH}>Policy</th>
                    <th className={cn(TH, "text-right")}>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const control = controlById(row.controlId);
                    if (!control) return null;
                    const open = openControl === row.controlId;

                    return (
                      <SoaRow
                        key={row.controlId}
                        row={row}
                        control={control}
                        open={open}
                        onToggle={() => setOpenControl(open ? null : row.controlId)}
                        commit={(patch) => patcher.commit(row.controlId, patch)}
                        busy={patcher.isSaving(row.controlId)}
                      />
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <SoaExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        rows={rows}
        counts={counts}
      />
    </div>
  );
}

/* --------------------------------------------------------------- the tree */

function TreeGroup({
  heading,
  nodes,
  selected,
  onSelect,
  byControl,
}: {
  heading: string;
  nodes: FrameworkNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  byControl: Map<string, ControlApplicability>;
}) {
  const { controls: allControls } = useWorkspace();
  return (
    <div className="mb-3">
      <p className="px-2 pt-2 pb-1 font-mono text-[0.6rem] uppercase tracking-[0.11em] text-muted-foreground/60">
        {heading}
      </p>
      {nodes.map((node) => {
        const controls = allControls.filter((c) => c.nodeId === node.id);
        // A clause where everything is excluded reads differently from one that
        // is simply small, so the count carries the excluded share.
        const excluded = controls.filter((c) => {
          const row = byControl.get(c.id);
          return row && row.applicability !== "yes";
        }).length;

        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelect(node.id)}
            className={cn(
              "flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              selected === node.id
                ? "bg-secondary font-medium"
                : "text-muted-foreground hover:bg-secondary/50",
            )}
          >
            <span className="w-9 shrink-0 font-mono text-[0.6875rem] text-muted-foreground/70">
              {node.officialRef}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{node.shortTitle}</span>
            <span className="shrink-0 tabular text-[0.6875rem] text-muted-foreground/60">
              {excluded > 0 ? (
                <>
                  <span className="text-warn">{excluded}</span>
                  <span className="text-muted-foreground/40">/</span>
                </>
              ) : null}
              {controls.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- a row */

/** Worded like the 403 `/api/ai/draft-*` would return, because it is the same refusal. */
const DRAFT_REFUSAL = refusalNote("draft with AI");

/** The two refusals this row can hand back, in the words the routes use. */
const SCOPE_REFUSAL = refusalNote(
  "change what the Statement of Applicability says is in scope",
);
const ANSWER_REFUSAL = refusalNote("edit the Statement of Applicability");

function SoaRow({
  row,
  control,
  open,
  onToggle,
  commit,
  busy,
}: {
  row: ControlApplicability;
  control: FrameworkControl;
  open: boolean;
  onToggle: () => void;
  commit: (patch: ApplicabilityPatch) => Promise<boolean>;
  /** Whether anything on this row is in flight. */
  busy: boolean;
}) {
  const router = useRouter();
  const { people: PEOPLE, personById, policyById, pendingSuggestionsFor } = useWorkspace();
  const { draftWithAi, editSoa, answerControls } = usePermissions();

  /*
   * An exclusion waiting for its reason.
   *
   * Held here rather than sent, because the route refuses an exclusion carrying
   * no justification and the "Draft one" button only appears once a control is
   * being excluded. Sending the applicability first would ask somebody for prose
   * the server had just refused them for; holding it means the select shows what
   * they chose, the justification editor opens, and both fields go in one patch
   * when the reason is written. Reverting the select, or picking Applicable
   * again, drops it.
   */
  const [pending, setPending] = useState<{
    applicability: Applicability;
    implementationStatus: ImplementationStatus;
  } | null>(null);
  const [writing, setWriting] = useState(false);

  /*
   * Seeded from the workspace, not from nothing.
   *
   * The draft is persisted the moment it is proposed, so a refresh — or a
   * colleague opening the same control — has to find the pending proposal
   * already there. A row that forgets its own outstanding suggestion invites two
   * people to draft the same justification and disagree about which one is real.
   */
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(
    // Exact match, not the prefix helper: `pendingSuggestionsFor` uses
    // `startsWith`, so control `A.8.3` would otherwise adopt a proposal
    // belonging to `A.8.3.1` and offer it as its own.
    () => pendingSuggestionsFor(row.controlId).find((s) => s.target.id === row.controlId) ?? null,
  );
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  async function draft() {
    setDrafting(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/ai/draft-justification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controlId: row.controlId, frameworkId: row.frameworkId }),
      });
      const payload = await res.json();
      if (!res.ok) {
        // Never a bare failure: the route distinguishes a missing key, an
        // exhausted balance and a rate limit, and each needs a different next
        // move from the reader.
        setDraftError(payload.error ?? "Drafting failed.");
        return;
      }
      setSuggestion(payload.suggestion);
    } catch {
      setDraftError("Could not reach the drafting service. Check your connection and try again.");
    } finally {
      setDrafting(false);
    }
  }

  async function decide(status: SuggestionStatus, text: string) {
    if (!suggestion) return;
    /* No optimistic write. `/api/suggestions` persists the justification into
     * the applicability row itself as part of recording the decision, so the
     * refresh below is what shows it — a local copy would only be a second
     * answer waiting to disagree. */
    await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestionId: suggestion.id, status, text }),
    });

    /* An accepted draft is usually the prose a held exclusion was waiting for,
     * so the exclusion goes with it. The justification is sent again rather than
     * left to the write above: this client has not refreshed yet, and the route
     * checks the rule against the row it is about to store.
     *
     * Two writes, and the second can fail on its own — leaving the justification
     * saved and the control still in scope. That state is a coherent one rather
     * than a corrupt one (a control that applies, carrying prose about why it
     * might not), `pending` survives so the exclusion is one click from being
     * retried, and the alternative is a transaction spanning two routes with
     * different permissions. */
    if (pending && (status === "accepted" || status === "edited")) {
      if (await commit({ ...pending, justification: text })) setPending(null);
    }
    // The decision is recorded and the row goes back to its resting state:
    // the card has served its purpose here, and the proposal survives in
    // `ai_suggestion` where the audit trail can reach it. Leaving a decided
    // card pinned to the row would also block ever drafting again.
    setSuggestion(null);
    // Required: the applicability row and the audit trail were written on the
    // server, and Server Components would otherwise re-render the old ones.
    router.refresh();
  }

  const policy = policyById(row.linkedPolicyId);
  /* What the row would say if the held change were sent — which is what the
   * screen has to argue about. A control on its way out of scope needs its
   * reason now, not after the change lands. */
  const applicability = pending?.applicability ?? row.applicability;
  const implementationStatus = pending?.implementationStatus ?? row.implementationStatus;
  const needsJustification = applicability !== "yes";
  const missingJustification =
    needsJustification && row.justification.trim().length < MIN_JUSTIFICATION;

  function changeApplicability(value: Applicability) {
    // An SoA contradicts itself in two directions, and both are common: a control
    // marked not applicable that still claims to be "in progress", and one made
    // applicable again that is left reading "N/A". Move the status with the
    // applicability rather than leaving the reader to spot it.
    const nextStatus: ImplementationStatus =
      value !== "yes"
        ? "not_applicable"
        : row.implementationStatus === "not_applicable"
          ? "not_started"
          : row.implementationStatus;

    if (value === row.applicability) {
      // Back where it started. Dropping a held change is not a change.
      setPending(null);
      return;
    }

    if (value === "yes") {
      setPending(null);
      void commit({ applicability: value, implementationStatus: nextStatus });
      return;
    }

    /* Held, every time — not only when the existing justification is short. An
     * exclusion demands prose as an act rather than as a character count, and a
     * control already carrying a long argument for why it *applies* would
     * otherwise sail past both this check and the route's and land excluded,
     * arguing the opposite of its own new state. */
    setPending({ applicability: value, implementationStatus: nextStatus });
    setWriting(true);
  }

  /**
   * The justification, and whatever it was holding up.
   *
   * One patch rather than two: the route checks the exclusion rule against the
   * row it is about to store, so sending the applicability separately would be
   * refused on the way through no matter which order they went in.
   */
  async function commitJustification(text: string) {
    if (pending) {
      if (await commit({ ...pending, justification: text })) setPending(null);
      return;
    }
    void commit({ justification: text });
  }

  return (
    <>
      <tr className={cn("group", (busy || pending) && "bg-primary/[0.05]")}>
        <td className={TD}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="text-left"
            title="Open control detail"
          >
            <Ref className={cn(open && "text-foreground")}>{control.officialRef}</Ref>
          </button>
        </td>
        <td className={cn(TD, "w-64 min-w-56")}>
          <button type="button" onClick={onToggle} className="text-left">
            <span className="font-medium underline-offset-4 group-hover:underline">
              {control.shortTitle}
            </span>
          </button>
          {control.developmentOnly && (
            <StatusBadge
              label="Development only"
              tone="neutral"
              className="mt-1 block w-fit"
              title="Only applies to systems you build yourself"
            />
          )}
          {(busy || pending) && (
            <span className="mt-1 block font-mono text-[0.6rem] uppercase tracking-wider text-brand">
              {busy ? "Saving…" : "Waiting for a reason"}
            </span>
          )}
        </td>
        <td className={TD}>
          <Select
            value={applicability}
            disabled={!editSoa}
            onValueChange={(v) => changeApplicability((v ?? "yes") as Applicability)}
          >
            <SelectTrigger
              size="sm"
              className="w-36 font-normal"
              aria-label="Applicability"
              title={editSoa ? undefined : SCOPE_REFUSAL}
            >
              <SelectValue>{APPLICABILITY_LABEL[applicability].label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(["yes", "no", "na"] as Applicability[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {APPLICABILITY_LABEL[value].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
        <td className={cn(TD, "w-[26rem] min-w-64")}>
          <JustificationCell
            value={row.justification}
            invalid={missingJustification}
            label={`Justification for ${control.officialRef}`}
            disabled={!answerControls}
            writing={writing || Boolean(pending)}
            onWritingChange={setWriting}
            onCommit={commitJustification}
          />
          {missingJustification && (
            <p className="mt-1 text-[0.6875rem] text-warn">
              {pending
                ? "This control is not excluded yet. Write why, and the change saves with it."
                : "Required whenever a control is excluded or not applicable."}
            </p>
          )}
          {!drafting && !suggestion && needsJustification && (
            /* Disabled rather than absent: a missing button reads as a feature
             * that does not exist, and the next question is why the exclusion
             * has to be written by hand. `/api/ai/draft-justification` re-checks
             * `ai: ["draft"]` — this only saves the round trip. */
            <button
              type="button"
              onClick={draft}
              disabled={!draftWithAi}
              title={draftWithAi ? undefined : DRAFT_REFUSAL}
              className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground transition-colors hover:text-brand disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground"
            >
              <Sparkles className="size-3" aria-hidden />
              Draft one
            </button>
          )}
          {draftError && (
            <p className="mt-1 text-[0.6875rem] text-critical">{draftError}</p>
          )}
        </td>
        <td className={TD}>
          <Select
            value={implementationStatus}
            disabled={!answerControls || Boolean(pending)}
            onValueChange={(v) =>
              void commit({
                implementationStatus: (v ?? "not_started") as ImplementationStatus,
              })
            }
          >
            <SelectTrigger
              size="sm"
              className="w-36 font-normal"
              aria-label="Implementation"
              title={
                pending
                  ? "Held until the exclusion is explained — it moves with it."
                  : answerControls
                    ? undefined
                    : ANSWER_REFUSAL
              }
            >
              <SelectValue>{IMPLEMENTATION[implementationStatus].label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(IMPLEMENTATION) as ImplementationStatus[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {IMPLEMENTATION[value].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
        <td className={TD}>
          <Select
            value={row.ownerId ?? ""}
            disabled={!answerControls}
            onValueChange={(v) => void commit({ ownerId: v ?? "" })}
          >
            <SelectTrigger
              size="sm"
              className="w-32 font-normal"
              aria-label="Owner"
              title={answerControls ? undefined : ANSWER_REFUSAL}
            >
              <SelectValue>
                {row.ownerId ? (
                  personById(row.ownerId).name
                ) : (
                  <span className="text-warn">Unassigned</span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PEOPLE.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name} — {person.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
        <td className={cn(TD, "max-w-40 text-[0.8125rem] text-muted-foreground")}>
          {policy ? policy.title : <span className="text-muted-foreground/40">—</span>}
        </td>
        <td className={cn(TD, "text-right tabular")}>
          <EvidenceCount row={row} />
        </td>
      </tr>

      {(open || drafting || suggestion) && (
        <tr>
          <td colSpan={8} className="border-b border-border bg-secondary/20 px-3 py-4">
            <div className="space-y-4 pl-9">
              {open && (
                <ControlDetail control={control} row={row} commit={commit} />
              )}

              {drafting && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5 animate-pulse text-brand" aria-hidden />
                  Drafting a justification for {control.officialRef}…
                </p>
              )}

              {suggestion && (
                <div className="max-w-3xl">
                  <SuggestionCard
                    suggestion={suggestion}
                    targetLabel={`${control.officialRef} justification`}
                    // Only an accepted suggestion writes into the field.
                    // Rejecting still records the decision — proving somebody
                    // was able to say no is the point — but leaves the
                    // justification exactly as the person left it.
                    onDecision={decide}
                  />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The evidence count, which a bare number gets wrong.
 *
 * Counting documents treats an expired DPIA as proof. The count therefore shows
 * how many are *usable* over how many are attached whenever those differ, and
 * takes its colour from the worst state among them — because a control resting
 * on one verified export and one lapsed assessment is not two-thirds satisfied,
 * it has a hole in it.
 */
function EvidenceCount({ row }: { row: ControlApplicability }) {
  const { evidenceById } = useWorkspace();
  if (row.applicability !== "yes") {
    return <span className="text-muted-foreground/40">{row.linkedEvidenceIds.length}</span>;
  }

  const docs = row.linkedEvidenceIds.map((id) => evidenceById(id)).filter(Boolean);
  if (docs.length === 0) return <span className="text-critical">0</span>;

  const usable = docs.filter((d) => d!.verificationState === "verified").length;
  const worst = docs.some((d) => d!.verificationState === "expired" || d!.verificationState === "rejected")
    ? "critical"
    : usable < docs.length
      ? "warn"
      : "ok";

  return (
    <span
      className={cn(TONE_TEXT[worst as Tone])}
      title={
        usable === docs.length
          ? `${docs.length} verified`
          : `${usable} of ${docs.length} verified — the rest are unverified or expired`
      }
    >
      {usable === docs.length ? docs.length : `${usable}/${docs.length}`}
    </span>
  );
}

/**
 * A justification: read as text, edited in place, saved when you leave it.
 *
 * Rendering every cell as a live textarea made rows a hundred pixels tall and
 * turned a fifty-one row table into a scroll. Clamped text keeps the row at a
 * height you can scan and still shows enough of the argument to judge it;
 * clicking swaps in the textarea, and blurring puts it back.
 *
 * **The draft is local and the commit is on blur**, which is the one thing that
 * had to change when this screen learned to persist. Sending a keystroke would
 * be a request per character and an audit entry per pause. Sending nothing until
 * a Save button is pressed would be a screen with fifty-one Save buttons on it.
 *
 * The draft re-seeds whenever the stored value moves underneath it — a refresh,
 * or a justification the model drafted and somebody accepted — so the cell shows
 * what was saved rather than what this tab last remembered.
 */
function JustificationCell({
  value,
  invalid,
  label,
  disabled,
  writing,
  onWritingChange,
  onCommit,
}: {
  value: string;
  invalid: boolean;
  label: string;
  disabled: boolean;
  /** Open because it was clicked, or because a held exclusion is waiting on it. */
  writing: boolean;
  onWritingChange: (writing: boolean) => void;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  /* Re-seeded during render rather than in an effect, the same reason the
   * dialogs empty themselves there: an effect would paint the stale text for a
   * frame first. */
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  if (writing) {
    return (
      <Textarea
        autoFocus
        rows={4}
        value={draft}
        aria-label={label}
        aria-invalid={invalid}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          onWritingChange(false);
          // Nothing to say and nothing to write. A commit here would be an
          // audit entry recording that somebody clicked a cell.
          if (draft !== value) onCommit(draft);
        }}
        className="w-full text-[0.8125rem] leading-snug"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? ANSWER_REFUSAL : undefined}
      onClick={() => onWritingChange(true)}
      aria-label={label}
      className={cn(
        "w-full rounded border border-transparent px-1.5 py-1 text-left text-[0.8125rem] leading-snug transition-colors hover:border-border hover:bg-secondary/40",
        invalid && "text-warn",
        disabled && "cursor-not-allowed hover:border-transparent hover:bg-transparent",
      )}
    >
      <span className="line-clamp-2">
        {value.trim() || "Not stated — click to write one"}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ the detail */

function ControlDetail({
  control,
  row,
  commit,
}: {
  control: FrameworkControl;
  row: ControlApplicability;
  commit: (patch: ApplicabilityPatch) => Promise<boolean>;
}) {
  const { policies: POLICIES, evidenceById, policyById, systemById } = useWorkspace();
  const { records, answerControls } = usePermissions();
  const [citing, setCiting] = useState<"cite" | "uncite" | null>(null);
  const evidence = row.linkedEvidenceIds
    .map((id) => evidenceById(id))
    .filter(Boolean);

  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
            What has to be demonstrated
          </p>
          <p className="text-[0.8125rem] leading-relaxed">{control.requirementSummary}</p>
        </div>
        <div className="space-y-1">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
            What we would accept as proof
          </p>
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            {control.evidenceGuidance}
          </p>
        </div>
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground/50">
          Reference {control.officialRef} is a citation. Everything above is our
          own wording — we do not reproduce the text of the standard.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
            Linked policy
          </Label>
          <Select
            value={row.linkedPolicyId ?? "none"}
            disabled={!answerControls}
            onValueChange={(v) =>
              void commit({ linkedPolicyId: v === "none" || !v ? null : v })
            }
          >
            <SelectTrigger
              size="sm"
              className="w-full font-normal"
              title={answerControls ? undefined : ANSWER_REFUSAL}
            >
              <SelectValue>
                {policyById(row.linkedPolicyId)?.title ?? "No policy linked"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No policy linked</SelectItem>
              {POLICIES.map((policy) => (
                <SelectItem key={policy.id} value={policy.id}>
                  {policy.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
              Evidence ({evidence.length})
            </p>
            {/* Gated on the register rather than on the Statement of
              * Applicability: what a citation writes is an `ai_evidence_link`
              * row, the same table and the same statement `/api/records/
              * evidence/link` checks. Citing a document is evidencing the
              * framework, which is precisely what a system owner is for —
              * unlike claiming a control, which is scope and is not. */}
            <div className="flex items-center gap-1.5">
              {/* Absent rather than refused when the control is out of scope,
                * because that is not a refusal aimed at a person: the route
                * says nothing needs to prove a control the organisation has
                * decided it need not satisfy, and a button explained by a
                * permission tooltip would name the wrong reason. Removing stays
                * available — `./uncite` consults no Statement of Applicability,
                * so citations left on a control excluded afterwards can still
                * be cleared. */}
              {row.applicability === "yes" ? (
                <Gated
                  allowed={records.evidence.create}
                  action="cite evidence on a control"
                  onClick={() => setCiting("cite")}
                  icon={<Paperclip aria-hidden />}
                  label="Cite evidence"
                  variant="outline"
                />
              ) : (
                <p className="text-[0.6875rem] text-muted-foreground/60">
                  Out of scope — nothing has to prove it.
                </p>
              )}
              {evidence.length > 0 && (
                <Gated
                  allowed={records.evidence.delete}
                  action="take evidence off a control"
                  onClick={() => setCiting("uncite")}
                  icon={<Unlink aria-hidden />}
                  label="Remove"
                  variant="outline"
                />
              )}
            </div>
          </div>
          {evidence.length === 0 ? (
            <p className="text-[0.8125rem] text-muted-foreground">
              Nothing attached. Until something is, this control is a claim.
            </p>
          ) : (
            <>
              <ul className="space-y-1.5">
              {evidence.map(
                (item) =>
                  item && (
                    <li key={item.id} className="space-y-0.5">
                      <div className="flex items-baseline gap-2 text-[0.8125rem]">
                        <Link
                          href={`/evidence/${item.id}`}
                          className="min-w-0 flex-1 underline-offset-4 hover:underline"
                        >
                          {item.title}
                        </Link>
                        <StatusBadge
                          className="shrink-0"
                          label={VERIFICATION[item.verificationState].label}
                          tone={VERIFICATION[item.verificationState].tone}
                        />
                      </div>
                      <p className="text-[0.6875rem] text-muted-foreground/60">
                        {EVIDENCE_TYPE[item.type]} · collected {formatDate(item.collectedAt)}
                        {item.expiresAt && (
                          <span className={cn(isOverdue(item.expiresAt) && "text-critical")}>
                            {" "}
                            · {isOverdue(item.expiresAt) ? "expired" : "expires"}{" "}
                            {formatDate(item.expiresAt)}
                          </span>
                        )}
                      </p>
                    </li>
                  ),
              )}
            </ul>
              <p className="text-[0.6875rem] leading-relaxed text-muted-foreground/50">
                A lapsed document still sits in the register. It stops being
                proof the day it expires, which is why the state is here and not
                only in the evidence tab.
              </p>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60">
            Claimed against ({row.appliesToSystemIds.length})
          </p>
          {row.appliesToSystemIds.length === 0 ? (
            <p className="text-[0.8125rem] text-muted-foreground">
              Not claimed against any system. Organisation-level controls are
              legitimately like this; a technical control is not.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {row.appliesToSystemIds.map((id) => {
                const system = systemById(id);
                return system ? (
                  <Link
                    key={id}
                    href={`/inventory/${id}`}
                    className="rounded border border-border px-1.5 py-0.5 text-[0.75rem] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {system.name}
                  </Link>
                ) : null;
              })}
            </div>
          )}
        </div>

        {row.lastReviewedAt && (
          <p className="text-[0.6875rem] text-muted-foreground/60">
            Last reviewed {formatDate(row.lastReviewedAt)}
          </p>
        )}

        {citing && (
          <CiteEvidenceDialog
            mode={citing}
            open
            onOpenChange={(next) => !next && setCiting(null)}
            control={control}
            row={row}
          />
        )}
      </div>
    </div>
  );
}
