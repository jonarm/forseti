"use client";

/**
 * Editing one field of a record in place.
 *
 * The rule these all follow is **record commits, not keystrokes**. A select
 * commits on change, because choosing *is* the commit; a text field commits on
 * blur, comparing against what it held on focus. A log with one entry per
 * character is a log nobody opens twice, and every one of these writes to the
 * activity trail through the route.
 *
 * Nothing here holds the record. Each editor holds only the draft of its own
 * field while it is being typed into, and hands the committed value up — the
 * saved value always comes back down from the server.
 */
import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** The label column every read-only `Row` uses, so an edited row does not jump. */
const ROW = "flex flex-wrap gap-x-6 gap-y-1 py-2";
const LABEL = "w-52 shrink-0 pt-1.5 text-sm text-muted-foreground";
const FIELD = "min-w-0 flex-1 space-y-1";

export function EditRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={ROW}>
      <dt className={LABEL}>{label}</dt>
      <dd className={FIELD}>
        {children}
        {hint && <p className="text-[0.6875rem] text-muted-foreground/70">{hint}</p>}
      </dd>
    </div>
  );
}

/**
 * A single line of text, committed when focus leaves it.
 *
 * Escape restores what it held on focus and gives up the field — a text box you
 * cannot back out of makes people afraid to look at one.
 */
export function EditText({
  value,
  onCommit,
  disabled,
  placeholder,
  multiline,
}: {
  value: string;
  onCommit: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const [focused, setFocused] = useState<string | null>(null);

  // The server is the source of truth; adopt what it sends unless it would pull
  // the field out from under somebody mid-edit. Adjusted during render rather
  // than in an effect — an effect would render the stale value once first, and
  // React flags the cascading re-render it causes.
  if (value !== synced && focused === null) {
    setSynced(value);
    setDraft(value);
  }

  function commit() {
    // A blur without an intervening focus is not a commit. React fires one on
    // unmount, and `draft` can still hold the edited text while `value` is a
    // render behind — which would PATCH twice and write the change into the
    // activity trail twice. `focused` being null is what says "already handled".
    if (focused === null) return;

    const next = draft.trim();
    const previous = focused.trim();
    setFocused(null);
    if (next !== previous) onCommit(next);
  }

  const props = {
    value: draft,
    disabled,
    placeholder,
    onFocus: () => setFocused(draft),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft(focused ?? value);
        setFocused(null);
        (e.target as HTMLElement).blur();
      }
    },
  };

  return multiline ? (
    <Textarea {...props} rows={4} className="text-sm" />
  ) : (
    <Input {...props} className="h-8 text-sm" />
  );
}

/** A whole number. Blank means "not recorded", which is not the same as zero. */
export function EditNumber({
  value,
  onCommit,
  disabled,
}: {
  value: number;
  onCommit: (next: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value || ""));
  const [synced, setSynced] = useState(value);
  const [editing, setEditing] = useState(false);

  if (value !== synced && !editing) {
    setSynced(value);
    setDraft(String(value || ""));
  }

  return (
    <Input
      type="number"
      min={0}
      inputMode="numeric"
      value={draft}
      disabled={disabled}
      placeholder="Not recorded"
      className="h-8 w-40 text-sm"
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const parsed = Number.parseInt(draft, 10);
        const next = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
        if (next !== value) onCommit(next);
      }}
    />
  );
}

/** A date, or nothing. Committed on change — a date picker has no half-state. */
export function EditDate({
  value,
  onCommit,
  disabled,
}: {
  value: string | null;
  onCommit: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <Input
      type="date"
      value={value ? value.slice(0, 10) : ""}
      disabled={disabled}
      className="h-8 w-44 text-sm"
      onChange={(e) => onCommit(e.target.value)}
    />
  );
}

/**
 * A select cannot hold an empty string as an option value, so "nothing chosen"
 * needs a sentinel that never collides with a real id.
 */
const NOTHING = "__none__";

