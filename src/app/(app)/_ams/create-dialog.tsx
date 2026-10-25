"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/**
 * The shape every "create one of these" dialog has, written once.
 *
 * Four registers now open a form in a modal, validate it against the schema the
 * route parses, and post it: the inventory registers a system, and the risk,
 * finding and assessment registers each add their own record. What differs
 * between them is the fields. Everything else — where the error under an input
 * goes, where the failure belonging to no field goes, what the button says while
 * it is saving, what happens to the form after a success — is identical, and
 * four copies of that are four chances for one dialog to start behaving unlike
 * its neighbours in a way nobody notices until a customer reports it.
 *
 * **Two rules are baked in here rather than left to each caller.**
 *
 * *Validate on the client as a courtesy; the server parse is the rule.* The
 * client parse exists so the messages land under the inputs that caused them,
 * which a 400 cannot do on its own. It is never the check — the route parses the
 * same schema and is the one that stores the row.
 *
 * *No optimistic row.* The dialog reports what the server saved and the register
 * picks the record up from the next server render. A register that showed a row
 * it did not manage to save is the one failure worth a round trip, because the
 * whole argument for these registers is that they are what is true.
 */

/**
 * The one method this needs off a Zod schema.
 *
 * Described structurally rather than as a `ZodType` so the hook does not have to
 * thread Zod's input and output generics through every caller — the callers pass
 * the same schema their route parses, and what the hook does with it is call
 * `safeParse` and read the issues.
 */
export interface FormParser<Output> {
  safeParse(value: unknown):
    | { success: true; data: Output }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> };
      };
}

export type FormErrors<Values> = Partial<Record<keyof Values, string>>;

/**
 * The state and the round trip behind one create form.
 *
 * `resultKey` names the property the route puts the saved record under
 * (`{ ok: true, risk }`), so a caller that wants the new row — to link to it, or
 * to scroll to it — gets the server's copy rather than the one it sent.
 */
export function useCreateForm<Values extends object, Saved>({
  schema,
  blank,
  open,
  endpoint,
  resultKey,
  failureNote,
  onCreated,
}: {
  schema: FormParser<unknown>;
  /**
   * A fresh set of starting values.
   *
   * A function rather than an object because two of these forms default a date
   * from the clock, and the dialog is mounted with the register rather than when
   * somebody opens it — so a constant computed at mount would offer yesterday's
   * date to anybody who left the tab open overnight. Called again on every
   * opening, which is the moment the defaults are supposed to describe.
   */
  blank: () => Values;
  /** Whether the dialog is on screen. Opening it returns the form to blank. */
  open: boolean;
  endpoint: string;
  resultKey: string;
  /** What to say when the server refuses without naming a field. */
  failureNote: string;
  onCreated: (saved: Saved) => void;
}) {
  const [values, setValues] = useState<Values>(blank);
  const [errors, setErrors] = useState<FormErrors<Values>>({});
  const [saving, setSaving] = useState(false);
  /** A failure the form cannot pin on one field — refused, offline, conflicted. */
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * Blank the form as it opens, during render rather than in an effect.
   *
   * An effect would clear the fields after the dialog had already painted with
   * the last attempt's contents in them, which is visible. This is React's own
   * pattern for state that derives from a prop changing: notice the transition,
   * set, and re-render before anything reaches the screen. Clearing on *open*
   * rather than on close is what lets the closing animation play out over a form
   * that still looks like the one somebody was filling in.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValues(blank());
      setErrors({});
      setFailure(null);
    }
  }

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    // Clear the message the moment the field is touched. Leaving it up while
    // somebody is fixing it reads as the form arguing with them.
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    setFailure(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: FormErrors<Values> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Values;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setSaving(true);
    setFailure(null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        // A per-field complaint belongs under its field; anything else — a
        // refusal, a 500 — goes at the foot of the form, where the button is.
        if (json.fields && typeof json.fields === "object") {
          setErrors(json.fields as FormErrors<Values>);
        }
        setFailure(json.fields ? null : String(json.error ?? failureNote));
        return;
      }

      // Nothing is cleared here: the caller closes the dialog, and the next
      // opening blanks it. Clearing now would empty the form on screen while it
      // was still animating out.
      onCreated(json[resultKey] as Saved);
    } catch {
      setFailure("Could not reach the server. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  return { values, errors, saving, failure, set, submit };
}

/**
 * The modal, the scrolling body and the footer — the parts that are the same
 * every time.
 *
 * The body scrolls and the footer does not, so the button somebody is looking
 * for is on screen whatever the length of the form, and the failure message sits
 * beside it rather than above the fold.
 */
export function CreateDialog({
  open,
  onOpenChange,
  title,
  description,
  saving,
  failure,
  submitLabel,
  savingLabel,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  saving: boolean;
  failure: string | null;
  submitLabel: string;
  savingLabel: string;
  onSubmit: (event: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(40rem,calc(100vw-3rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="gap-1 border-b border-border p-4">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate>
          <div className="max-h-[64vh] space-y-4 overflow-y-auto p-4">{children}</div>

          <div className="flex items-center justify-end gap-3 border-t border-border bg-muted/40 px-4 py-3">
            {failure && (
              <p role="alert" className="mr-auto text-xs text-critical">
                {failure}
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              {saving ? savingLabel : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One labelled input, with its help text above it and its complaint below. */
export function Field({
  label,
  help,
  error,
  htmlFor,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </Label>
      {help && <p className="text-[0.6875rem] text-muted-foreground">{help}</p>}
      {children}
      {error && <p className="text-[0.6875rem] text-critical">{error}</p>}
    </div>
  );
}

/**
 * A select over a list of records, with a placeholder when nothing is chosen.
 *
 * Every one of these forms needs the same thing three or four times — a person,
 * a system, a use case — and the shadcn `Select` needs four nested components to
 * say it. The placeholder is `<span>` rather than the trigger's own
 * `placeholder` prop because the value is a record id and the label is a name:
 * `SelectValue` would render the id.
 */
export function ChoiceValue({
  chosen,
  placeholder,
}: {
  chosen: string | undefined;
  placeholder: string;
}) {
  return chosen ? (
    <>{chosen}</>
  ) : (
    <span className="text-muted-foreground/60">{placeholder}</span>
  );
}
