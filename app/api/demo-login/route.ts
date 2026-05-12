import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { createSessionToken } from "@/lib/auth";

// Rate limiter for demo login: max 10 attempts per IP per minute
const demoRateLimitMap = new Map<string, number[]>();
const DEMO_RATE_WINDOW = 60_000; // 1 minute
const DEMO_RATE_MAX = 10;

function isDemoRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (demoRateLimitMap.get(ip) || []).filter(
    (t) => now - t < DEMO_RATE_WINDOW
  );
  timestamps.push(now);
  demoRateLimitMap.set(ip, timestamps);
  return timestamps.length > DEMO_RATE_MAX;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (isDemoRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429 }
    );
  }

  try {
    const { username } = await req.json();

    if (!username || typeof username !== "string") {
      return NextResponse.json(
        { error: "Username is required" },
        { status: 400 }
      );
    }

    const requested = username.toLowerCase().trim();

    // ── GUEST SHORT-CIRCUIT ──────────────────────────────────────────
    // Public hackathon visitors land in "guest" mode by default. We
    // never want to require a Supabase seed for this path — strangers
    // hitting the demo URL need to get a session immediately. Mint a
    // stable namespaced ID so downstream APIs (fetchUserContext etc.)
    // see a recognisable id and return Phase-1 stranger context.
    if (requested === "guest") {
      const guestId = "guest-demo";
      const sessionToken = createSessionToken(guestId);
      const response = NextResponse.json({
        user: {
          id: guestId,
          username: "guest",
          displayName: "Guest",
        },
      });
      response.cookies.set("session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60,
        path: "/",
      });
      return response;
    }
    // ─────────────────────────────────────────────────────────────────

    const supabase = createServiceClient();

    // Look up the demo user by username — passwords stay server-side only
    const { data: demoUser } = await supabase
      .from("demo_users")
      .select("id, username, display_name")
      .eq("username", requested)
      .single();

    if (!demoUser) {
      return NextResponse.json(
        { error: "Demo account not found" },
        { status: 404 }
      );
    }

    const sessionToken = createSessionToken(demoUser.id);
    const response = NextResponse.json({
      user: {
        id: demoUser.id,
        username: demoUser.username,
        displayName: demoUser.display_name,
      },
    });

    response.cookies.set("session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60, // 24 hours
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "Demo login failed" },
      { status: 500 }
    );
  }
}
