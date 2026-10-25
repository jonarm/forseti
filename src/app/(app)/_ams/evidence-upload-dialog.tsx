"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { EVIDENCE_TYPE } from "@/lib/ams/labels";
import { guessEvidenceType, titleFromFilename } from "@/lib/ams/evidence-upload";
import type { EvidenceType } from "@/lib/ams/types";

/**
 * Filing documents into the evidence register.
 *
 * The other registers import a spreadsheet and argue about columns. This one
 * takes the documents themselves, so the argument is different: there is
 * nothing to map, and the only thing the files cannot tell us is what kind of
 * evidence they are.
 *
 * **So that is the one question asked.** One type for the batch, seeded from
 * whatever the first filename gives away. Asking per file would be a form
 * twelve rows long for a decision that is almost always the same across a drop;
 * asking nothing would mean defaulting a register full of documents to "policy"
 * and calling it data.
 *
 * **Nothing is claimed on the documents' behalf.** They arrive unverified and
 * linked to no control, because verification is what makes evidence count
 * towards coverage and what a document proves is a judgement an upload cannot
 * make. Both show on the register as work still to do, which is honest and
 * visible.
 *
 * **The one exception is the system, and only when the caller names it.** Opened
 * from a system's own Evidence tab, `systemId` files the batch against that
 * system — not a judgement read out of the bytes but a fact about where somebody
 * was standing when they dropped the files. Opened from the register it is
 * absent and the documents link to nothing, as before.
 */

interface Stored {
  id: string;
  title: string;
  filename: string;
  hasText: boolean;
}

interface Result {
  stored: Stored[];
  refused: { filename: string; reason: string }[];
}

/** What the picker offers. The bytes decide what is actually accepted. */
const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.md,application/pdf,text/plain";

export function EvidenceUploadDialog({
  open,
  onOpenChange,
  onUploaded,
  systemId,
  systemName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the server has stored them, so the register can re-read. */
  onUploaded: () => void;
  /**
   * The system to file this batch against, when the upload came from one
   * system's own Evidence tab. Absent on the register, where a document is
   * filed for the organisation and linked later.
   */
  systemId?: string;
  /** That system's name, for the sentence explaining where the batch lands. */
  systemName?: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [type, setType] = useState<EvidenceType>("policy");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  function reset() {
    setFiles([]);
    setType("policy");
    setFailure(null);
    setResult(null);
    setDragging(false);
  }

  /**
   * Take a drop or a pick.
   *
   * The type select is seeded from the first filename that gives anything away
   * — a file called `vendor-dpa.pdf` is a contract and the person should not
   * have to say so. It is a starting value, not a decision: the select is right
   * there and they can change it.
   */
  function accept(incoming: FileList | null) {
    if (!incoming || incoming.length === 0) return;
    const list = [...incoming];

    setFiles((prev) => [...prev, ...list]);
    setResult(null);
    setFailure(null);

    const guessed = list.map((f) => guessEvidenceType(f.name)).find(Boolean);
    if (guessed) setType(guessed);
  }

  async function upload() {
    if (busy || files.length === 0) return;
    setBusy(true);
    setFailure(null);

    const form = new FormData();
    form.append("type", type);
    if (systemId) form.append("systemId", systemId);
    for (const file of files) form.append("files", file);

    try {
      const response = await fetch("/api/records/evidence/upload", {
        method: "POST",
        body: form,
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFailure(String(json.error ?? "Nothing was uploaded."));
        return;
      }

      const answer = json as Result;
      onUploaded();

      /* Close only on a clean batch. If the server refused a file, the dialog
       * stays open holding the reason — closing on a partial result would
       * leave somebody believing twelve documents landed when eleven did. */
      if (answer.refused.length === 0) {
        onOpenChange(false);
        window.setTimeout(reset, 200);
        return;
      }

      setResult(answer);
      setFiles([]);
    } catch {
      setFailure("Could not reach the server. Nothing was uploaded.");
    } finally {
      setBusy(false);
    }
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) window.setTimeout(reset, 200);
      }}
    >
      <DialogContent className="max-h-[88vh] w-[min(40rem,calc(100vw-3rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="gap-1 border-b border-border p-4">
          <DialogTitle className="text-base">Upload evidence</DialogTitle>
          <DialogDescription className="text-xs">
            Each document is read for its text and then the file itself is
            discarded — the record keeps a preview, not a copy. Everything
            arrives unverified
            {systemId
              ? `, filed against ${systemName ?? "this system"} and linked to no control.`
              : " and linked to nothing."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[56vh] space-y-4 overflow-y-auto p-4">
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              accept(e.target.files);
              // Cleared so picking the same file twice fires again.
              e.target.value = "";
            }}
          />

          <button
            type="button"
            onClick={() => picker.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              accept(e.dataTransfer.files);
            }}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 transition-colors",
              dragging
                ? "border-primary bg-primary/5"
                : "border-border bg-secondary/20 hover:border-muted-foreground/40 hover:bg-secondary/40",
            )}
          >
            <UploadCloud className="size-7 text-muted-foreground" aria-hidden />
            <div className="space-y-1 text-center">
              <p className="text-sm font-medium">
                Drop documents, or click to choose them
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, Word, Excel, CSV or plain text. Up to 25 at a time.
              </p>
            </div>
          </button>

          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <p className="font-mono text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground">
                  Filing as
                </p>
                <Select
                  value={type}
                  onValueChange={(next) => setType(next as EvidenceType)}
                >
                  <SelectTrigger size="sm" className="w-56 font-normal">
                    <SelectValue>{EVIDENCE_TYPE[type]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(EVIDENCE_TYPE) as EvidenceType[]).map((value) => (
                      <SelectItem key={value} value={value}>
                        {EVIDENCE_TYPE[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="xs"
                  className="ml-auto"
                  onClick={() => setFiles([])}
                >
                  Clear
                </Button>
              </div>

              <ul className="divide-y divide-border/60 rounded-lg border border-border">
                {files.map((file, i) => (
                  <li
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-2 px-3 py-2 text-xs"
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {titleFromFilename(file.name)}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular">
                      {Math.max(1, Math.round(file.size / 1024))} KB
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result && (
            /* A partial batch. The refusals are named because a count would
             * leave somebody re-reading twelve filenames to work out which. */
            <div className="space-y-2">
              {result.stored.length > 0 && (
                <p className="flex items-start gap-2 text-xs text-ok">
                  <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>
                    {result.stored.length} filed.
                    {result.stored.some((s) => !s.hasText) &&
                      " Some had no readable text and were filed without a preview — usually a scan."}
                  </span>
                </p>
              )}
              <ul className="space-y-1">
                {result.refused.map((row) => (
                  <li
                    key={row.filename}
                    className="flex items-start gap-1.5 text-[0.6875rem] leading-snug text-critical"
                  >
                    <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                    <span>
                      <span className="font-medium">{row.filename}:</span> {row.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/40 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {failure ? (
              <span className="text-critical">{failure}</span>
            ) : files.length === 0 ? (
              "Nothing chosen yet."
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {files.length} document{files.length === 1 ? "" : "s"}
                </span>{" "}
                · {Math.max(1, Math.round(total / 1024))} KB
              </>
            )}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {result ? "Close" : "Cancel"}
            </Button>
            <Button size="sm" onClick={upload} disabled={busy || files.length === 0}>
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <UploadCloud aria-hidden />
              )}
              {busy
                ? "Reading…"
                : `Upload ${files.length} document${files.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
