import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware for the Colosseum tech-demo build.
 *
 * This build only ships the /colosseum surface — the beta /talk app and
 * the /memories, /settings, /profile routes from the parent repo were
 * pruned. The middleware is reduced to one job: keep the same
 * clickjacking protection (X-Frame-Options + CSP frame-ancestors) the
 * parent repo applies to /colosseum. No auth gating is needed because
 * there are no authenticated routes left.
 */
export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  return response;
}

export const config = {
  matcher: ["/colosseum/:path*", "/colosseum"],
};
