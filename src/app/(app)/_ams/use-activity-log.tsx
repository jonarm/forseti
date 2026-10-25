"use client";

import { useCallback, useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import type { ActivityEvent } from "@/lib/ams/types";
import type { AuditSubjectKind } from "@/lib/audit";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * The change history for one record, seeded from the fixtures.
 *
 * Decision 5 says every screen with state shows actor, action, before → after
 * and timestamp. The registers record *decisions* — who accepted, who verified —
 * but a decision is not a history: editing a residual, reassigning an owner or
 * rewriting a corrective action all move the record and none of them is a
 * decision. This hook is what makes those visible.
 *
 * The rule that keeps the trail readable: **record commits, not keystrokes.** A
 * select fires on change because choosing is the commit. A textarea fires on
 * blur, comparing against what it held on focus, because the commit is finishing
 * the sentence. A log with one entry per character is a log nobody opens twice.
 */
export function useActivityLog(subjectId: string, subjectKind: AuditSubjectKind) {
  const { activityFor } = useWorkspace();
  const [events, setEvents] = useState<ActivityEvent[]>(() => activityFor(subjectId));
  const seq = useRef(0);

  const record = useCallback(
    (action: string, field: string | null, before: string | null, after: string | null) => {
      if (before === after) return;
      seq.current += 1;
      setEvents((prev) => [
        {
          id: `session-${subjectId}-${seq.current}`,
          subjectKind,
          subjectId,
          // In the real product this is the signed-in user.
          actorId: "p-anders",
          action,
          field,
          before,
          after,
          // A reason is captured at the point somebody is asked for one, and
          // these local edits never ask. Persisted writes carry it on `Actor`.
          reason: null,
          at: new Date().toISOString(),
          viaSuggestionId: null,
        },
        ...prev,
      ]);
    },
    [subjectId, subjectKind],
  );

  return { events, record };
}

/**
 * A textarea that reports what changed, once, when the person stops typing.
 *
 * Snapshots on focus and compares on blur. Anything shorter than that produces
 * a trail of half-written sentences; anything longer means an edit that is never
 * recorded because the page was navigated away from.
 *
 * Where `onCommit` saves rather than only logging, blur is also the write — so a
 * caller whose field persists passes `disabled` and `title` to refuse the edit
 * the way every other refused affordance in the product does: greyed out with
 * the reason on it, never missing.
 */
export function TrackedTextarea({
  value,
  onChange,
  onCommit,
  rows = 3,
  placeholder,
  className,
  ariaLabel,
  disabled,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (before: string, after: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  title?: string;
}) {
  const atFocus = useRef(value);

  return (
    <Textarea
      rows={rows}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      title={title}
      onFocus={() => {
        atFocus.current = value;
      }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        if (atFocus.current !== value) onCommit(atFocus.current, value);
      }}
    />
  );
}

/** Long prose in a before → after chip is unreadable; a clipped form is not. */
export function clip(text: string | null, max = 60): string | null {
  if (!text) return text;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
