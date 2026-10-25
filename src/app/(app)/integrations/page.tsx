import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireOrgContext } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Integrations — placeholders, and labelled as such.
 *
 * Nothing here connects to anything. That is deliberate for this iteration, but
 * a disabled button with no explanation reads as broken rather than unbuilt, so
 * every card says "not connected yet" rather than implying a failed handshake.
 *
 * The grouping is by what the integration would *do*, not by vendor: asset
 * sources feed the inventory, notification channels carry evidence requests and
 * overdue findings to the people who own them.
 */

interface Integration {
  name: string;
  initials: string;
  purpose: string;
}

const CATEGORIES: Array<{ title: string; blurb: string; items: Integration[] }> = [
  {
    title: "Asset sources",
    blurb:
      "Populate the inventory automatically. A synced asset reconciles on every run; a manual one silently goes stale.",
    items: [
      {
        name: "ServiceNow CMDB",
        initials: "SN",
        purpose: "Pull configuration items, owners and relationships into Assets.",
      },
      {
        name: "AWS Config",
        initials: "AWS",
        purpose: "Discover cloud resources and tag them by account and region.",
      },
    ],
  },
  {
    title: "Email",
    blurb: "Send evidence requests and finding reminders to the owner on the record.",
    items: [
      {
        name: "Microsoft 365",
        initials: "MS",
        purpose: "Send from your own domain, and thread replies onto the finding.",
      },
      {
        name: "Google Workspace",
        initials: "GW",
        purpose: "Send from your own domain, and thread replies onto the finding.",
      },
    ],
  },
  {
    title: "Chat",
    blurb:
      "Post new findings and overdue items to a channel, so a due date is visible before it slips.",
    items: [
      {
        name: "Microsoft Teams",
        initials: "TE",
        purpose: "Post to a channel and let owners acknowledge in place.",
      },
      {
        name: "Slack",
        initials: "SL",
        purpose: "Post to a channel and let owners acknowledge in place.",
      },
    ],
  },
];

export default async function IntegrationsPage() {
  await requireOrgContext();

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect the systems that feed Forseti and carry its work back out."
      />

      <div className="space-y-8 px-8 py-6">
        <div className="rounded-lg border border-warn/30 bg-warn/10 p-4 text-sm text-warn">
          None of these are wired up yet. The cards below show what each one would
          do and where it will live — connecting them is a later step.
        </div>

        {CATEGORIES.map((category) => (
          <section key={category.title} className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-medium">{category.title}</h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                {category.blurb}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {category.items.map((item) => (
                <Card key={item.name}>
                  <CardContent className="flex h-full flex-col gap-3 py-5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary font-mono text-xs font-medium text-muted-foreground"
                        aria-hidden
                      >
                        {item.initials}
                      </span>
                      <p className="text-sm font-medium">{item.name}</p>
                    </div>

                    <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
                      {item.purpose}
                    </p>

                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline">Not connected</Badge>
                      <Button variant="outline" size="sm" disabled>
                        Connect
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
