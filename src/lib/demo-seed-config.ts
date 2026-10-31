/** Demo records and accounts must never be installed through an implicit default. */
import { refusedPassword } from "./password-policy";

export function demoSeedPassword(env: { ALLOW_DEMO_SEED?: string; DEMO_PASSWORD?: string }): string {
  if (env.ALLOW_DEMO_SEED !== "1") {
    throw new Error("Demo seeding is disabled. Set ALLOW_DEMO_SEED=1 only for a disposable demo database.");
  }
  const password = env.DEMO_PASSWORD;
  if (!password || refusedPassword(password)) {
    throw new Error("Set DEMO_PASSWORD to an operator-chosen password of at least 12 characters. No default password is provided.");
  }
  return password;
}
