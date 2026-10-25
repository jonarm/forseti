/**
 * The one evaluator for every rule in the product.
 *
 * The assessment template's conditional display and the intake triage rules are
 * the same problem — "does this answer set satisfy this condition" — so they run
 * through the same eight lines rather than two engines that drift. Adding a
 * clause here is what teaches both screens a new trick.
 *
 * Unknown answers are falsy by design: a section whose controlling question has
 * not been answered yet stays hidden, and a triage rule whose input is missing
 * does not fire. The alternative — treating absent as "not equal", which is
 * true for a `not` rule — would escalate a submission for a question nobody
 * asked.
 */
import type { Predicate } from "./types";

export type ValueBag = Record<string, unknown>;

export function evaluate(rule: Predicate, values: ValueBag): boolean {
  if ("all" in rule) return rule.all.every((r) => evaluate(r, values));
  if ("any" in rule) return rule.any.some((r) => evaluate(r, values));
  if ("not" in rule) return !evaluate(rule.not, values);

  const value = values[rule.fieldId];
  if (value === undefined || value === null || value === "") return false;

  if ("equals" in rule) return value === rule.equals;
  if ("oneOf" in rule) return rule.oneOf.includes(value);
  return Array.isArray(value) && rule.includesAny.some((v) => value.includes(v));
}

/**
 * Which fields a rule reads.
 *
 * Used to explain a conditional section — "shown because you answered X" — and
 * to know when a rule needs re-evaluating. Duplicates are not filtered; callers
 * that care use a Set.
 */
export function fieldsUsedBy(rule: Predicate): string[] {
  if ("all" in rule) return rule.all.flatMap(fieldsUsedBy);
  if ("any" in rule) return rule.any.flatMap(fieldsUsedBy);
  if ("not" in rule) return fieldsUsedBy(rule.not);
  return [rule.fieldId];
}
