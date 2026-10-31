/** Sign-in destinations must remain root-relative paths on this instance. */
export function safeReturnPath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  ) {
    return undefined;
  }

  // A fixed parsing origin avoids trusting an incoming Host header. Returning
  // the normalized path also removes dot segments that can produce `//...`.
  const base = "https://return-path.invalid";
  const parsed = new URL(value, base);
  if (parsed.origin !== base || parsed.pathname.startsWith("//")) {
    return undefined;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
