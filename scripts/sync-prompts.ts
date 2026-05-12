// Sync every character's systemPrompt + greeting from lib/characters.ts
// into their live Tavus personas. Safe to re-run — PATCH is idempotent.
import { CHARACTER_IDS, CHARACTERS_BY_ID } from "../lib/characters";

async function main() {
  const KEY = process.env.TAVUS_API_KEY;
  if (!KEY) { console.error("Missing TAVUS_API_KEY"); process.exit(1); }

  for (const id of CHARACTER_IDS) {
    const c = CHARACTERS_BY_ID[id];
    const res = await fetch(`https://tavusapi.com/v2/personas/${c.personaId}`, {
      method: "PATCH",
      headers: { "x-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify([
        { op: "replace", path: "/system_prompt", value: c.systemPrompt },
        { op: "replace", path: "/greeting", value: c.greeting },
      ]),
    });
    console.log(`${id.padEnd(6)}  HTTP ${res.status}  ${c.personaId}  "${c.displayName}"`);
    if (!res.ok) {
      const text = await res.text();
      console.log("  " + text.slice(0, 300));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
