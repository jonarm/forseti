"use client";

import { Unlink } from "lucide-react";
import { useState } from "react";

import { RadioGroup } from "@/components/ui/radio-group";
import { useWorkspace, usePermissions } from "@/lib/ams/workspace-context";
import { CreateDialog } from "./create-dialog";
import { PickRow, partialNote, type Candidate } from "./pick-list";
import { Gated } from "./register-actions";

/**
 * Taking something back off the system whose profile you are on.
 *
 * One dialog for all four tabs, because unlinking is a single act with a single
 * shape — choose from what this system currently has, confirm, and the record
 * survives somewhere else. Linking needs two components (`link-record-dialog`
 * for the three registers, `claim-controls-dialog` for the Statement of
 * Applicability) because it genuinely differs per tab: what may be offered, and
 * whether the act is additive or a move. Coming back the other way, the four
 * are the same.
 *
 * **Nothing here deletes anything.** A risk and a finding return to
 * organisation level and stay on their own registers. A document stays in the
 * evidence register and keeps every other system it supports. A control stays
 * in the Statement of Applicability and stays in scope for the organisation.
 * The tab is the only place they stop appearing, which is what makes this
 * offerable at all — the destructive act on each of these is Remove, and it
 * lives on the register behind its own confirmation.
 *
 * **The exceptions are named on the rows that carry them**, because two of the
 * four do something the word "unlink" does not imply:
 *
 *   - A document whose *only* system is this one becomes organisation-wide —
 *     an empty `linkedSystemIds` means every system, not none — so it starts
 *     counting toward the coverage of systems it was never attached to. It is
 *     still allowed: refusing would leave a document filed by mistake with no
 *     path to organisation-wide, since linking it elsewhere and unlinking here
 *     lands back at one link.
 *   - A risk that names a use case loses that reference too, because a use case
 *     names the job, and the risk named this system doing it — the pair is what
 *     the risk was about, so the half that survives on its own would be a claim
 *     nobody made.
 *
 * A control is the plain case in both directions — empty means no systems — and
 * a finding keeps its `controlId`, because a framework control belongs to no
 * system. `/api/applicability/unclaim` and `/api/findings/unfile` carry those
 * arguments.
 */

export type UnlinkKind = "risk" | "finding" | "evidence" | "control";

/** Whether the act writes one record or a batch — the same split as linking. */
const MULTIPLE: Record<UnlinkKind, boolean> = {
  evidence: true,
  control: true,
  risk: false,
  finding: false,
};

/**
 * The Unlink button, beside its tab's other actions.
 *
 * Reads its own statement so a caller cannot forget to gate it, the same as
 * `RegisterCreateButton` and `RegisterLinkButton`. The statements are not all
 * the mirror of the link button's, and the differences are deliberate:
 * `evidence` has no `update`, so writing a link is `create` and removing one is
 * `delete`; a control is not a register at all and reads the Statement of
 * Applicability's own flag.
 */
export function UnlinkButton({
  kind,
  onClick,
}: {
  kind: UnlinkKind;
  onClick: () => void;
}) {
  const permissions = usePermissions();
  const { records, editSoa } = permissions;

  const allowed =
    kind === "control"
      ? editSoa
      : kind === "evidence"
        ? records.evidence.delete
        : records[kind].update;

  return (
    <Gated
      allowed={allowed}
      action={ACTION[kind]}
      onClick={onClick}
      icon={<Unlink aria-hidden />}
      label="Unlink"
      variant="outline"
    />
  );
}

