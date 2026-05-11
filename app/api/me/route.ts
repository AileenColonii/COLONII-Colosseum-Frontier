import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const userId = verifySessionToken(sessionCookie.value);
    if (!userId) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Try demo_users first
    const { data: demoUser } = await supabase
      .from("demo_users")
      .select("id, username, display_name")
      .eq("id", userId)
      .single();

    if (demoUser) {
      return NextResponse.json({
        user: {
          id: demoUser.id,
          displayName: demoUser.display_name,
          username: demoUser.username,
        },
      });
    }

    // Fallback to user_profiles
    const { data: profileUser } = await supabase
      .from("user_profiles")
      .select("id, email, display_name")
      .eq("id", userId)
      .single();

    if (profileUser) {
      return NextResponse.json({
        user: {
          id: profileUser.id,
          displayName: profileUser.display_name,
          email: profileUser.email,
        },
      });
    }

    return NextResponse.json({ user: null }, { status: 401 });
  } catch {
    return NextResponse.json({ user: null }, { status: 500 });
  }
}
