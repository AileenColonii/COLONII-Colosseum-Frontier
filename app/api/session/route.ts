import { NextResponse } from "next/server";
import { createRoom, createToken } from "@/lib/daily";
import { fetchUserContext } from "@/lib/user-context";
import { verifySessionToken } from "@/lib/auth";
import { cookies } from "next/headers";

// Bot server URL and auth secret
const BOT_SERVER_URL = process.env.BOT_SERVER_URL || "http://localhost:8765";
const BOT_SERVER_SECRET = process.env.BOT_SERVER_SECRET || "";
const TAVUS_API_KEY = process.env.TAVUS_API_KEY || "";
const TAVUS_REPLICA_ID = process.env.TAVUS_REPLICA_ID || "";

const ALLOWED_MODELS = ["gemini", "groq", "openai", "haiku", "sonnet"];

// Simple in-memory rate limiter: max 5 sessions per IP per minute
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW);
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);

  // Prune stale entries to prevent memory leak
  if (rateLimitMap.size > 1000) {
    rateLimitMap.forEach((ts, key) => {
      if (ts.every((t) => now - t > RATE_LIMIT_WINDOW)) {
        rateLimitMap.delete(key);
      }
    });
  }

  return timestamps.length > RATE_LIMIT_MAX;
}

export async function POST(req: Request) {
  // Rate limiting
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }

  // Require a valid session cookie — the /colosseum flow sets this via
  // /api/demo-login before LiveScene ever calls /api/session.
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");
  const userId = sessionCookie?.value ? verifySessionToken(sessionCookie.value) : null;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const model = body.model || "groq";

    // Validate model
    if (!ALLOWED_MODELS.includes(model)) {
      return NextResponse.json(
        { error: `Invalid model. Allowed: ${ALLOWED_MODELS.join(", ")}` },
        { status: 400 }
      );
    }

    // Fetch user context (userId is guaranteed non-null after auth gate above)
    const userContext = await fetchUserContext(userId);
    const mode = body.mode || "video";

    // --- VIDEO MODE: Tavus full pipeline (no bot server needed) ---
    if (mode === "video" && TAVUS_API_KEY) {
      const TAVUS_PERSONA_ID = process.env.TAVUS_PERSONA_ID || "";

      const tavusRes = await fetch("https://tavusapi.com/v2/conversations", {
        method: "POST",
        headers: {
          "x-api-key": TAVUS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          replica_id: TAVUS_REPLICA_ID,
          persona_id: TAVUS_PERSONA_ID,
          conversation_name: `colonii-${Date.now()}`,
          // Phase-1 stranger greeting for guests + the no-userContext path;
          // personalized greeting for the 4 named demo users with seeded
          // memories. Note the spelling — "Ania" forces the TTS engine to
          // produce the correct soft-Polish "AH-niah" sound. Writing
          // "Anja" here would make Tavus say the harsh English "AHN-ja".
          custom_greeting:
            userContext && userContext.displayName && userContext.displayName !== "Guest"
              ? `Hey ${userContext.displayName}, good to see you again.`
              : "Hey, I'm Ania. What's your name?",
          properties: {
            max_call_duration: 240,
            participant_left_timeout: 30,
            // 180s buffer so the initial handshake + mic-permission grant
            // doesn't race the timeout. Client-side 2-min silence shutdown
            // still acts as the main cost control.
            participant_absent_timeout: 180,
            enable_recording: false,
          },
        }),
      });

      if (!tavusRes.ok) {
        const err = await tavusRes.text();
        console.error(`[tavus] Failed to create conversation: ${err}`);
        return NextResponse.json(
          { error: "Avatar service unavailable. Please try again." },
          { status: 502 }
        );
      }

      const tavusData = await tavusRes.json();
      console.log(`[tavus] Conversation: ${tavusData.conversation_id}`);

      return NextResponse.json({
        roomUrl: tavusData.conversation_url,
        token: "", // Tavus rooms are open — no token needed
        model,
        conversationId: tavusData.conversation_id,
      });
    }

    // --- VOICE MODE: Bot server with Pipecat pipeline ---
    const { url: roomUrl, name: roomName } = await createRoom();
    const clientToken = await createToken(roomName, false);
    const botToken = await createToken(roomName, true);

    const botPayload: Record<string, unknown> = {
      url: roomUrl,
      token: botToken,
      model,
      mode,
    };
    if (userContext) {
      botPayload.user_context = userContext;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (BOT_SERVER_SECRET) {
      headers["Authorization"] = `Bearer ${BOT_SERVER_SECRET}`;
    }

    const botRes = await fetch(BOT_SERVER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(botPayload),
    });

    if (!botRes.ok) {
      const err = await botRes.text();
      console.error(`[bot-server] Failed to spawn bot: ${err}`);
      return NextResponse.json(
        { error: "Voice server is unavailable. Please try again later." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      roomUrl,
      token: clientToken,
      model,
    });
  } catch (error) {
    // Log full error server-side, return generic message to client (#7 HIGH)
    console.error("Session creation failed:", error);
    return NextResponse.json(
      { error: "Failed to create session. Please try again." },
      { status: 500 }
    );
  }
}
