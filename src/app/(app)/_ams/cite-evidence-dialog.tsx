"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { EVIDENCE_TYPE, VERIFICATION, formatDate, isOverdue } from "@/lib/ams/labels";
import { useWorkspace } from "@/lib/ams/workspace-context";
import type { ControlApplicability, FrameworkControl } from "@/lib/ams/types";
import { CreateDialog } from "./create-dialog";
import { PickRow, partialNote, type Candidate } from "./pick-list";

/**
 * Putting documents against a control, and taking them off it again.
 *
 * **The join nothing could write.** A control's evidence is `ai_evidence_link`
 * rows read backwards, and until this dialog the only thing that ever created
 * one was the demo seed — the upload route files every document citing nothing,
 * and "Link existing" attaches documents to *systems*. So an organisation that
 * was not the seed watched every readiness figure sit at zero while the evidence
 * record page told it to "link it to the control it supports".
 *
 * **One component for both directions**, unlike linking, which needs two. That
 * asymmetry is not carelessness: over a *system*, linking a risk moves a column
 * and linking a document adds to a set, so the two dialogs differ in what they
 * may offer and whether they take one record or many. Over a single control
 * there is one join, one shape and one question — which of these documents
 * proves it — and the second direction is the first read backwards. The argument
 * `unlink-from-system-dialog.tsx` makes for covering four tabs at once.
 *
 * **Not `LinkRecordDialog`, and no `RecordKind` is invented.** The thing being
 * picked *is* a register — evidence — but the thing it is being attached to is a
 * control, which has no `RECORD_KINDS` entry, no export columns and no trash.
 * `LinkRecordDialog` is built around a system id and the three registers that
 * can carry one. What the two genuinely share — the row, the blocked-row
 * treatment, the partial-batch sentence — lives in `pick-list.tsx`.
 *
 * **A lapsed document is offered, not blocked.** It is still the document the
 * control rests on, and the panel behind this dialog exists to say so: citing it
 * moves the evidence count and deliberately does *not* move the readiness
 * figure, because `isUsableEvidence` asks whether it is verified and unexpired.
 * Refusing to cite it would hide a real dependency rather than surface a weak
 * one.
 */
