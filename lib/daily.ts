/**
 * Daily.co room management — creates rooms and tokens via the Daily REST API.
 */

// Resolved lazily on first request, not at module load — see lib/auth.ts
// for the same pattern and rationale (Next.js 14 collects page data by
// executing route modules, so top-level throws break builds when env
// vars are absent).
function getDailyApiKey(): string {
  const key = process.env.DAILY_API_KEY;
  if (!key) throw new Error("DAILY_API_KEY environment variable is required");
  return key;
}

const DAILY_API_URL = "https://api.daily.co/v1";

export async function createRoom(): Promise<{ url: string; name: string }> {
  const res = await fetch(`${DAILY_API_URL}/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getDailyApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
        enable_chat: false,
        enable_knocking: false,
        start_video_off: true,
        start_audio_off: false,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create Daily room: ${res.status} ${err}`);
  }

  const data = await res.json();
  return { url: data.url, name: data.name };
}

export async function createToken(
  roomName: string,
  isOwner: boolean = false
): Promise<string> {
  const res = await fetch(`${DAILY_API_URL}/meeting-tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getDailyApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        exp: Math.floor(Date.now() / 1000) + 3600,
        is_owner: isOwner,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create Daily token: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.token;
}
