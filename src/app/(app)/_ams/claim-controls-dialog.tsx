"use client";

import { useState } from "react";

import { useWorkspace } from "@/lib/ams/workspace-context";
import { CreateDialog } from "./create-dialog";
import { PickRow, partialNote, type Candidate } from "./pick-list";

/**
 * Claiming controls against the system whose profile you are on.
 *
 * A system's Controls tab has always been able to *show* the join —
 * `coverageForSystem` reads `appliesToSystemIds` and turns it into the coverage
 * figure the inventory reports — and never to add to it. Claiming happened in
 * the Statement of Applicability workbench, in React state that does not
 * survive a refresh. This is the first thing in the product that writes it.
 *
 * **Not `LinkRecordDialog`, and not a `RecordKind`.** A control is not a
 * register: it has no `RECORD_KINDS` entry, no export columns, no trash, and
 * inventing one so this could reuse that component would put four registers'
 * worth of machinery behind a checkbox list. What the two dialogs genuinely
 * share — the row, the blocked-row treatment, the partial-batch sentence —
 * lives in `pick-list.tsx` and is shared there.
 *
 * **Out-of-scope controls are shown, disabled, with the reason.** A control the
 * SoA marks `no` or `na` cannot be claimed against a system: it would enter the
 * coverage denominator the SoA says is empty, and the framework screen and this
 * one would report different totals. Hiding those rows would leave somebody
 * hunting for a control that is deliberately absent; showing them greyed
 * answers the question they came with.
 *
 * **Additive only.** Nothing here un-claims a control. Removing a claim lowers
 * a coverage figure the organisation may already have reported, so it belongs
 * where it can be confirmed against what it will change — not as the
 * side effect of unticking a box in a dialog called "Link existing".
 */
export function ClaimControlsDialog({
  open,
  onOpenChange,
  systemId,
  systemName,
  onClaimed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  systemId: string;
  systemName: string;
  onClaimed: () => void;
}) {
  const { applicability, controlById } = useWorkspace();

  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /* Emptied as the dialog opens, during render rather than in an effect — the
   * same reason `useCreateForm` does it there. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setChosen([]);
    setFailure(null);
  }

  /*
   * Every control not already claimed against this system, in the framework's
   * own order. Keyed by `frameworkId:controlId` because applicability is keyed
   * by both, and a control id alone would collide the moment a second framework
   * is in scope.
   */
  const candidates: (Candidate & { frameworkId: string; controlId: string })[] =
    applicability
      .filter((row) => !row.appliesToSystemIds.includes(systemId))
      .flatMap((row) => {
        const control = controlById(row.controlId);
        if (!control) return [];
        return [
          {
            id: `${row.frameworkId}:${row.controlId}`,
            frameworkId: row.frameworkId,
            controlId: row.controlId,
            title: `${control.officialRef} — ${control.shortTitle}`,
            note: control.requirementSummary,
            blocked:
              row.applicability === "yes"
                ? undefined
                : "Out of scope in the Statement of Applicability, so it cannot be claimed against a system.",
          },
        ];
      });

  const offered = candidates.filter((c) => !c.blocked);

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

    const picked = candidates.filter((c) => chosen.includes(c.id));

    try {
      const response = await fetch("/api/applicability/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemId,
          controls: picked.map(({ frameworkId, controlId }) => ({
            frameworkId,
            controlId,
          })),
        }),
      });
      const json = (await response.json()) as {
        error?: string;
        claimed?: { controlId: string }[];
        refused?: { controlId: string; reason: string }[];
      };

      if (!response.ok) {
        setFailure(json.error ?? "Those controls could not be claimed.");
        return;
      }

      const claimed = json.claimed ?? [];
      const refused = json.refused ?? [];

      // Whatever landed changes this system's coverage figure, so the tab
      // behind the dialog is caught up before anything is decided about closing.
      if (claimed.length > 0) onClaimed();

      /* Close only on a clean batch — the same call the evidence dialogs make.
       * What stays ticked is exactly what did not land. */
      if (refused.length > 0) {
        const stillWanted = new Set(refused.map((row) => row.controlId));
        setChosen(picked.filter((c) => stillWanted.has(c.controlId)).map((c) => c.id));
        setFailure(partialNote(landedNote(claimed.length), refused));
        return;
      }

      onOpenChange(false);
    } catch {
      setFailure("Could not reach the server. Nothing was claimed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Claim existing controls"
      description={`Put controls from the Statement of Applicability against ${systemName}. Claiming is what makes a control count toward this system's coverage — and what makes it a gap until evidence arrives.`}
      saving={saving}
      failure={failure}
      submitLabel={submitLabel(chosen.length)}
      savingLabel="Claiming…"
      onSubmit={submit}
    >
      {offered.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
          Nothing to claim. Every control the Statement of Applicability puts in
          scope is already claimed against this system.
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

      {offered.length > 0 && (
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          Controls already claimed against this system are not listed — they are
          on the tab behind this dialog. Removing a claim is not done here: it
          lowers a coverage figure that may already have been reported.
        </p>
      )}
    </CreateDialog>
  );
}

/** What did land, for a partial batch. */
function landedNote(claimed: number): string | null {
  if (claimed === 0) return null;
  return claimed === 1 ? "1 control claimed." : `${claimed} controls claimed.`;
}

function submitLabel(count: number): string {
  if (count === 0) return "Claim controls";
  return count === 1 ? "Claim 1 control" : `Claim ${count} controls`;
}
