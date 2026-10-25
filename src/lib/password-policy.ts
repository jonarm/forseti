/**
 * How long a password has to be, in the one place that decides it.
 *
 * The number was written out three times — `emailAndPassword.minPasswordLength`
 * in `auth.ts`, and both the `minLength` attribute and the hint sentence in
 * `auth-form.tsx` — which is two copies too many for a rule enforced by a
 * library the UI cannot see. Raise it in `auth.ts` alone and the sign-up form
 * keeps promising twelve while Better Auth refuses at fourteen, and the person
 * typing is told nothing useful.
 *
 * It matters more now that an admin can set somebody else's initial password
 * from `/settings/members`. That path deliberately does **not** go through
 * `signUpEmail` — see `api/members/route.ts` for why — so Better Auth's own
 * length check never runs on it. This module is what the route checks instead,
 * and it is the same number the sign-up form shows, by construction rather than
 * by two files happening to agree.
 *
 * Client-safe on purpose: no database import and no `process.env`, so the form
 * and the route can share it.
 */

/** The floor, in characters. Better Auth is configured from this in `auth.ts`. */
export const MIN_PASSWORD_LENGTH = 12;

/** The hint a form shows before anyone types, worded like the refusal below. */
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters.`;

/**
 * Why a password was refused, or null if it was not.
 *
 * A sentence rather than a boolean, for the reason `refusalNote()` is one: the
 * route and the form both show this string, so the message a person reads after
 * submitting is the message they would have read before.
 */
export function refusedPassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "A password is required.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
