"use client";

import { Link2, Unlink } from "lucide-react";
import { useState } from "react";

import { usePermissions, useWorkspace } from "@/lib/ams/workspace-context";
import { CreateDialog } from "./create-dialog";
import type { AIUseCase } from "@/lib/ams/types";
import { PickRow, partialNote, type Candidate } from "./pick-list";
import { Gated } from "./register-actions";

/**
 * Which systems implement this use case, changed from the use case's own record.
 *
 * The mirror of the profile tabs' link and unlink dialogs, standing on the other
 * side of the same join: those attach records *to a system*, this attaches
 * systems *to a purpose*. The register's own dialogs cannot serve here — they
 * are keyed by `RecordKind` and pick records, and what this picks is systems.
 * What all of them genuinely share — the row, the blocked-row treatment, the
 * partial-batch sentence — is `pick-list.tsx`, and is shared there.
 *
 * **One component, two directions**, because linking and unlinking a system are
 * the same act with the sign flipped: tick systems, submit, the relation
 * changes and nothing else does. Splitting them would be two copies of the
 * same list with two copies of the same failure handling.
 *
 * **Neither direction deletes anything.** Linking adds a row to
 * `ai_use_case_system`; unlinking removes one. The systems stay in the
 * inventory, the use case stays on its register, and what changes is only which
 * of them are recorded as doing this job.
 *
 * **The last system is refused, and the route is what refuses it.** A use case
 * with no systems is a legal row that means nothing — `readWorkspace` treats it
 * as orphaned and it drops out of every register at once, with no tombstone and
 * no trash entry. The dialog disables the tick rather than letting somebody
 * discover this from a 409, but the route is the gate: this is a courtesy.
 */

type Direction = "link" | "unlink";

/**
 * The button, beside the record's other actions.
 *
 * Reads its own statement so a caller cannot forget to gate it, the same as
 * `RegisterCreateButton` and `RegisterLinkButton`. Both directions ask for
 * `useCase: ["update"]` — the statement the routes check — rather than the
 * `create` that `RegisterLinkButton` uses for an `attach` register. Evidence
 * needs that exception because its resource has no `update`; a use case has
 * one, and changing which tools do a job is an edit to the use case.
 */
export function UseCaseSystemsButton({
  direction,
  onClick,
}: {
  direction: Direction;
  onClick: () => void;
}) {
  const { records } = usePermissions();

  return (
    <Gated
      allowed={records.useCase.update}
      action={
        direction === "link"
          ? "link a system to a use case"
          : "unlink a system from a use case"
      }
      onClick={onClick}
      icon={direction === "link" ? <Link2 aria-hidden /> : <Unlink aria-hidden />}
      label={direction === "link" ? "Link existing" : "Unlink"}
      variant="outline"
    />
  );
}

export function UseCaseSystemsDialog({
  direction,
  open,
  onOpenChange,
  useCaseId,
  useCaseName,
  systemIds,
  expectedVersion,
  onChanged,
}: {
  direction: Direction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  useCaseId: string;
  useCaseName: string;
  /** The systems recorded now, so the list can offer the complement. */
  systemIds: string[];
  expectedVersion?: number;
  /**
   * Handed the row the server saved, so the caller can replace its copy.
   *
   * The record page keeps the use case in local state and swaps in whatever the
   * route returned — including the new version, without which its next edit
   * would send a stale one and be refused.
   */
  onChanged: (saved: AIUseCase) => void;
}) {
  const { systems } = useWorkspace();

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

  const linked = new Set(systemIds);

  const candidates: Candidate[] =
    direction === "link"
      ? systems
          .filter((system) => !linked.has(system.id))
          .map((system) => ({
            id: system.id,
            title: system.name,
            note: `${system.vendor} · ${system.businessUnit}`,
          }))
      : systems
          .filter((system) => linked.has(system.id))
          .map((system) => ({
            id: system.id,
            title: system.name,
            note: `${system.vendor} · ${system.businessUnit}`,
            /* Everything cannot go. Blocked rather than absent, so somebody
             * looking for the system they meant to remove finds it and reads
             * why, instead of concluding the list is broken. */
            blocked:
              systemIds.length === 1
                ? "The only system implementing this use case. Link another one first, or delete the use case instead."
                : undefined,
          }));

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

    /* Caught here as well as in the route: unticking every box is the one way
     * to reach the refusal without the blocked row having said so. */
    if (direction === "unlink" && chosen.length === systemIds.length) {
      setFailure(
        "That would leave the use case with no system. Link another one first, or delete the use case instead.",
      );
      return;
    }

    setSaving(true);
    setFailure(null);

    try {
      const response = await fetch(`/api/use-cases/${direction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useCaseId, systemIds: chosen, expectedVersion }),
      });
      const json = (await response.json()) as {
        error?: string;
        added?: string[];
        removed?: string[];
        useCase?: AIUseCase;
      };

      if (!response.ok) {
        setFailure(json.error ?? FAILURE[direction]);
        return;
      }

      /* A link request can succeed having added nothing — every system chosen
       * was already recorded, because somebody else got there first. Saying so
       * beats closing on a result the person would read as their own work. */
      if (direction === "link" && (json.added?.length ?? 0) === 0) {
        setFailure(
          partialNote(null, [
            { reason: "Those systems were already recorded against this use case." },
          ]),
        );
        return;
      }

      if (json.useCase) onChanged(json.useCase);
      onOpenChange(false);
    } catch {
      setFailure("Could not reach the server. Nothing was changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CreateDialog
      open={open}
      onOpenChange={onOpenChange}
      title={direction === "link" ? "Link a system" : "Unlink a system"}
      description={description(direction, useCaseName)}
      saving={saving}
      failure={failure}
      submitLabel={submitLabel(direction, chosen.length)}
      savingLabel={direction === "link" ? "Linking…" : "Unlinking…"}
      onSubmit={submit}
    >
      {offered.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
          {EMPTY[direction]}
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
          {FOOTNOTE[direction]}
        </p>
      )}
    </CreateDialog>
  );
}

/* ---------------------------------------------------------------- copy */

const FAILURE: Record<Direction, string> = {
  link: "Those systems could not be linked.",
  unlink: "Those systems could not be unlinked.",
};

function description(direction: Direction, useCaseName: string): string {
  return direction === "link"
    ? `Record that another system also implements ${useCaseName}. One job is often done in more than one place, and each system keeps its own governance, risks and evidence.`
    : `Record that a system no longer implements ${useCaseName}. The system stays in the inventory and the use case stays on its register — only the link goes.`;
}

const FOOTNOTE: Record<Direction, string> = {
  link: `Systems already recorded against this use case are not listed — they are on the record behind this dialog. Adding one takes nothing away from the others.`,
  unlink:
    "A use case is implemented by at least one system, so the last one cannot be removed. If the job has stopped, delete the use case instead — the trash holds it for the retention window.",
};

const EMPTY: Record<Direction, string> = {
  link: "Every system in the inventory is already recorded against this use case.",
  unlink: "Only one system implements this use case, and it cannot be the one removed.",
};

function submitLabel(direction: Direction, count: number): string {
  const verb = direction === "link" ? "Link" : "Unlink";
  if (count === 0) return `${verb} systems`;
  return count === 1 ? `${verb} 1 system` : `${verb} ${count} systems`;
}
