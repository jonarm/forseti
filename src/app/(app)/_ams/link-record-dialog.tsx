"use client";

import { useState } from "react";

import { RadioGroup } from "@/components/ui/radio-group";
import { RECORD_KINDS } from "@/lib/ams/record-kinds";
import { useWorkspace } from "@/lib/ams/workspace-context";
import { CreateDialog } from "./create-dialog";
import { PickRow, partialNote, type Candidate } from "./pick-list";

/**
 * Attaching a record that already exists to the system whose profile you are on.
 *
 * The counterpart to the create dialogs, and one component for three registers
 * rather than three near-identical ones — the same argument `create-dialog.tsx`
 * makes for its own chrome. It reuses that chrome rather than building a second
 * modal, which is the mistake `evidence-upload-dialog.tsx` already embodies:
 * two dialogs with their own headers and footers drift, and the second one is
 * where the failure message ends up above the fold.
 *
 * **Two shapes, because the underlying act has two shapes.** `record-kinds.ts`
 * carries the full argument; what it means here is:
 *
 *   - **`attach` (evidence)** — tick boxes, many at once. A document carries a
 *     set of systems, so adding this one costs the others nothing.
 *   - **`file` (risk, finding)** — radio buttons, one at a time. The record
 *     carries a single `system_id`, so this writes a column that was empty, and
 *     offering a multi-select would imply a record can sit on two systems.
 *
 * **What is offered is the whole safety story.** For a risk or a finding, only
 * organisation-level records appear: one already on another system would be
 * moved rather than filed, and a picker that silently took a record off
 * somebody else's profile is the failure this design exists to avoid. For
 * evidence, documents with *no* system links are shown but disabled, with the
 * reason — they are organisation-wide and already count toward every system,
 * so linking one here would narrow it and quietly drop it out of every other
 * system's coverage figure. Showing them greyed rather than hiding them is the
 * difference between a person understanding the rule and concluding the list is
 * broken.
 *
 * **No optimistic row.** The tab re-reads from the next server render, the same
 * as every create dialog: the register and the profile then agree because both
 * read the row the route actually wrote.
 */

/** The three registers whose records can be attached to a system after the fact. */
export type LinkableKind = "risk" | "finding" | "evidence";


