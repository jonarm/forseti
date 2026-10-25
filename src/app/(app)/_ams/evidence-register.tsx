"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Paperclip, Search, Upload, X } from "lucide-react";

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
import { evidenceDependants, isUsableEvidence } from "@/lib/ams/readiness";
import { EVIDENCE_TYPE, VERIFICATION, formatDate, isOverdue, TODAY } from "@/lib/ams/labels";
import type { Evidence, EvidenceType } from "@/lib/ams/types";
import { Checkbox } from "@/components/ui/checkbox";
import { RECORD_KINDS } from "@/lib/ams/record-kinds";
import { EmptyState } from "./empty-state";
import { EvidenceUploadDialog } from "./evidence-upload-dialog";
import { RegisterActions, RegisterExportButton } from "./register-actions";
import { useSelection } from "./use-selection";
import { usePermissions } from "@/lib/ams/workspace-context";
import { refusalNote } from "@/lib/permissions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRouter } from "next/navigation";
import { StatusBadge } from "./status-badge";
import { useWorkspace } from "@/lib/ams/workspace-context";
import type { Workspace } from "@/lib/ams/workspace";

/**
 * The evidence register — every document, and what rests on it.
 *
 * The column that justifies the screen is the last one: how many controls
 * depend on each document. A register that only lists documents is a filing
 * cabinet. What a compliance lead needs to know on any given morning is which
 * of these lapsing would actually cost them something, and that is a property
 * of the links, not of the file.
 *
 * Expiry is therefore the default sort and the loudest column. Everything else
 * in this product degrades when somebody does something wrong; evidence
 * degrades when nobody does anything at all, which is why it needs a screen
 * that goes looking for you.
 */

const TH =
  "sticky top-0 z-10 bg-background border-b border-border px-3 py-2 text-left font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const TD = "border-b border-border/60 px-3 py-2.5 whitespace-nowrap";

/** Named views the dashboard links into, matching the counts it shows. */
const LENSES: Record<
  string,
  { label: string; match: (ws: Workspace, doc: Evidence) => boolean }
> = {
  expired: {
    label: "Expired",
    match: (_ws, doc) =>
      doc.verificationState === "expired" || Boolean(doc.expiresAt && isOverdue(doc.expiresAt)),
  },
  expiring: {
    label: "Expiring within 60 days",
    match: (_ws, doc) => {
      if (!doc.expiresAt || isOverdue(doc.expiresAt)) return false;
      const days =
        (new Date(doc.expiresAt).getTime() - new Date(TODAY).getTime()) / 86_400_000;
      return days <= 60;
    },
  },
  unverified: {
    label: "Collected but never verified",
    match: (_ws, doc) => doc.verificationState === "unverified",
  },
  unused: {
    label: "Attached to nothing",
    match: (ws, doc) => evidenceDependants(ws, doc.id).controls.length === 0,
  },
  "no-file": {
    label: "No document attached",
    match: (_ws, doc) => doc.file === null,
  },
};

