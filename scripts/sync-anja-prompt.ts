// Sync Anja's systemPrompt from lib/characters.ts into her live Tavus persona.
import { getCharacter } from "../lib/characters";

async function main() {
  const KEY = process.env.TAVUS_API_KEY;
  if (!KEY) { console.error("Missing TAVUS_API_KEY"); process.exit(1); }

  const anja = getCharacter("anja");
  const res = await fetch(`https://tavusapi.com/v2/personas/${anja.personaId}`, {
    method: "PATCH",
    headers: { "x-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify([{ op: "replace", path: "/system_prompt", value: anja.systemPrompt }]),
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  try {
    const d = JSON.parse(text);
    console.log("updated system_prompt starts:");
    console.log(String(d.system_prompt || "").slice(0, 240));
  } catch {
    console.log(text.slice(0, 400));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
