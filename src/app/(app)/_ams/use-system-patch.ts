"use client";

/**
 * Saving one field of an AI system, and saying so.
 *
 * Every editor on the profile commits through here. The route works out what
 * actually moved and writes the activity entries, so this does not have to hold
 * a before/after of its own — it holds only what is in flight and what failed.
 *
 * **No optimistic update.** The saved value comes back through
 * `router.refresh()` and the server render. An inventory that shows a change it
 * did not manage to save is the one failure mode worth spending a round trip to
 * avoid: the whole argument for the register is that it is what is true.
 */
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import type { SystemPatch } from "@/lib/ams/system-patch";

export interface SystemPatcher {
  /** Send one field. The key is what the route and the audit trail both name. */
  commit: (patch: SystemPatch) => Promise<void>;
  /** Which fields are in flight, so an editor can show itself busy. */
  saving: string[];
  error: string | null;
  dismiss: () => void;
}

export function useSystemPatch(systemId: string): SystemPatcher {
  const router = useRouter();
  const [saving, setSaving] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(
    async (patch: SystemPatch) => {
      const fields = Object.keys(patch);
      if (fields.length === 0) return;

      setSaving((current) => [...current, ...fields]);
      setError(null);

      try {
        const response = await fetch(
          `/api/systems/${encodeURIComponent(systemId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          },
        );
        const json = await response.json().catch(() => ({}));

        if (!response.ok) {
          // Name the field in the message. "Could not save" on a page with
          // twenty editors on it tells somebody nothing about what to retype.
          const detail =
            (json.fields && Object.values(json.fields)[0]) ||
            json.error ||
            "That change was not saved.";
          setError(String(detail));
          return;
        }

        router.refresh();
      } catch {
        setError("Could not reach the server. That change was not saved.");
      } finally {
        setSaving((current) => current.filter((f) => !fields.includes(f)));
      }
    },
    [router, systemId],
  );

  return { commit, saving, error, dismiss: () => setError(null) };
}