export function UnlinkFromSystemDialog({
  kind,
  open,
  onOpenChange,
  systemId,
  systemName,
  onUnlinked,
}: {
  kind: UnlinkKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  systemId: string;
  systemName: string;
  onUnlinked: () => void;
}) {
  const ws = useWorkspace();
  const multiple = MULTIPLE[kind];

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

  const candidates = candidatesFor(kind, ws, systemId);

  function toggle(id: string) {
    setFailure(null);
    setChosen((prev) =>
      multiple
        ? prev.includes(id)
          ? prev.filter((other) => other !== id)
          : [...prev, id]
        : [id],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (chosen.length === 0 || saving) return;

    setSaving(true);
    setFailure(null);

    const picked = candidates.filter((c) => chosen.includes(c.id));

    try {
      const response = await fetch(ENDPOINT[kind], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyFor(kind, picked, systemId)),
      });
      const json = (await response.json()) as {
        error?: string;
        unlinked?: { id: string }[];
        unclaimed?: { controlId: string }[];
        refused?: { id?: string; controlId?: string; reason: string }[];
      };

      if (!response.ok) {
        setFailure(json.error ?? FAILURE[kind]);
        return;
      }

      /* One record has no partial case: the route either wrote the row or
       * answered why it would not. */
      if (!multiple) {
        onUnlinked();
        onOpenChange(false);
        return;
      }

      const done = json.unlinked ?? json.unclaimed ?? [];
      const refused = json.refused ?? [];

      // Whatever landed changes what this tab shows, so it is caught up before
      // anything is decided about closing.
      if (done.length > 0) onUnlinked();

      /* Close only on a clean batch, and keep exactly what did not land ticked
       * so submitting again retries the failures rather than the whole list. */
      if (refused.length > 0) {
        const stillWanted = new Set(
          refused.map((row) => row.id ?? row.controlId).filter(Boolean) as string[],
        );
        setChosen(picked.filter((c) => stillWanted.has(c.recordId)).map((c) => c.id));
        setFailure(partialNote(landedNote(kind, done.length), refused));
        return;
      }

      onOpenChange(false);
    } catch {
      setFailure("Could not reach the server. Nothing was unlinked.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title={TITLE[kind]}
      description={description(kind, systemName)}
      saving={saving}
      failure={failure}
      submitLabel={submitLabel(kind, chosen.length)}
      savingLabel="Unlinking…"
      onSubmit={submit}
    >
      {candidates.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
          {EMPTY[kind]}
        </p>
      ) : multiple ? (
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
      ) : (
        <RadioGroup
          value={chosen[0] ?? null}
          onValueChange={(next) => toggle(String(next))}
          aria-label={TITLE[kind]}
          className="gap-2"
        >
          {candidates.map((candidate) => (
            <PickRow
              key={candidate.id}
              candidate={candidate}
              checked={chosen[0] === candidate.id}
              onToggle={() => toggle(candidate.id)}
              radio
            />
          ))}
        </RadioGroup>
      )}

      {candidates.length > 0 && (
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          {FOOTNOTE[kind]}
        </p>
      )}
    </CreateDialog>
  );
}

/* ---------------------------------------------------------------- copy & wiring */

/** A candidate plus the id the route actually needs back. */
type UnlinkCandidate = Candidate & { recordId: string; frameworkId?: string };

const ENDPOINT: Record<UnlinkKind, string> = {
  evidence: "/api/records/evidence/unlink",
  control: "/api/applicability/unclaim",
  risk: "/api/risks/unfile",
  finding: "/api/findings/unfile",
};

const ACTION: Record<UnlinkKind, string> = {
  evidence: "unlink evidence from a system",
  control: "unclaim a control from a system",
  risk: "unfile a risk from a system",
  finding: "unfile a finding from a system",
};

const TITLE: Record<UnlinkKind, string> = {
  evidence: "Unlink evidence",
  control: "Unclaim controls",
  risk: "Unfile a risk",
  finding: "Unfile a finding",
};

const FAILURE: Record<UnlinkKind, string> = {
  evidence: "Those documents could not be unlinked.",
  control: "Those controls could not be unclaimed.",
  risk: "That risk could not be unfiled.",
  finding: "That finding could not be unfiled.",
};

function description(kind: UnlinkKind, systemName: string): string {
  switch (kind) {
    case "evidence":
      return `Detach documents from ${systemName}. They stay in the evidence register and keep every other system they support — nothing is deleted.`;
    case "control":
      return `Take controls out of ${systemName}'s scope. They stay in the Statement of Applicability, and this system's coverage figure is recalculated from what is left.`;
    case "risk":
      return `Return a risk to organisation level. It stays on the risk register with its ratings and its owner, and stops being one of ${systemName}'s risks.`;
    case "finding":
      return `Return a finding to organisation level. It stays on the findings register with its severity and its due date, and stops being one of ${systemName}'s findings.`;
  }
}

const FOOTNOTE: Record<UnlinkKind, string> = {
  evidence:
    "Deleting a document is a different act and lives on the evidence register.",
  control:
    "The control stays in scope for the organisation. Only this system's claim on it is removed.",
  risk: "To delete the risk instead, use the risk register.",
  finding: "To delete the finding instead, use the findings register.",
};

