import { describe, expect, it } from "vitest";

import { toTrashItems } from "./trash-view";
import { TRASH_RETENTION_DAYS } from "./trash";
import { RECORD_KIND_IDS } from "./record-kinds";

/**
 * Seven registers in one list.
 *
 * The trash renders records it cannot know the shape of, so the whole risk here
 * is a row arriving with nothing to call it: a system is named, a risk is
 * titled, a request carries a reference, and a document has a filename. A row
 * labelled with nothing is a row somebody cannot decide about, which is the
 * only thing this screen is for.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-21T12:00:00Z");

const removedDaysAgo = (days: number) =>
  new Date(NOW.getTime() - days * DAY).toISOString();

describe("what to call a removed record", () => {
  it("finds the field each register actually names its rows with", () => {
    const [system] = toTrashItems(
      "system",
      [{ id: "sys-1", name: "Otter.ai", vendor: "Otter Inc.", deletedAt: removedDaysAgo(1), deletedBy: "u" }] as never,
      NOW,
    );
    expect(system.label).toBe("Otter.ai");
    expect(system.detail).toBe("Otter Inc.");

    const [risk] = toTrashItems(
      "risk",
      [{ id: "risk-1", title: "Model drift", status: "open", deletedAt: removedDaysAgo(1), deletedBy: "u" }] as never,
      NOW,
    );
    expect(risk.label).toBe("Model drift");

    const [request] = toTrashItems(
      "intake",
      [{ id: "req-1", reference: "REQ-2026-0004", status: "endorsed", deletedAt: removedDaysAgo(1), deletedBy: "u" }] as never,
      NOW,
    );
    // A request has no name or title at all; the reference is what people quote.
    expect(request.label).toBe("REQ-2026-0004");

    const [doc] = toTrashItems(
      "evidence",
      [{ id: "ev-1", title: "Access review", source: "Internal", deletedAt: removedDaysAgo(1), deletedBy: "u" }] as never,
      NOW,
    );
    expect(doc.label).toBe("Access review");
    expect(doc.detail).toBe("Internal");
  });

  it("falls back to the id rather than rendering a blank row", () => {
    /* An assessment has no name, no title and no reference — it is "the
     * assessment for X". Until its detail can say so, the id is at least what
     * somebody would see in the URL. */
    const [item] = toTrashItems(
      "assessment",
      [{ id: "asm-7", status: "in_progress", deletedAt: removedDaysAgo(2), deletedBy: null }] as never,
      NOW,
    );

    expect(item.label).toBe("asm-7");
    expect(item.detail).toBe("in_progress");
  });

  it("never returns an empty label, whatever the row holds", () => {
    for (const kind of RECORD_KIND_IDS) {
      const [item] = toTrashItems(
        kind,
        [{ id: "x-1", deletedAt: removedDaysAgo(1), deletedBy: null }] as never,
        NOW,
      );
      expect(item.label, kind).toBeTruthy();
    }
  });

  it("ignores a name that is only whitespace", () => {
    const [item] = toTrashItems(
      "system",
      [{ id: "sys-9", name: "   ", deletedAt: removedDaysAgo(1), deletedBy: null }] as never,
      NOW,
    );

    expect(item.label).toBe("sys-9");
  });
});

describe("the countdown", () => {
  it("counts every row from the one instant it was given", () => {
    const items = toTrashItems(
      "risk",
      [
        { id: "a", title: "A", deletedAt: removedDaysAgo(1), deletedBy: null },
        { id: "b", title: "B", deletedAt: removedDaysAgo(TRASH_RETENTION_DAYS - 1), deletedBy: null },
        { id: "c", title: "C", deletedAt: removedDaysAgo(TRASH_RETENTION_DAYS + 5), deletedBy: null },
      ] as never,
      NOW,
    );

    expect(items[0].daysLeft).toBe(TRASH_RETENTION_DAYS - 1);
    expect(items[1].daysLeft).toBe(1);
    // Overdue is nought, not negative: the row is waiting for the cron, and the
    // screen says "any moment" rather than counting into the past.
    expect(items[2].daysLeft).toBe(0);
  });

  it("carries who removed it through untouched", () => {
    const [item] = toTrashItems(
      "finding",
      [{ id: "f-1", title: "F", deletedAt: removedDaysAgo(1), deletedBy: "user-abc" }] as never,
      NOW,
    );

    /* A Better Auth account id, resolved to a person by the screen — never
     * guessed at here, where there is nothing to resolve it against. */
    expect(item.deletedBy).toBe("user-abc");
    expect(item.kind).toBe("finding");
  });
});
