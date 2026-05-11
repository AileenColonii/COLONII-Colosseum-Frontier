// One-shot script to create Tavus personas for the 5 non-Anja Colonii
// characters. All point at the placeholder replica `ra1a0bc266f6` for now —
// swap each persona's `default_replica_id` once real replicas are trained.
//
// Run: TAVUS_API_KEY=... npx tsx scripts/provision-personas.ts

import { CHARACTERS_BY_ID, CHARACTER_IDS } from "../lib/characters";

const KEY = process.env.TAVUS_API_KEY;
const PLACEHOLDER_REPLICA = "ra1a0bc266f6";
const LLM_MODEL = "tavus-gemini-3-flash";

if (!KEY) {
  console.error("Missing TAVUS_API_KEY");
  process.exit(1);
}

async function main() {
  const results: Record<string, string> = {};
  for (const id of CHARACTER_IDS) {
    if (id === "anja") {
      console.log(`anja: skipped (already p4d8112db28e)`);
      continue;
    }
    const c = CHARACTERS_BY_ID[id];
    const body = {
      persona_name: `${c.displayName} (Colonii)`,
      system_prompt: c.systemPrompt,
      default_replica_id: PLACEHOLDER_REPLICA,
      pipeline_mode: "full",
      layers: { llm: { model: LLM_MODEL } },
    };
    const res = await fetch("https://tavusapi.com/v2/personas", {
      method: "POST",
      headers: { "x-api-key": KEY!, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      console.error(`${id}: HTTP ${res.status} ${text}`);
      continue;
    }
    results[id] = data.persona_id;
    console.log(`${id.padEnd(6)} -> ${data.persona_id}  (${c.displayName})`);
  }
  console.log("\nAdd these to lib/characters.ts:");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
