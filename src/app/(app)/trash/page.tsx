import { notFound } from "next/navigation";

import { TRASH_RETENTION_DAYS } from "@/lib/ams/trash";
import { toTrashItems, type TrashItem } from "@/lib/ams/trash-view";
import {
  RECORD_KINDS,
  RECORD_KIND_IDS,
  type RecordKind,
} from "@/lib/ams/record-kinds";
import { WorkspaceProvider } from "@/lib/ams/workspace-context";
import { amsPage } from "@/lib/ams-page";
import { RECORD_BINDINGS } from "@/lib/records";
import { TrashTable } from "../_ams/trash-table";

/**
 * One trash, eight registers.
 *
 * It began as `/inventory/trash` because only systems had a retention window.
 * Seven more registers grew one, and eight separate trash screens would have been
 * six copies of a countdown and a restore — and, worse, six places somebody has
 * to visit to answer "what has this organisation deleted lately", which is one
 * question and deserves one page.
 *
 * **Every register is read, including the empty ones.** A tab that vanishes
 * when its register is empty is a tab somebody cannot find on the day it
 * matters, and the count beside each name is the useful part: a register with
 * nothing removed says zero rather than saying nothing.
 *
 * **The countdown is computed here, on the server**, against one instant so
 * every row on the page counts from the same moment. Deriving it in the browser
 * would make the number React rendered on the server disagree with the one it
 * rendered on hydration for anybody loading near midnight.
 */
export const dynamic = "force-dynamic";

export default async function TrashPage() {
  const { organizationId, data, permissions } = await amsPage();

  /*
   * The gate. `/inventory/trash` had the same one and for the same reason: the
   * retention window destroys records on a schedule, and while that is new the
   * screen showing it is restricted to the platform admin — the first person to
   * discover the countdown should be the one who can do something about it.
   *
   * `notFound()` rather than a refusal notice: a page saying "you may not see
   * what is being deleted" tells the reader precisely the thing they are not
   * being told yet.
   */
  if (!permissions.viewTrash) notFound();

  const now = new Date();

  /* Read in parallel: one indexed query per register against
   * `(organization, deleted_at)`, each mostly returning nothing. Sequentially
   * this would be eight round trips to render a page that is usually empty. */
  const perKind = await Promise.all(
    RECORD_KIND_IDS.map(async (kind) => {
      const rows = await RECORD_BINDINGS[kind].readDeleted(organizationId);
      return [kind, toTrashItems(kind, rows, now)] as const;
    }),
  );

  const items = Object.fromEntries(perKind) as Record<RecordKind, TrashItem[]>;

  return (
    <WorkspaceProvider data={data} permissions={permissions}>
      <TrashTable
        items={items}
        kinds={RECORD_KIND_IDS.map((kind) => ({
          kind,
          title: RECORD_KINDS[kind].title,
          plural: RECORD_KINDS[kind].plural,
        }))}
        retentionDays={TRASH_RETENTION_DAYS}
      />
    </WorkspaceProvider>
  );
}
