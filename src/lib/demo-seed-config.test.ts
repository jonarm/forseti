/** The opt-in and password checks run before the demo script can write records. */
import { expect, it } from "vitest";
import { demoSeedPassword } from "./demo-seed-config";

it.each([{}, { DEMO_PASSWORD: "test-only-password" }, { ALLOW_DEMO_SEED: "0" }])(
  "refuses demo seeding without an explicit opt-in", (env) => {
    expect(() => demoSeedPassword(env)).toThrow(/disabled/);
  },
);
it.each([undefined, "", "short"])("refuses an absent or short demo password", (password) => {
  expect(() => demoSeedPassword({ ALLOW_DEMO_SEED: "1", DEMO_PASSWORD: password }))
    .toThrow(/DEMO_PASSWORD/);
});
it("uses an operator-chosen password only after opt-in", () => {
  expect(demoSeedPassword({ ALLOW_DEMO_SEED: "1", DEMO_PASSWORD: "test-only-password" }))
    .toBe("test-only-password");
});
