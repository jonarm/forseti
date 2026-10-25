"use client";

/**
 * Saving one field of an intake request, and saying so.
 *
 * The same shape as `use-system-patch.ts`, against the intake route: the screen
 * holds what is in flight and what failed, and nothing else. The route works out
 * what moved and writes the activity entries, so there is no before/after here
 * to drift from the one the store keeps.
 *
 * **No optimistic update.** The saved value comes back through
 * `router.refresh()` and the server render. That costs a round trip and buys
 * the thing the queue is for: a request that shows an answer it did not manage
 * to store is a request somebody will be triaged against wrongly, and the
 * triage recommendation on this screen is recomputed from exactly these fields.
 */
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import type { IntakePatch } from "@/lib/ams/intake-patch";

export interface IntakePatcher {
  /** Send one field. The key is what the route and the audit trail both name. */
  commit: (patch: IntakePatch) => Promise<void>;
  /** Which fields are in flight, so an editor can show itself busy. */
  saving: string[];
  error: string | null;
  dismiss: () => void;
}

export function useIntakePatch(requestId: string): IntakePatcher {
  const router = useRouter();
  const [saving, setSaving] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(
    async (patch: IntakePatch) => {
      const fields = Object.keys(patch);
      if (fields.length === 0) return;

      setSaving((current) => [...current, ...fields]);
      setError(null);

      try {
        const response = await fetch(
          `/api/intake/${encodeURIComponent(requestId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          },
        );
        const json = await response.json().catch(() => ({}));

        if (!response.ok) {
          // Name the field in the message. "Could not save" on a page with a
          // dozen editors on it tells somebody nothing about what to retype.
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
    [router, requestId],
  );

  return { commit, saving, error, dismiss: () => setError(null) };
}
