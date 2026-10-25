import { Card, CardContent } from "@/components/ui/card";
import { formatTimestamp } from "@/lib/ams/fixtures/activity";
import type { ActivityEvent } from "@/lib/ams/types";

/**
 * Every change to who can do what, in this organization.
 *
 * **The half that was missing.** `membership-audit.ts` hooks Better Auth's
 * organization plugin so that promoting, removing or inviting somebody always
 * lands a row — but a trail nobody can open is not evidence, it is a table. This
 * is the screen that makes it one, and it belongs here because the question it
 * answers ("who gave them that access, and when") is asked while looking at the
 * member list, not somewhere else.
 *
 * A **server component**: the events never reach the browser as data, only as
 * rendered rows. There is nothing secret in them, but an access-history payload
 * sitting in a client bundle is the sort of thing that later gets reused by a
 * component that does something cleverer with it.
 *
 * Deliberately not filterable, sortable or paginated. Membership changes are
 * rare — tens per year in a real organisation — so the honest shape is a short
 * list, newest first, with a line saying when it is truncated. Controls over a
 * list this size are furniture.
 */
export function AccessHistory({
  events,
  /** userId or invited email -> a person's name, for whatever can be resolved. */
  names,
}: {
  events: ActivityEvent[];
  names: Map<string, string>;
}) {
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No membership changes recorded yet. Every promotion, removal and
          invitation from here on appears in this list.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-4">
        <h2 className="text-sm font-medium">Access history</h2>
        <p className="mb-2 text-[0.8125rem] text-muted-foreground">
          Every change to who is in this organization and what they may do —
          recorded whether it was made here or through the API, and impossible to
          edit or delete afterwards.
        </p>

        <ol className="divide-y divide-border/60">
          {events.map((event) => {
            /*
             * The actor is a Better Auth account. It resolves to a name for
             * anyone still in the organization and to a raw id for anyone who
             * has since left — which is exactly right: the record has to
             * outlive the membership it describes, and an event that rendered
             * blank because somebody left would lose the answer at the moment
             * it starts mattering.
             */
            const actor = names.get(event.actorId) ?? event.actorId ?? "Unknown";
            return (
              <li
                key={event.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5"
              >
                <span className="text-sm font-medium">{actor}</span>
                <span className="text-sm text-muted-foreground">{event.action}</span>

                {(event.before || event.after) && (
                  <span className="flex flex-wrap items-baseline gap-1.5 text-xs">
                    {event.before && (
                      <span className="rounded border border-border bg-secondary/50 px-1.5 py-0.5 text-muted-foreground line-through">
                        {event.before}
                      </span>
                    )}
                    {event.after && (
                      <span className="rounded border border-border bg-secondary/50 px-1.5 py-0.5">
                        {event.after}
                      </span>
                    )}
                  </span>
                )}

                <span className="ml-auto text-xs text-muted-foreground/70">
                  {formatTimestamp(event.at)}
                </span>

                {event.reason && (
                  <p className="w-full text-xs text-muted-foreground/80">
                    {event.reason}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
