import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";

async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");
  if (!sessionCookie?.value) return null;
  return verifySessionToken(sessionCookie.value);
}

export async function GET() {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("demo_memories")
      .select("id, fact, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[memories] Fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load memories" },
        { status: 500 }
      );
    }

    return NextResponse.json({ memories: data || [] });
  } catch {
    return NextResponse.json(
      { error: "Failed to load memories" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "Memory ID required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Delete only if it belongs to this user
    const { error } = await supabase
      .from("demo_memories")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[memories] Delete error:", error);
      return NextResponse.json(
        { error: "Failed to delete memory" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete memory" },
      { status: 500 }
    );
  }
}
