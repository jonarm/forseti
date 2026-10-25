import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The migration journal.
 *
 * Drizzle decides what to apply by comparing each journal entry's `when`
 * against the newest timestamp already recorded in the database. That makes the
 * journal's ordering load-bearing in a way nothing else checks: an entry whose
 * `when` is later than the entries after it sets the watermark into the future,
 * and **every migration generated afterwards is silently skipped**. The command
 * still reports success, and the failure surfaces later as a missing column.
 *
 * That is not hypothetical — it happened here. `0005` was hand-written (to
 * backfill `refs` rather than drop the column) with a fabricated timestamp a day
 * ahead of everything else, and `0007` never ran.
 */
const DIR = new URL("../../drizzle/", import.meta.url);

interface Entry {
  idx: number;
  tag: string;
  when: number;
}

const journal: { entries: Entry[] } = JSON.parse(
  readFileSync(new URL("meta/_journal.json", DIR), "utf8"),
);

describe("the drizzle journal", () => {
  it("orders `when` strictly ascending", () => {
    // The invariant drizzle's watermark depends on.
    const outOfOrder = journal.entries
      .slice(1)
      .filter((e, i) => e.when <= journal.entries[i].when)
      .map((e) => `${e.tag} (${e.when}) is not after ${journal.entries[e.idx - 1].tag}`);

    expect(outOfOrder).toEqual([]);
  });

  it("numbers entries consecutively from zero", () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(
      journal.entries.map((_, i) => i),
    );
  });

  it("has a SQL file for every entry, and an entry for every SQL file", () => {
    // A hand-written migration is easy to add to one and forget in the other,
    // and either half alone does nothing.
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();

    expect(journal.entries.map((e) => e.tag).sort()).toEqual(files);
  });

  it("has a snapshot for every entry", () => {
    const snapshots = readdirSync(new URL("meta/", DIR))
      .filter((f) => f.endsWith("_snapshot.json"))
      .length;

    expect(snapshots).toBe(journal.entries.length);
  });
});
