import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware for the Colosseum tech-demo build.
 *
 * Applies the standard hardening headers across the site (not just
 * /colosseum) per the security audit: clickjacking
 * protection, HSTS, MIME-sniffing protection, conservative referrer
 * policy, and a Permissions-Policy that only grants the
 * camera/microphone scopes the demo actually uses.
 *
 * Static assets and Next internals are excluded from the matcher so
 * fonts/images don't pay the header overhead.*/
export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  // Clickjacking + framing
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  // Transport hardening
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Only the demo needs camera/mic; everything else off.
  response.headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=()"
  );
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
