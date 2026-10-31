/**
 * Redirect signed-out page requests within the current instance. Session-cookie
 * presence is a UX check only; pages and API routes validate the real session.
 * Each deployment serves its own application, with no original-owner host split.
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/onboarding"];

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }
  if (!getSessionCookie(request)) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

// API handlers guard themselves and return JSON 401/403 responses. Excluding
// uploads also avoids proxy buffering of multipart request bodies.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};