/**
 * One of a fixed set. Commits on change, because choosing is the commit.
 *
 * `clearable` adds an explicit way back to nothing. An imported system arrives
 * unassigned by design — the owner column warns rather than blocking the row —
 * and an editor that can assign an owner but never unassign one makes that a
 * state the product can produce and not correct.
 */
export function EditSelect<T extends string>({
  value,
  options,
  onCommit,
  disabled,
  placeholder = "Choose one",
  clearable,
  clearLabel = "Unassigned",
}: {
  value: T | "";
  options: Array<{ value: T; label: string }>;
  onCommit: (next: T) => void;
  disabled?: boolean;
  placeholder?: string;
  clearable?: boolean;
  clearLabel?: string;
}) {
  /*
   * `items` is what lets the closed trigger show a *label*.
   *
   * Base UI resolves the selected label from the items it knows about, and it
   * only learns them from `SelectItem` when the popup has been opened at least
   * once. Without this, a field arriving with a value already set renders the
   * raw stored value — an owner reads as "p-quinn" and a stage as "proposed"
   * until you happen to open the dropdown.
   */
  const items = [
    ...(clearable ? [{ value: NOTHING, label: clearLabel }] : []),
    ...options,
  ];

  return (
    <Select
      items={items}
      value={value || (clearable ? NOTHING : undefined)}
      disabled={disabled}
      onValueChange={(next) => onCommit((next === NOTHING ? "" : next) as T)}
    >
      <SelectTrigger size="sm" className="w-full max-w-xs text-sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {clearable && (
          <SelectItem value={NOTHING}>
            <span className="text-muted-foreground">{clearLabel}</span>
          </SelectItem>
        )}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Yes or no, as a select rather than a switch — a switch hides which way is which. */
export function EditBoolean({
  value,
  onCommit,
  disabled,
  yes = "Yes",
  no = "No",
}: {
  value: boolean;
  onCommit: (next: boolean) => void;
  disabled?: boolean;
  yes?: string;
  no?: string;
}) {
  return (
    <EditSelect
      value={value ? "yes" : "no"}
      disabled={disabled}
      options={[
        { value: "yes", label: yes },
        { value: "no", label: no },
      ]}
      onCommit={(next) => onCommit(next === "yes")}
    />
  );
}

/**
 * A free list — hosting regions, sub-processors, certifications.
 *
 * Comma separated rather than a chip editor with its own add button: these are
 * pasted out of a contract or a config export far more often than they are
 * typed one at a time.
 */
export function EditList({
  value,
  onCommit,
  disabled,
  placeholder,
}: {
  value: string[];
  onCommit: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const joined = value.join(", ");
  const [draft, setDraft] = useState(joined);
  const [synced, setSynced] = useState(joined);
  const [editing, setEditing] = useState(false);

  if (joined !== synced && !editing) {
    setSynced(joined);
    setDraft(joined);
  }

  return (
    <Input
      value={draft}
      disabled={disabled}
      placeholder={placeholder ?? "Comma separated"}
      className="h-8 text-sm"
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const next = draft
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        if (next.join("\u0000") !== value.join("\u0000")) onCommit(next);
      }}
    />
  );
}

/**
 * Several from a fixed set, as toggles.
 *
 * Every option is on screen rather than behind a menu, because the question
 * these answer — which categories of data does this touch — is one people get
 * wrong by forgetting an option exists, not by mis-clicking.
 */
export function EditToggles<T extends string>({
  value,
  options,
  onCommit,
  disabled,
}: {
  value: T[];
  options: Array<{ value: T; label: string }>;
  onCommit: (next: T[]) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const chosen = new Set(value);

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = chosen.has(option.value);
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            aria-labelledby={name}
            onClick={() => {
              const next = on
                ? value.filter((v) => v !== option.value)
                : [...value, option.value];
              onCommit(next);
            }}
            className={cn(
              "rounded border px-2 py-0.5 text-xs transition-colors",
              on
                ? "border-brand/40 bg-brand/10 text-brand"
                : "border-border text-muted-foreground hover:bg-secondary/50",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
