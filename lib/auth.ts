import { createHmac, timingSafeEqual } from "crypto";

// The secret is resolved lazily on first use, not at module load.
//
// Next.js 14 invokes route modules during "Collecting page data" at build
// time. If we threw here at import, every build without BOT_SERVER_SECRET
// (or SUPABASE_SERVICE_ROLE_KEY) in the environment would fail — including
// preview builds and the first deploy of a brand-new Vercel project,
// before env vars have been wired up. Deferring to call-time keeps the
// safety check where it matters (request handling) without poisoning
// builds.
let cachedSecret: string | undefined;

function getAuthSecret(): string {
  if (cachedSecret !== undefined) return cachedSecret;
  const secret = process.env.BOT_SERVER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("Missing auth secret: set BOT_SERVER_SECRET or SUPABASE_SERVICE_ROLE_KEY");
  }
  cachedSecret = secret;
  return cachedSecret;
}

/**
 * Create an HMAC-signed session token containing the user ID.
 * Format: base64(payload).base64(hmac)
 */
export function createSessionToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, iat: Date.now() })
  ).toString("base64url");
  const sig = createHmac("sha256", getAuthSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * Verify an HMAC-signed session token and return the user ID.
 * Returns null if invalid or expired (24h).
 */
export function verifySessionToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, sig] = parts;
  const expectedSig = createHmac("sha256", getAuthSecret())
    .update(payload)
    .digest("base64url");

  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    // Expire after 24 hours
    if (Date.now() - data.iat > 24 * 60 * 60 * 1000) return null;
    return data.uid || null;
  } catch {
    return null;
  }
}
