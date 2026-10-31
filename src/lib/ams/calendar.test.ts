/** Calendar-dependent signals must advance without restarting the server. */
import { afterEach, expect, it, vi } from "vitest";
import { isOverdue, utcToday } from "./labels";
import { nowIso } from "../draft/grounding";

afterEach(() => vi.useRealTimers());

it("uses the current UTC date across midnight rather than the sample timeline", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-01-31T23:59:59Z"));
  expect(utcToday()).toBe("2027-01-31");
  expect(isOverdue("2027-01-31")).toBe(false);
  vi.setSystemTime(new Date("2027-02-01T00:00:01Z"));
  expect(utcToday()).toBe("2027-02-01");
  expect(isOverdue("2027-01-31")).toBe(true);
  expect(nowIso()).toBe("2027-02-01T00:00:01.000Z");
});
