import { describe, expect, it } from "vitest";

import {
  RECORD_KINDS,
  RECORD_KIND_IDS,
  countOf,
  recordKind,
} from "./record-kinds";
import { statement } from "../permissions";

/**
 * The registry, checked against the two things it cannot be wrong about.
 *
 * It is one object describing eight registers, read by the routes, the shared
 * toolbar and `uiPermissions()`. That makes a typo in it a runtime failure for
 * exactly one register — the kind of bug that ships, because the other six keep
 * working and nobody exercises the eighth until a customer does.
 *
 * Two properties carry the weight. **Every kind's `resource` must be a real
 * entry in the permission vocabulary**, or `requirePermission` asks about a
 * statement nobody holds and that register fails closed for everyone. And
 * **every resource must define the actions the features claim**: a kind
 * advertising `delete` whose resource has no `delete` action is a screen with a
 * button behind a permission that can never be granted.
 */

describe("every kind resolves to a real permission", () => {
  it("names a resource the vocabulary defines", () => {
    const unknown = RECORD_KIND_IDS.filter(
      (kind) => !(RECORD_KINDS[kind].resource in statement),
    );

    expect(unknown).toEqual([]);
  });

  it("claims only actions its resource actually has", () => {
    const wrong: string[] = [];

    for (const kind of RECORD_KIND_IDS) {
      const def = RECORD_KINDS[kind];
      const actions =
        (statement as Record<string, readonly string[]>)[def.resource] ?? [];

      if (def.features.export && !actions.includes("export")) {
        wrong.push(`${kind}: exportable, but ${def.resource} has no export`);
      }
      if (def.features.delete && !actions.includes("delete")) {
        wrong.push(`${kind}: deletable, but ${def.resource} has no delete`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it("gives every register an export statement to grow into", () => {
    /* The features are turned on one module at a time, but the vocabulary is
     * already complete — so switching a flag is a one-line change rather than a
     * permission migration in the middle of a feature. */
    for (const kind of RECORD_KIND_IDS) {
      const actions =
        (statement as Record<string, readonly string[]>)[
          RECORD_KINDS[kind].resource
        ] ?? [];
      expect(actions, kind).toContain("export");
      expect(actions, kind).toContain("delete");
    }
  });
});

describe("the registry is self-consistent", () => {
  it("keys each entry by its own kind", () => {
    // A copy-paste that left the wrong `kind` inside would route one register's
    // export to another's columns, and both would look plausible.
    for (const kind of RECORD_KIND_IDS) {
      expect(RECORD_KINDS[kind].kind).toBe(kind);
    }
  });

  it("only defaults to columns it actually offers", () => {
    const wrong: string[] = [];

    for (const kind of RECORD_KIND_IDS) {
      const def = RECORD_KINDS[kind];
      const ids = new Set(def.columns.map((column) => column.id));
      for (const id of def.defaultColumns) {
        if (!ids.has(id)) wrong.push(`${kind}: default column "${id}" is not in the catalogue`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it("gives an exportable register something to export", () => {
    for (const kind of RECORD_KIND_IDS) {
      const def = RECORD_KINDS[kind];
      if (!def.features.export) continue;
      expect(def.columns.length, kind).toBeGreaterThan(0);
      expect(def.defaultColumns.length, kind).toBeGreaterThan(0);
    }
  });

  it("has no duplicate column ids within a register", () => {
    for (const kind of RECORD_KIND_IDS) {
      const ids = RECORD_KINDS[kind].columns.map((column) => column.id);
      expect(new Set(ids).size, kind).toBe(ids.length);
    }
  });
});

describe("resolving a kind from an untrusted string", () => {
  it("accepts the ones it knows and refuses everything else", () => {
    expect(recordKind("system")?.kind).toBe("system");
    expect(recordKind("nonsense")).toBeNull();
    expect(recordKind("")).toBeNull();
    expect(recordKind(null)).toBeNull();
    expect(recordKind(42)).toBeNull();
    // Not a way to reach Object.prototype.
    expect(recordKind("constructor")).toBeNull();
    expect(recordKind("toString")).toBeNull();
  });
});

describe("countOf", () => {
  it("uses each register's own noun, singular and plural", () => {
    expect(countOf(RECORD_KINDS.system, 1)).toBe("1 system");
    expect(countOf(RECORD_KINDS.system, 3)).toBe("3 systems");
    // Evidence counts documents rather than "evidences".
    expect(countOf(RECORD_KINDS.evidence, 1)).toBe("1 document");
    expect(countOf(RECORD_KINDS.evidence, 2)).toBe("2 documents");
    expect(countOf(RECORD_KINDS.intake, 0)).toBe("0 requests");
  });
});