export function CiteEvidenceDialog({
  mode,
  open,
  onOpenChange,
  control,
  row,
}: {
  mode: "cite" | "uncite";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  control: FrameworkControl;
  row: ControlApplicability;
}) {
  const router = useRouter();
  const ws = useWorkspace();

  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /* Emptied as the dialog opens, during render rather than in an effect — the
   * same reason `useCreateForm` does it there: an effect would paint the
   * previous selection for a frame first. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setChosen([]);
    setFailure(null);
  }

  const cited = new Set(row.linkedEvidenceIds);
  const candidates: Candidate[] = ws.evidence
    .filter((doc) => (mode === "cite" ? !cited.has(doc.id) : cited.has(doc.id)))
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      note: describe(doc),
    }));

  function toggle(id: string) {
    setFailure(null);
    setChosen((prev) =>
      prev.includes(id) ? prev.filter((other) => other !== id) : [...prev, id],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (chosen.length === 0 || saving) return;

    setSaving(true);
    setFailure(null);

    try {
      const response = await fetch(`/api/records/evidence/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frameworkId: row.frameworkId,
          controlId: row.controlId,
          evidenceIds: chosen,
        }),
      });
      const json = (await response.json()) as {
        error?: string;
        cited?: { id: string }[];
        uncited?: { id: string }[];
        refused?: { id: string; reason: string }[];
      };

      if (!response.ok) {
        setFailure(json.error ?? FAILURE[mode]);
        return;
      }

      const landed = (mode === "cite" ? json.cited : json.uncited) ?? [];
      const refused = json.refused ?? [];

      // Whatever landed changes the panel behind the dialog, and every readiness
      // figure derived from it, so it is caught up before anything is decided
      // about closing.
      if (landed.length > 0) router.refresh();

      /* Close only on a clean batch — the same call the link dialogs make. What
       * stays ticked is exactly what did not land, so submitting again retries
       * the failures rather than the whole list. */
      if (refused.length > 0) {
        setChosen(refused.map((entry) => entry.id));
        setFailure(partialNote(landedNote(mode, landed.length), refused));
        return;
      }

      onOpenChange(false);
    } catch {
      setFailure(`Could not reach the server. Nothing was ${mode}d.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "cite" ? "Cite evidence on this control" : "Take evidence off this control"}
      description={description(mode, control)}
      saving={saving}
      failure={failure}
      submitLabel={submitLabel(mode, chosen.length)}
      savingLabel={mode === "cite" ? "Citing…" : "Removing…"}
      onSubmit={submit}
    >
      {candidates.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
          {EMPTY[mode]}
        </p>
      ) : (
        <div className="space-y-2">
          {candidates.map((candidate) => (
            <PickRow
              key={candidate.id}
              candidate={candidate}
              checked={chosen.includes(candidate.id)}
              onToggle={() => toggle(candidate.id)}
            />
          ))}
        </div>
      )}

      {candidates.length > 0 && (
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          {FOOTNOTE[mode]}
        </p>
      )}
    </CreateDialog>
  );
}

/* ---------------------------------------------------------------- the copy */

const FAILURE: Record<"cite" | "uncite", string> = {
  cite: "Those documents could not be cited on this control.",
  uncite: "Those documents could not be taken off this control.",
};

function description(mode: "cite" | "uncite", control: FrameworkControl): string {
  if (mode === "cite") {
    return `Say which documents already in the register demonstrate ${control.officialRef} ${control.shortTitle}. A document can prove many controls at once, so citing it here takes it away from none of them.`;
  }
  return `Take documents off ${control.officialRef} ${control.shortTitle}. Nothing is deleted: each one stays in the evidence register, keeps every system it supports and keeps every other control it proves.`;
}

const FOOTNOTE: Record<"cite" | "uncite", string> = {
  cite: "Documents already cited on this control are not listed — they are on the panel behind this dialog. An expired or unverified document can be cited: it will show here and count for nothing in the readiness figure until it is verified, which is the state worth seeing rather than hiding.",
  uncite:
    "Taking away the last document leaves the control with nothing proving it, and the readiness figure will fall to say so. That is the number being corrected, not a number being lost.",
};

const EMPTY: Record<"cite" | "uncite", string> = {
  cite: "Nothing to cite. Every document in the register is already on this control — or the register is empty, and evidence has to be uploaded before it can prove anything.",
  uncite: "Nothing to take off. This control cites no documents.",
};

/** This dialog's words for what did land, for a partial batch. */
function landedNote(mode: "cite" | "uncite", count: number): string | null {
  if (count === 0) return null;
  const noun = count === 1 ? "1 document" : `${count} documents`;
  return mode === "cite" ? `${noun} cited.` : `${noun} taken off.`;
}

function submitLabel(mode: "cite" | "uncite", count: number): string {
  if (mode === "cite") {
    if (count === 0) return "Cite documents";
    return count === 1 ? "Cite 1 document" : `Cite ${count} documents`;
  }
  if (count === 0) return "Remove documents";
  return count === 1 ? "Remove 1 document" : `Remove ${count} documents`;
}

/**
 * Where a document stands, in the words somebody needs to choose it.
 *
 * The verification state is the whole reason this is not a title and a date: a
 * lapsed policy and a verified one look identical in a list of names, and the
 * one being ticked decides whether the control ends up provable or only
 * documented.
 */
function describe(doc: {
  type: keyof typeof EVIDENCE_TYPE;
  verificationState: keyof typeof VERIFICATION;
  collectedAt: string;
  expiresAt: string | null;
}): string {
  const parts = [
    EVIDENCE_TYPE[doc.type],
    VERIFICATION[doc.verificationState].label,
    `collected ${formatDate(doc.collectedAt)}`,
  ];
  if (doc.expiresAt) {
    parts.push(
      `${isOverdue(doc.expiresAt) ? "expired" : "expires"} ${formatDate(doc.expiresAt)}`,
    );
  }
  return parts.join(" · ");
}
