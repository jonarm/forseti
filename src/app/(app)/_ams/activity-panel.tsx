"use client";

import { ArrowRight, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/lib/ams/fixtures/activity";
import { SYSTEM_ACTOR } from "@/lib/audit";
import type { ActivityEvent } from "@/lib/ams/types";
import { EmptyState } from "./empty-state";
import { useWorkspace } from "@/lib/ams/workspace-context";

/**
 * The audit trail, rendered the same way everywhere it appears.
 *
 * Actor, action, before → after, timestamp — in that order, because that is the
 * order the question gets asked: who did what, to what value, when. The before
 * and after sit on one line with an arrow rather than in two columns, so a
 * change reads as a change rather than as two facts.
 *
 * The `viaSuggestionId` line is the part that matters most. When a change came
 * from an accepted AI suggestion the trail says so *and* still names the person
 * who accepted it — "the model changed it" and "a person adopted what the model
 * proposed" are different answers to an auditor, and only the second is
 * defensible. Hiding the model's involvement would be worse than useless; so
 * would recording it as the actor.
 *
 * **`actorId` holds ids from two spaces, and the panel resolves both.** A row
 * written by the app carries a Better Auth account, which resolves through
 * `personForAccount()` — the mapping somebody recorded in `ai_account_person`.
 * The seeded fixture trail predates that mapping and carries `ai_person` ids
 * directly, so those are looked up in `people` as a fallback. Dropping the
 * fallback silently turns every demo record's history into a column of
 * `p-anders`, which is how this was found.
 *
 * Both are raw index lookups, never `personById()`: that answers a miss with an
 * "Unassigned" placeholder, and "Unassigned changed the risk tier" asserts that
 * nobody did it — worse than an opaque id.
 *
 * What is left after both is one of two things and the panel says which.
 * `SYSTEM_ACTOR` is the seed or a migration and is named as such — it is not a
 * user id, and rendering it as one invites somebody to go looking for the
 * account. Anything else is an account nobody has matched to a person yet, and
 * it renders as its own id: it reads poorly on purpose, because the fix is one
 * link on the members screen and an invented name would hide that there was
 * anything to fix.
 */
export function ActivityPanel({
  events,
  className,
}: {
  events: ActivityEvent[];
  className?: string;
}) {
  const { people, personForAccount, suggestionById } = useWorkspace();
  if (events.length === 0) {
    return (
      <EmptyState
        title="Nothing has happened here yet"
        body="Every change to this record — who made it, what it was before, when — appears here as soon as there is one."
      />
    );
  }

  return (
    <ol className={cn("divide-y divide-border/60", className)}>
      {events.map((event) => {
        const actorName =
          personForAccount(event.actorId)?.name ||
          people.find((person) => person.id === event.actorId)?.name ||
          (event.actorId === SYSTEM_ACTOR.userId ? "Forseti" : event.actorId) ||
          "Unassigned";
        const suggestion = event.viaSuggestionId
          ? suggestionById(event.viaSuggestionId)
          : undefined;

        return (
          <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5">
            <span className="text-sm font-medium">{actorName}</span>
            <span className="text-sm text-muted-foreground">{event.action}</span>

            {(event.before || event.after) && (
              <span className="flex flex-wrap items-baseline gap-1.5 text-xs">
                {event.field && (
                  <span className="text-muted-foreground/60">{event.field}:</span>
                )}
                {event.before && (
                  <span className="rounded border border-border bg-secondary/50 px-1.5 py-0.5 text-muted-foreground line-through">
                    {event.before}
                  </span>
                )}
                {event.before && event.after && (
                  <ArrowRight className="size-3 shrink-0 text-muted-foreground/40" aria-hidden />
                )}
                {event.after && (
                  <span className="rounded border border-border bg-secondary/50 px-1.5 py-0.5">
                    {event.after}
                  </span>
                )}
              </span>
            )}

            <span className="ml-auto shrink-0 text-xs tabular text-muted-foreground/60">
              {formatTimestamp(event.at)}
            </span>

            {suggestion && (
              <span className="flex w-full items-baseline gap-1.5 pl-0 text-[0.6875rem] text-muted-foreground/70">
                <Sparkles className="size-3 shrink-0 translate-y-0.5 text-brand/70" aria-hidden />
                <span>
                  Acting on a suggestion the model made — {actorName} decided it.
                </span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