const EMPTY: Record<UnlinkKind, string> = {
  evidence: "No documents are linked to this system.",
  control: "No controls are claimed against this system.",
  risk: "No risks are filed against this system.",
  finding: "No findings are filed against this system.",
};

function landedNote(kind: UnlinkKind, done: number): string | null {
  if (done === 0) return null;
  const noun = kind === "control" ? "control" : "document";
  const verb = kind === "control" ? "unclaimed" : "unlinked";
  return done === 1 ? `1 ${noun} ${verb}.` : `${done} ${noun}s ${verb}.`;
}

function submitLabel(kind: UnlinkKind, count: number): string {
  if (kind === "risk") return "Unfile this risk";
  if (kind === "finding") return "Unfile this finding";

  const noun = kind === "control" ? "control" : "document";
  const verb = kind === "control" ? "Unclaim" : "Unlink";
  if (count === 0) return `${verb} ${noun}s`;
  return count === 1 ? `${verb} 1 ${noun}` : `${verb} ${count} ${noun}s`;
}

function bodyFor(
  kind: UnlinkKind,
  picked: UnlinkCandidate[],
  systemId: string,
): Record<string, unknown> {
  switch (kind) {
    case "evidence":
      return { systemId, evidenceIds: picked.map((c) => c.recordId) };
    case "control":
      return {
        systemId,
        controls: picked.map((c) => ({
          frameworkId: c.frameworkId,
          controlId: c.recordId,
        })),
      };
    case "risk":
      /* The version this client read. Findings carry none, so their route is
       * not sent one — `saveAiFinding` has no such option. */
      return {
        riskId: picked[0]?.recordId,
        systemId,
        expectedVersion: picked[0]?.version,
      };
    case "finding":
      return { findingId: picked[0]?.recordId, systemId };
  }
}

/**
 * What this system currently holds, read out of the workspace the page already
 * loaded rather than fetched again.
 *
 * Each list is the same accessor the tab behind the dialog renders from, so the
 * dialog cannot offer something the tab is not showing.
 */
function candidatesFor(
  kind: UnlinkKind,
  ws: ReturnType<typeof useWorkspace>,
  systemId: string,
): UnlinkCandidate[] {
  if (kind === "evidence") {
    return ws.evidenceForSystem(systemId).map((doc) => ({
      id: doc.id,
      recordId: doc.id,
      title: doc.title,
      note:
        doc.linkedSystemIds.length > 1
          ? `Also supports ${doc.linkedSystemIds.length - 1} other system${doc.linkedSystemIds.length === 2 ? "" : "s"}.`
          : "",
      warning:
        doc.linkedSystemIds.length === 1
          ? "This is its only system. Unlinking makes the document organisation-wide, counting toward every system's coverage."
          : undefined,
    }));
  }

  if (kind === "control") {
    return ws.applicability
      .filter((row) => row.appliesToSystemIds.includes(systemId))
      .flatMap((row) => {
        const control = ws.controlById(row.controlId);
        if (!control) return [];
        return [
          {
            id: `${row.frameworkId}:${row.controlId}`,
            recordId: row.controlId,
            frameworkId: row.frameworkId,
            title: `${control.officialRef} — ${control.shortTitle}`,
            note:
              row.linkedEvidenceIds.length > 0
                ? `Carries ${row.linkedEvidenceIds.length} piece${row.linkedEvidenceIds.length === 1 ? "" : "s"} of evidence for this system.`
                : "Carries no evidence, so it is currently counted as a gap.",
          },
        ];
      });
  }

  if (kind === "risk") {
    return ws.risksForSystem(systemId).map((risk) => {
      const useCase = risk.useCaseId
        ? ws.getUseCase(risk.useCaseId)?.name ?? risk.useCaseId
        : null;
      return {
        id: risk.id,
        recordId: risk.id,
        title: risk.title,
        note: `${risk.treatment} · ${risk.status}`,
        version: risk.version,
        warning: useCase
          ? `Also filed against the use case ${useCase}. Unfiling clears that too — the risk was about this system doing that job.`
          : undefined,
      };
    });
  }

  return ws.findingsForSystem(systemId).map((finding) => ({
    id: finding.id,
    recordId: finding.id,
    title: finding.title,
    note: `${finding.severity} · ${finding.status} · raised ${finding.raisedAt}`,
  }));
}
