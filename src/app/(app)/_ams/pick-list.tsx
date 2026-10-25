"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/**
 * The list of things a dialog is choosing between, and what a half-finished
 * batch says afterwards.
 *
 * Extracted the moment there was a second caller rather than the third: the
 * profile's "Link existing" dialogs and its "Claim controls" dialog are picking
 * different things out of different tables, but the row, the blocked-row
 * treatment and the partial-batch sentence are the same decisions in both, and
 * two copies of a decision is two places to change it and one place somebody
 * forgets.
 *
 * What is *not* here is the fetching, the candidate filtering or the copy. Those
 * are the parts that genuinely differ per register, and a shared component that
 * tried to own them would need a flag per caller.
 */

export interface Candidate {
  id: string;
  title: string;
  /** Where it sits now, in the words the person needs to make the choice. */
  note: string;
  /** Present when the record is shown but cannot be chosen, and says why. */
  blocked?: string;
  /**
   * Present when the record *can* be chosen but choosing it does something the
   * label does not imply — unlinking a document's last system makes it
   * organisation-wide rather than detached, for instance. Distinct from
   * `blocked` because a warning that disabled the row would be a refusal, and
   * this is a consequence somebody is entitled to accept.
   */
  warning?: string;
  /** The version the client read, for the kinds whose store checks it. */
  version?: number;
}

/**
 * One row in the list.
 *
 * A blocked row keeps its place rather than being filtered out. Somebody
 * looking for the internal audit report needs to find it and read why it is not
 * on offer; a list it is missing from is a list they conclude is broken.
 */
export function PickRow({
  candidate,
  checked,
  onToggle,
  radio,
}: {
  candidate: Candidate;
  checked: boolean;
  /** Checkbox rows only. A radio row is driven by the group's `onValueChange`. */
  onToggle: () => void;
  radio?: boolean;
}) {
  const blocked = Boolean(candidate.blocked);
  const flagged = blocked || Boolean(candidate.warning);
  const id = `pick-${candidate.id}`;

  /* `id` and `htmlFor` rather than a `<label>` wrapped around the control, which
   * is the pattern the rest of these dialogs use and not a style choice: Base
   * UI renders a real hidden `<input>` beside its button, so a wrapping label
   * re-dispatches a click that landed on the button and the two toggles cancel
   * out. */
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors",
        "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        blocked
          ? "border-border/60 opacity-60"
          : checked
            ? "border-primary/50 bg-primary/5"
            : "border-border hover:bg-secondary/50",
      )}
    >
      {radio ? (
        <RadioGroupItem id={id} value={candidate.id} disabled={blocked} className="mt-0.5" />
      ) : (
        <Checkbox
          id={id}
          className="mt-0.5"
          checked={checked}
          disabled={blocked}
          onCheckedChange={() => onToggle()}
        />
      )}
      <div className="space-y-0.5">
        <Label
          htmlFor={id}
          className={cn(
            "text-[0.8125rem] font-medium",
            blocked ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          {candidate.title}
        </Label>
        <p
          className={cn(
            "text-[0.6875rem] leading-relaxed",
            flagged ? "text-warn" : "text-muted-foreground",
          )}
        >
          {candidate.blocked ?? candidate.warning ?? candidate.note}
        </p>
      </div>
    </div>
  );
}

/**
 * What a half-finished batch says.
 *
 * Names the reason rather than counting the failures: "2 refused" is not
 * something anybody can check against what they meant to tick, and the reasons
 * these routes give are the whole explanation of a rule the person may not know
 * yet. Distinct reasons only — twenty controls refused for one reason is one
 * sentence, not twenty.
 */
export function partialNote(
  /** What did land, already worded — or null when nothing did. */
  landed: string | null,
  refused: { reason: string }[],
): string {
  const reasons = [...new Set(refused.map((row) => row.reason))].join(" ");
  return landed ? `${landed} ${reasons}` : reasons;
}
