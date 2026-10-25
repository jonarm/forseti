import Anthropic from "@anthropic-ai/sdk";

/**
 * Turning model-call failures into something a user can act on.
 *
 * Forseti's AI routes fail in a handful of distinct ways — no key, no credit,
 * rate limited, model declined, output unusable — and "something went wrong"
 * makes all of them look like a bug in the app. Each case below maps to a
 * message that says what actually happened and what to do about it.
 */

/** Server is misconfigured (missing key). Not the caller's fault to fix. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** The model ran but returned nothing we could use. */
export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

/**
 * Pull the human-readable message out of an API error body, whose shape is
 * `{ type: "error", error: { type, message } }`. Read structurally: the error
 * classes are exported as values rather than types, and the `error` payload is
 * typed as a bare object anyway.
 */
function apiMessage(err: { error?: unknown }): string | null {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

/** Map any thrown value to an HTTP status and a message safe to show a user. */
export function describeAiError(err: unknown): {
  status: number;
  message: string;
} {
  if (err instanceof ConfigError) {
    return { status: 500, message: err.message };
  }
  if (err instanceof AiOutputError) {
    // Upstream produced nothing usable — not a bad request from the caller.
    return { status: 502, message: err.message };
  }

  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return {
      status: 504,
      message: "The request to Claude timed out. Please try again.",
    };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return {
      status: 502,
      message:
        "Could not reach the Claude API. Check your network connection and try again.",
    };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return {
      status: 500,
      message:
        "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.local.",
    };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return {
      status: 500,
      message: `This API key cannot access the model Forseti uses. ${
        apiMessage(err) ?? ""
      }`.trim(),
    };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return {
      status: 429,
      message: "Rate limited by the Claude API. Wait a moment and try again.",
    };
  }
  if (err instanceof Anthropic.BadRequestError) {
    // A 400 here is an account or plumbing problem rather than user input —
    // most often an exhausted credit balance. The API's own wording is the
    // most actionable thing we have, so pass it straight through.
    const message = apiMessage(err);
    if (message) {
      // One exception to passing it through untouched: the credit message says
      // "Plans & Billing", which reads as the Claude.ai subscription page. API
      // calls are funded by a separate prepaid balance in the Anthropic
      // Console, so that wording sends people to a page where everything looks
      // fine and the error looks like a bug in this app.
      const isBilling = /credit balance|purchase credits/i.test(message);
      return {
        status: 502,
        message: isBilling
          ? `${message} (This is the Anthropic API balance at console.anthropic.com — separate from a Claude.ai subscription.)`
          : message,
      };
    }
    return {
      status: 502,
      message:
        "The Claude API rejected the request. Check the server logs for details.",
    };
  }
  if (err instanceof Anthropic.InternalServerError) {
    return {
      status: 502,
      message:
        "The Claude API is temporarily unavailable or overloaded. Please try again.",
    };
  }

  return {
    status: 502,
    message: "Could not complete the request. Please try again.",
  };
}
