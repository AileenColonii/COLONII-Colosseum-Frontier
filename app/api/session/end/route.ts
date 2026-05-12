import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/auth";

const TAVUS_API_KEY = process.env.TAVUS_API_KEY || "";

export async function POST(req: Request) {
  // Require a valid session cookie — raises bar to "must have demo-login
  // cookie" before anyone can end a stranger's Tavus conversation.
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");
  if (!sessionCookie?.value || !verifySessionToken(sessionCookie.value)) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const conversationId: string | undefined = body.conversationId;

    if (!conversationId || !/^c[a-f0-9]+$/i.test(conversationId)) {
      return NextResponse.json({ error: "Invalid conversationId" }, { status: 400 });
    }

    if (!TAVUS_API_KEY) {
      return NextResponse.json({ ok: true, skipped: "no_tavus_key" });
    }

    const res = await fetch(`https://tavusapi.com/v2/conversations/${conversationId}/end`, {
      method: "POST",
      headers: { "x-api-key": TAVUS_API_KEY },
    });

    // Tavus returns 200 on success; 404 if already ended. Either is acceptable.
    if (!res.ok && res.status !== 404) {
      const err = await res.text().catch(() => "");
      console.error(`[tavus] end ${conversationId} failed (${res.status}): ${err}`);
      return NextResponse.json({ ok: false }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("end session failed:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
