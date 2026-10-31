/** Cover URL normalization tricks before a destination reaches router.push. */
import { describe, expect, it } from "vitest";

import { safeReturnPath } from "./return-path";

describe("safeReturnPath", () => {
  it.each([
    "/", "/overview", "/inventory/system-1",
    "/inventory?search=AI%20tools#results",
    "/inventory?source=https%3A%2F%2Fexample.com",
  ])("preserves a local destination: %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    undefined, null, [], ["/overview", "/inventory"], 42, "",
    "overview", "https://external.example", "//external.example",
    "///external.example", "/\\external.example", "/\\\\external.example",
    "javascript:alert(1)", "\n/overview", "/\n/external.example",
    "/\t/external.example", "/overview\r\n", "/overview\0", "/overview\u007f",
    "/.//external.example", "/%2e//external.example",
  ])("rejects an unsafe or ambiguous destination: %j", (path) => {
    expect(safeReturnPath(path)).toBeUndefined();
  });

  it("normalizes dot segments without creating an external destination", () => {
    expect(safeReturnPath("/inventory/../overview?tab=all#top"))
      .toBe("/overview?tab=all#top");
  });
});