export function EvidenceRegister() {
  const ws = useWorkspace();
  const { personById, evidence: EVIDENCE } = ws;
  const params = useSearchParams();

  const [query, setQuery] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { records: may } = usePermissions();
  const router = useRouter();
  const [lens, setLens] = useState<string | null>(params.get("lens"));
  const [type, setType] = useState<EvidenceType | "all">(
    (params.get("type") as EvidenceType) ?? "all",
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EVIDENCE.filter((doc) => {
      if (lens && !LENSES[lens]?.match(ws, doc)) return false;
      if (type !== "all" && doc.type !== type) return false;
      if (!q) return true;
      return `${doc.title} ${doc.source} ${personById(doc.ownerId).name}`
        .toLowerCase()
        .includes(q);
    }).sort((a, b) => {
      // Soonest expiry first; documents that never expire sit at the bottom,
      // because they are the ones that never need chasing.
      if (!a.expiresAt && !b.expiresAt) return a.title.localeCompare(b.title);
      if (!a.expiresAt) return 1;
      if (!b.expiresAt) return -1;
      return a.expiresAt.localeCompare(b.expiresAt);
    });
  }, [ws, EVIDENCE, personById, query, lens, type]);

  const usable = EVIDENCE.filter((doc) => isUsableEvidence(ws, doc.id)).length;
  const expired = EVIDENCE.filter((doc) => LENSES.expired.match(ws, doc)).length;
  const filtered = Boolean(lens) || type !== "all" || query !== "";

  /*
   * The tick boxes. `EVIDENCE` rather than `rows`: a document ticked before the
   * lens moved is still selected and still going.
   */
  const selection = useSelection(EVIDENCE, rows);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Evidence register</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Every document the control set rests on.{" "}
            <span className="text-foreground">{usable} of {EVIDENCE.length} usable</span>
            {expired > 0 && (
              <>
                , <span className="text-critical">{expired} expired</span>
              </>
            )}
            . Sorted by expiry, because evidence is the one thing here that
            degrades when nobody does anything at all.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RegisterExportButton
            def={RECORD_KINDS.evidence}
            onClick={() => setExportOpen(true)}
          />
          <UploadButton
            allowed={may.evidence.create}
            onClick={() => setUploadOpen(true)}
          />
        </div>
      </header>

      <EvidenceUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => router.refresh()}
      />

      <RegisterActions
        def={RECORD_KINDS.evidence}
        selection={selection}
        shown={rows}
        total={EVIDENCE.length}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        deleteNote="The controls they back lose that evidence, so coverage recomputes lower without them."
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
            placeholder="Search document, source, owner…"
            className="h-8 pl-8 text-sm"
            aria-label="Search evidence"
          />
        </div>

        <Select
          value={type}
          onValueChange={(next) => setType((next ?? "all") as EvidenceType | "all")}
        >
          <SelectTrigger size="sm" aria-label="Type" className="font-normal">
            <SelectValue>
              {type === "all" ? "All types" : EVIDENCE_TYPE[type]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {(Object.keys(EVIDENCE_TYPE) as EvidenceType[]).map((value) => (
              <SelectItem key={value} value={value}>
                {EVIDENCE_TYPE[value]}
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
              setType("all");
              setQuery("");
            }}
          >
            <X aria-hidden />
            Clear
          </Button>
        )}

        <p className="ml-auto text-xs tabular text-muted-foreground">
          {rows.length} of {EVIDENCE.length} documents
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing matches these filters"
              body="Every document is still here — this combination of search and filters just excludes all of them."
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
                          ? "Deselect the documents in view"
                          : "Select the documents in view"
                      }
                    />
                    Document
                  </div>
                </th>
                <th className={TH}>Type</th>
                <th className={TH}>Source</th>
                <th className={TH}>Owner</th>
                <th className={TH}>Collected</th>
                <th className={TH}>Expires</th>
                <th className={TH}>File</th>
                <th className={TH}>State</th>
                <th className={cn(TH, "text-right")}>Depends on it</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((doc) => {
                const deps = evidenceDependants(ws, doc.id);
                const lapsed = Boolean(doc.expiresAt && isOverdue(doc.expiresAt));
                return (
                  <tr
                    key={doc.id}
                    className={cn(
                      "group transition-colors hover:bg-secondary/40",
                      selection.isSelected(doc.id) && "bg-secondary/60",
                    )}
                  >
                    <td className={TD}>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          checked={selection.isSelected(doc.id)}
                          onCheckedChange={() => selection.toggle(doc.id)}
                          aria-label={`Select ${doc.title}`}
                        />
                        <Link
                          href={`/evidence/${doc.id}`}
                          className="min-w-0 flex-1 font-medium underline-offset-4 group-hover:underline"
                        >
                          {doc.title}
                        </Link>
                      </div>
                    </td>
                    <td className={cn(TD, "text-muted-foreground")}>
                      {EVIDENCE_TYPE[doc.type]}
                    </td>
                    <td className={cn(TD, "text-muted-foreground")}>{doc.source}</td>
                    <td className={cn(TD, "text-muted-foreground")}>
                      {personById(doc.ownerId).name}
                    </td>
                    <td className={cn(TD, "tabular text-muted-foreground")}>
                      {formatDate(doc.collectedAt)}
                    </td>
                    <td
                      className={cn(
                        TD,
                        "tabular",
                        lapsed ? "text-critical" : "text-muted-foreground",
                      )}
                    >
                      {doc.expiresAt ? (
                        formatDate(doc.expiresAt)
                      ) : (
                        <span className="text-muted-foreground/40">No expiry</span>
                      )}
                    </td>
                    <td className={cn(TD, "text-muted-foreground")}>
                      {doc.file ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Paperclip className="size-3 shrink-0" aria-hidden />
                          <span className="text-[0.75rem]">{doc.file.sizeKb} KB</span>
                        </span>
                      ) : (
                        <span
                          className="text-warn"
                          title="Recorded as evidence with nothing attached"
                        >
                          None attached
                        </span>
                      )}
                    </td>
                    <td className={TD}>
                      <StatusBadge
                        label={VERIFICATION[doc.verificationState].label}
                        tone={VERIFICATION[doc.verificationState].tone}
                      />
                    </td>
                    <td className={cn(TD, "text-right tabular")}>
                      {deps.controls.length === 0 ? (
                        <span
                          className="text-warn"
                          title="Attached to no control — it proves nothing"
                        >
                          0
                        </span>
                      ) : (
                        <span
                          className={cn(deps.soleSupport.length > 0 && "text-warn")}
                          title={
                            deps.soleSupport.length > 0
                              ? `${deps.soleSupport.length} of them have nothing else`
                              : "Every dependant has other usable evidence"
                          }
                        >
                          {deps.controls.length}
                          {deps.soleSupport.length > 0 && (
                            <span className="text-muted-foreground/50">
                              {" "}
                              ({deps.soleSupport.length} alone)
                            </span>
                          )}
                        </span>
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

/**
 * Upload, refused or not.
 *
 * Gated on `evidence: ["create"]`, the statement the upload route checks —
 * filing a document is creating an evidence record, whatever shape it arrives
 * in. Refused means disabled and explained, never absent.
 */
function UploadButton({
  allowed,
  onClick,
}: {
  allowed: boolean;
  onClick: () => void;
}) {
  if (allowed) {
    return (
      <Button variant="outline" size="sm" onClick={onClick}>
        <Upload aria-hidden />
        Upload evidence
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span tabIndex={0} className="inline-flex">
            <Button
              variant="outline"
              size="sm"
              aria-disabled
              className="pointer-events-none opacity-50"
            >
              <Upload aria-hidden />
              Upload evidence
            </Button>
          </span>
        }
      />
      <TooltipContent>{refusalNote("upload evidence")}</TooltipContent>
    </Tooltip>
  );
}
