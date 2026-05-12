import { createServiceClient } from "@/lib/supabase";

export interface UserContext {
  userId: string;
  displayName: string;
  bio: string | null;
  memories: string[];
}

export async function fetchUserContext(userId: string): Promise<UserContext | null> {
  try {
    const supabase = createServiceClient();

    const [userRes, profileRes, memoriesRes] = await Promise.all([
      supabase
        .from("demo_users")
        .select("display_name, bio")
        .eq("id", userId)
        .single(),
      supabase
        .from("user_profiles")
        .select("display_name, bio")
        .eq("id", userId)
        .single(),
      supabase
        .from("demo_memories")
        .select("fact")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
    ]);

    const userRow = userRes.data || profileRes.data;
    if (!userRow) return null;

    return {
      userId,
      displayName: userRow.display_name,
      bio: userRow.bio,
      memories: (memoriesRes.data || []).map((m: { fact: string }) => m.fact),
    };
  } catch (e) {
    console.error("[user-context] Failed to fetch:", e);
    return null;
  }
}
