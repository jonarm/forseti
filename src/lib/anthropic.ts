import Anthropic from "@anthropic-ai/sdk";

import { ConfigError } from "./ai-errors";

/**
 * Shared Anthropic client.
 *
 * Claude Opus 5 across the board: every call in Forseti is a judgement call
 * (does this control satisfy Art. 32? is this answer defensible to a buyer?)
 * rather than a lookup, and a wrong answer is worse than a slow one.
 */
export const MODEL = "claude-opus-5";

/**
 * Refusal fallback. Forseti's prompts talk about encryption, breach handling and
 * incident response, which sits close enough to the cyber safety classifiers
 * that a benign assessment can occasionally be declined. `"default"` lets the
 * API re-run the request on Anthropic's recommended fallback model instead of
 * handing us a refusal, so a pilot demo doesn't dead-end on a false positive.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Files API beta. Required on both the upload and any request that references
 * the resulting `file_id` — omitting it on the second is the easy mistake,
 * because the upload succeeds and only the assessment fails.
 */
export const FILES_BETA = "files-api-2025-04-14";

let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ConfigError(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.",
    );
  }
  // The constructor reads ANTHROPIC_API_KEY itself; one instance is reused so
  // the underlying keep-alive connection pool survives across requests.
  cached ??= new Anthropic();
  return cached;
}
