"use client";

/**
 * Saving one field of one Statement of Applicability row, and saying so.
 *
 * Every editor on the workbench commits through here. The route works out what
 * actually moved and `saveApplicability` writes the activity entries, so this
 * holds only what is in flight and what failed.
 *
 * **No optimistic update.** The saved value comes back through
 * `router.refresh()` and the server render — the same call `useSystemPatch`
 * makes, and for the same reason: a Statement of Applicability that shows a
 * decision it did not manage to save is the one failure worth a round trip to
 * avoid. It is the document the whole certification rests on.
 *
 * **`saving` is keyed by control *and* field**, which is the one place this
 * diverges from the hook it is modelled on. `useSystemPatch` edits a single
 * record and can key by field name alone; this edits a table of a hundred rows,
 * where two people — or one person moving quickly — will have the same field
 * in flight on different controls, and a key of `implementationStatus` would
 * light up every row at once.
 */
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import type { ApplicabilityPatch } from "@/lib/ams/applicability-patch";

/** The key one field of one row is tracked under. Never leaves this file. */
function savingKey(controlId: string, field: string): string {
  return `${controlId}:${field}`;
}

export interface ApplicabilityPatcher {
  /** Send one row's changed fields. Resolves true when the row was saved. */
  commit: (controlId: string, patch: ApplicabilityPatch) => Promise<boolean>;
  /**
   * Whether a row — or one field of it — is in flight, so an editor can show
   * itself busy.
   *
   * A predicate rather than the list, so the key format stays in this file. A
   * caller matching on the raw strings would be a second definition of what a
   * key looks like, and the two would drift the day one of them learned about
   * a field whose name contains a colon.
   */
  isSaving: (controlId: string, field?: string) => boolean;
  error: string | null;
  dismiss: () => void;
}

export function useApplicabilityPatch(frameworkId: string): ApplicabilityPatcher {
  const router = useRouter();
  const [saving, setSaving] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(
    async (controlId: string, patch: ApplicabilityPatch) => {
      const fields = Object.keys(patch);
      if (fields.length === 0) return false;

      const keys = fields.map((field) => savingKey(controlId, field));
      setSaving((current) => [...current, ...keys]);
      setError(null);

      try {
        const response = await fetch("/api/applicability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frameworkId, controlId, ...patch }),
        });
        const json = await response.json().catch(() => ({}));

        if (!response.ok) {
          /* Name the field where the route named one. "That change was not
           * saved" on a screen of a hundred rows tells somebody nothing about
           * what to retype. */
          const detail =
            (json.fields && Object.values(json.fields)[0]) ||
            json.error ||
            "That change was not saved.";
          setError(String(detail));
          return false;
        }

        router.refresh();
        return true;
      } catch {
        setError("Could not reach the server. That change was not saved.");
        return false;
      } finally {
        setSaving((current) => current.filter((key) => !keys.includes(key)));
      }
    },
    [frameworkId, router],
  );

  const isSaving = useCallback(
    (controlId: string, field?: string) =>
      field === undefined
        ? saving.some((key) => key.startsWith(`${controlId}:`))
        : saving.includes(savingKey(controlId, field)),
    [saving],
  );

  return { commit, isSaving, error, dismiss: () => setError(null) };
}
