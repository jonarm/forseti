import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/records/system/import/parse`, the door the file comes through.
 *
 * `import-parse.test.ts` proves the parser reads a spreadsheet. This proves the
 * route around it: that a permission is checked before anything is read, that a
 * request without a file is answered rather than thrown at, that an unreadable
 * file comes back as a 400 with the reason attached, and — the part that only
 * exists here — that a `multipart/form-data` body reaches the parser at all.
 *
 * There is no database in it, because the route touches none: it reads bytes,
 * answers, and keeps nothing. That is the property worth stating twice.
 */

const caller = { organizationId: "org-aaaa", userId: "user-a", role: "system_owner" };

/** What the real guard answers: a context, or a response to return as-is. */
type Guard =
  | { ok: true; ctx: typeof caller }
  | { ok: false; response: Response };

const requirePermission = vi.fn(
  async (): Promise<Guard> => ({ ok: true, ctx: { ...caller } }),
);

vi.mock("@/lib/session", () => ({
  requirePermission: (...args: unknown[]) =>
    (requirePermission as unknown as (...a: unknown[]) => unknown)(...args),
}));

const { POST } = await import("@/app/api/records/[kind]/import/parse/route");

/** A request shaped the way the dialog shapes it. */
function upload(file: File | null): Request {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/records/system/import/parse", {
    method: "POST",
    body: form,
  });
}

/** The route takes its kind from the path, like every other generic one. */
const kindCtx = (kind = "system") => ({ params: Promise.resolve({ kind }) });

/** `POST` with the path's kind supplied, so each test reads as one call. */
const POST2 = (request: Request, kind?: string) => POST(request, kindCtx(kind));

const csv = (text: string, name = "tracker.csv") =>
  new File([text], name, { type: "text/csv" });

beforeEach(() => {
  requirePermission.mockClear();
  requirePermission.mockImplementation(async () => ({
    ok: true,
    ctx: { ...caller },
  }));
});

describe("POST /api/records/system/import/parse", () => {
  it("returns the columns, rows, source lines and a guessed mapping", async () => {
    const response = await POST2(
      upload(csv("Tool,Supplier,Notes\nOtter.ai,Otter.ai Inc.,Records calls")),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.columns).toEqual(["Tool", "Supplier", "Notes"]);
    expect(body.rows).toEqual([
      { Tool: "Otter.ai", Supplier: "Otter.ai Inc.", Notes: "Records calls" },
    ]);
    expect(body.lines).toEqual([2]);
    // A guess, and sent as one — the dialog owns it from the moment it renders.
    expect(body.mapping).toEqual({ Tool: "name", Supplier: "vendor", Notes: null });
  });

  it("checks the same permission the apply route checks, before reading anything", async () => {
    await POST2(upload(csv("Tool\nOtter.ai")));

    expect(requirePermission).toHaveBeenCalledWith(
      { system: ["create"] },
      expect.any(String),
    );
  });

  it("refuses a caller who may not create systems, without parsing the file", async () => {
    requirePermission.mockImplementation(async () => ({
      ok: false,
      response: Response.json({ error: "Refused." }, { status: 403 }),
    }));

    const response = await POST2(upload(csv("Tool\nOtter.ai")));
    expect(response.status).toBe(403);
  });

  it("answers a request with no file attached", async () => {
    const response = await POST2(upload(null));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("No file");
  });

  it("hands back the parser's reason rather than a generic failure", async () => {
    const response = await POST2(
      // A PDF wearing a .csv name. The bytes decide, and the message says so.
      new Request("http://localhost/api/records/system/import/parse", {
        method: "POST",
        body: (() => {
          const form = new FormData();
          form.append("file", csv("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"));
          return form;
        })(),
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("PDF");
  });

  it("strips a traversal attempt out of the filename it echoes back", async () => {
    const response = await POST2(
      upload(csv("Tool\nOtter.ai", "../../etc/passwd.csv")),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).filename).toBe("passwd.csv");
  });
});