export function LinkRecordDialog({
  kind,
  open,
  onOpenChange,
  systemId,
  systemName,
  onLinked,
}: {
  kind: LinkableKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  systemId: string;
  systemName: string;
  onLinked: () => void;
}) {
  const ws = useWorkspace();
  const def = RECORD_KINDS[kind];
  const multiple = def.features.link === "attach";

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

  const candidates = candidatesFor(kind, ws, systemId);
  const offered = candidates.filter((c) => !c.blocked);

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

    try {
      const response = await fetch(ENDPOINT[kind], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyFor(kind, chosen, systemId, candidates)),
      });
      const json = (await response.json()) as {
        error?: string;
        linked?: { id: string }[];
        refused?: { id: string; reason: string }[];
      };

      if (!response.ok) {
        setFailure(json.error ?? FAILURE[kind]);
        return;
      }

      /* Filing one record has no partial case: the route either wrote the
       * column or answered why it would not. */
      if (!multiple) {
        onLinked();
        onOpenChange(false);
        return;
      }

      const linked = json.linked ?? [];
      const refused = json.refused ?? [];

      // Whatever landed is real, so the tab behind the dialog is caught up
      // before anything is decided about closing.
      if (linked.length > 0) onLinked();

      /*
       * **Close only on a clean batch.** A request can succeed and still refuse
       * half of what it was given — a document somebody else linked while this
       * dialog was open, or an organisation-wide one the list explained and
       * somebody ticked anyway. Closing on a partial result would leave
       * somebody believing twelve documents landed when eleven did, which is
       * the same call `evidence-upload-dialog.tsx` makes about its own batch.
       *
       * What stays selected is exactly what did not land, so submitting again
       * retries the failures rather than the whole list.
       */
      if (refused.length > 0) {
        setChosen(refused.map((row) => row.id));
        setFailure(partialNote(landedNote(linked.length), refused));
        return;
      }

      onOpenChange(false);
    } catch {
      setFailure("Could not reach the server. Nothing was linked.");
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
      savingLabel={multiple ? "Linking…" : "Filing…"}
      onSubmit={submit}
    >
      {offered.length === 0 ? (
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

      {offered.length > 0 && (
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          {FOOTNOTE[kind]}
        </p>
      )}
    </CreateDialog>
  );
}

/* ---------------------------------------------------------------- copy & wiring */

const ENDPOINT: Record<LinkableKind, string> = {
  evidence: "/api/records/evidence/link",
  risk: "/api/risks/file",
  finding: "/api/findings/file",
};

const TITLE: Record<LinkableKind, string> = {
  evidence: "Link existing evidence",
  risk: "File an existing risk here",
  finding: "File an existing finding here",
};

const FAILURE: Record<LinkableKind, string> = {
  evidence: "Those documents could not be linked.",
  risk: "That risk could not be filed against this system.",
  finding: "That finding could not be filed against this system.",
};

/** Says what the act costs, which is the one thing the three do differently. */
function description(kind: LinkableKind, systemName: string): string {
  if (kind === "evidence") {
    return `Attach documents already in the register to ${systemName}. A document can support many systems at once, so linking adds this one and takes nothing away from the others.`;
  }
  const noun = kind === "risk" ? "risk" : "finding";
  return `Put a ${noun} currently held at organisation level onto ${systemName}. A ${noun} belongs to one system at a time, so this fills in a system it never had.`;
}

const FOOTNOTE: Record<LinkableKind, string> = {
  evidence:
    "Documents already linked to this system are not listed — they are on the tab behind this dialog.",
  risk: "Only organisation-level risks appear. One already filed against another system is not offered: moving it is a decision for its own record.",
  finding:
    "Only organisation-level findings appear. One already filed against another system is not offered: moving it is a decision for its own record.",
};

const EMPTY: Record<LinkableKind, string> = {
  evidence:
    "Nothing to link. Every document in the register either already covers this system or is organisation-wide, which counts toward every system already.",
  risk: "No risks are held at organisation level. A risk raised from this system's own tab arrives here already.",
  finding:
    "No findings are held at organisation level. A finding raised from this system's own tab arrives here already.",
};

/** This register's words for what did land, for a partial batch. */
function landedNote(linked: number): string | null {
  if (linked === 0) return null;
  return linked === 1 ? "1 document linked." : `${linked} documents linked.`;
}

function submitLabel(kind: LinkableKind, count: number): string {
  if (kind !== "evidence") return "File on this system";
  if (count === 0) return "Link documents";
  return count === 1 ? "Link 1 document" : `Link ${count} documents`;
}

function bodyFor(
  kind: LinkableKind,
  chosen: string[],
  systemId: string,
  candidates: Candidate[],
): Record<string, unknown> {
  if (kind === "evidence") return { systemId, evidenceIds: chosen };

  const picked = candidates.find((c) => c.id === chosen[0]);
  if (kind === "risk") {
    /* The version this client read. `saveAiRisk` checks it, and a save that
     * silently discarded somebody else's edit is the bug they never find out
     * about. Findings carry no version, so their route is not sent one. */
    return { riskId: chosen[0], systemId, expectedVersion: picked?.version };
  }
  return { findingId: chosen[0], systemId };
}

/**
 * What this system could take on, read out of the workspace the page already
 * loaded.
 *
 * Derived rather than fetched, for the reason every register's figures are:
 * the profile has the whole workspace in memory, and a second query would be a
 * second definition of "belongs to this system" to keep in step with
 * `workspace.ts`.
 */
function candidatesFor(
  kind: LinkableKind,
  ws: ReturnType<typeof useWorkspace>,
  systemId: string,
): Candidate[] {
  if (kind === "evidence") {
    return ws.evidence
      .filter((doc) => !doc.linkedSystemIds.includes(systemId))
      .map((doc) => ({
        id: doc.id,
        title: doc.title,
        note: `Linked to ${systemNames(ws, doc.linkedSystemIds)}`,
        blocked:
          doc.linkedSystemIds.length === 0
            ? "Organisation-wide — already counts toward every system. Linking it here would take it away from the others."
            : undefined,
      }));
  }

  if (kind === "risk") {
    return ws.risks
      .filter((risk) => !risk.systemId)
      .map((risk) => ({
        id: risk.id,
        title: risk.title,
        note: `Organisation-level · ${risk.treatment} · ${risk.status}`,
        version: risk.version,
      }));
  }

  return ws.findings
    .filter((finding) => !finding.systemId)
    .map((finding) => ({
      id: finding.id,
      title: finding.title,
      note: `Organisation-level · ${finding.severity} · ${finding.source}`,
    }));
}

/** Names, not ids — the person choosing knows the systems by what they are called. */
function systemNames(ws: ReturnType<typeof useWorkspace>, ids: string[]): string {
  const names = ids.map((id) => ws.systemById(id)?.name ?? id);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
