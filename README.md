# COLONII — Colosseum tech demo

> **An identity that remembers you.** A real-time voice + video conversation with Anja, your AI companion, backed by Solana for verifiable identity and memory anchors.

**Submission:** Solana Colosseum hackathon, May 2026.
**Live:** see deployment URL on the Vercel project.

This repo is the **slimmed, judging-only build** — a single linear demo at `/colosseum`, the five API routes it needs, and the imported Solana identity layer that powers the smart-contract handoff. The full COLONII product (the `/talk` beta surface, account management, the memory studio, etc.) lives in a separate parent repo and is not part of the Colosseum submission.

---

## What this is

COLONII is the identity layer for human–AI relationships. Today's AI companions reset between sessions; COLONII gives every visitor a portable, verifiable identity that persists — so the relationship with Anja can deepen across time, devices, and surfaces.

The demo takes a visitor from a fresh wallet, through a real-time video conversation with Anja (Tavus + MuseTalk + ElevenLabs + Daily.co), to a dashboard showing the on-chain memory anchors the conversation produced. Real cryptography throughout — the same identifiers a live Solana devnet would produce.

---

## Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────────┐
│                       Browser (Next.js 14 App Router)                │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  /  →  redirect → /colosseum                                 │    │
│  │  /colosseum  — 13-scene linear demo                          │    │
│  │  - Framer Motion scene transitions                           │    │
│  │  - Solana wallet-adapter (Phantom, Solflare) — opt-in        │    │
│  │  - Vendored Colonii SDK: real PDA + SHA-256, no broadcast    │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Next.js API routes (only the ones the demo touches)                 │
│  - /api/session            → Tavus persona + Daily room provisioning │
│  - /api/session/end        → end the Tavus conversation (stop bill)  │
│  - /api/chat               → LLM streaming (Groq / OpenRouter)       │
│  - /api/memories           → Supabase memory recall                  │
│  - /api/demo-login         → Guest short-circuit (no signup needed)  │
└──────────────────────────────────────────────────────────────────────┘
              │
              ├─► Tavus               → real-time avatar replica
              ├─► Daily.co            → WebRTC room for the avatar call
              ├─► ElevenLabs          → real-time voice (TTS, low-latency)
              ├─► Groq / OpenRouter / Google / OpenAI → LLM streaming
              ├─► Supabase (Postgres) → memory recall
              └─► Solana devnet       → identity PDA + memory anchor target
                                         (mock-mode SDK, real primitives)
```

### What's real today

- **Ed25519 wallet keypair** (yours, or generated for you)
- **Identity PDA derivation** via `PublicKey.findProgramAddressSync` against the COLONII Anchor program ID
- **SHA-256 memory hashes** via `@noble/hashes`
- **DID format** (`did:colonii:<base58-pubkey>`)
- **Real-time video + voice** through Tavus / MuseTalk / ElevenLabs / Daily.co
- **Memory recall** from prior Supabase-stored sessions
- **Booking-first scheduling** (the availability scene)

### What ships next

- **On-chain writes** for identity creation, credential issuance, and memory anchoring. The Anchor program — `programs/colonii-identity/` in `gmxbt/colonii-identity` — is built, tested, and ready; deployer-wallet funding is the only remaining step before the devnet rollout.
- Multi-region replicas for 24-hour slot coverage
- Memory graph view + portability across AI surfaces

The same wallet produces these exact identifiers on Solana devnet — flip from the mock client to the real one in `lib/colonii-sdk/index.ts` (one re-export line) when the program is live.

### On-chain anchor program

The COLONII identity program is a separate Anchor workspace maintained by Adi Drewinkowski. The colosseum demo vendors its TypeScript SDK byte-for-byte from that repo so the two stay in lock-step:

| | Value |
|---|---|
| **Repo (private)** | `gmxbt/colonii-identity` |
| **Program ID** | `E8K8WUxSjEgQAArjT4NkpDxrri59b3SNLVmDCU3yyCCG` |
| **Instructions** | `initialize_did`, `update_did`, `bind_avatar`, `update_avatar`, `deactivate_did`, `create_issuer`, `issue_credential`, `revoke_credential`, `verify_credential`, `anchor_memory` |
| **Account types** | `Identity`, `Issuer`, `Credential`, `MemoryAnchor` |
| **Vendored SDK** | `lib/colonii-sdk/` — `client-browser.ts` (mock-mode, ~7 KB), plus the upstream `idl.ts`, `mock.ts`, `pda.ts`, `format.ts`, `types.ts`, `program-id.ts`, `browser.ts` byte-identical to upstream |

All PDA derivations, SHA-256 memory hashes, DID strings, and identity-record shapes returned by mock mode match the on-chain program exactly — the swap to live is a single import-line change in `lib/colonii-sdk/index.ts`.

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 14 (App Router), React 18, TypeScript |
| Real-time video | Tavus persona → MuseTalk lip-sync → Daily.co WebRTC |
| Voice | ElevenLabs (low-latency TTS) |
| LLM (streaming) | Groq / OpenRouter / Google / OpenAI (fallback chain) |
| Wallet | Solana `@solana/wallet-adapter-react` + Phantom / Solflare |
| Crypto primitives | `@solana/web3.js`, `@noble/hashes` |
| State + animation | Framer Motion, vanilla React state |
| Memory store | Supabase Postgres |
| Hosting | Vercel (Edge for static, Node for `/api/*`) |
| Fonts | Alata (display) + Special Elite (body) via next/font |

The browser-safe Solana SDK in `lib/colonii-sdk/` is mirrored from `sdk/src/` so the demo and the real program stay in lock-step.

---

## On-chain identity layer

The smart-contract handoff code lives in this repo now:

```text
programs/colonii-identity/   # Anchor program: DID, issuer, credentials, avatar binding, memory anchors
sdk/                         # TypeScript SDK package for mock/live integration
demo/                        # CLI demo and localnet program behavior tests
INTEGRATION_HANDOFF.md       # UI action -> SDK method -> signer -> instruction -> account map
```

Useful commands:

```bash
anchor build
cd sdk && npm test
cd demo && npm run demo
```

For localnet program behavior tests, start a validator and deploy the program first:

```bash
solana-test-validator --reset
anchor deploy --provider.cluster localnet
cd demo && SOLANA_RPC_URL=http://127.0.0.1:8899 npm run test:program:localnet
```

`anchor deploy` must use a deploy keypair whose address matches the declared program ID in `Anchor.toml` and `programs/colonii-identity/src/lib.rs`. Deploy keypairs are not committed; if Anchor generates a fresh one, either provide the approved matching keypair locally or intentionally rotate the program ID across the program, SDK, and app before testing.

---

## Brand text vs. voice pronunciation

The demo splits the brand across two surfaces — text and voice — and they use different spellings on purpose:

- **Text everywhere (UI, chat fallback, copy):** `Anja` and `COLONII`.
- **Voice paths only (Tavus persona, Pipecat prompts, ElevenLabs TTS):** the phonetic spellings `Anya` and `Colony`, so the avatar pronounces them correctly (two-syllable "AHN-yah", and "colony" the English word).

If you're editing prompts, keep this split clean — `lib/characters.ts`, `server/prompts.py`, and `app/api/session/route.ts` use voice-pipeline phonetic spellings; `app/api/chat/route.ts` and every UI string use the visible brand.

---

## Demo flow (13 scenes, ~3 minutes)

1. **Auth** — email + optional wallet connect
2. **Consent** — terms + AI-companion consent
3. **Securing** — identity is being created on Solana (animated)
4. **Secured** — checkmark + ring animation
5. **Companions** — pick your AI persona (Anja is the active one; Hung, Femi, Leon ship next release)
6. **Memories Carried** — what Anja has captured (empty for Guest)
7. **Availability** — book a 5-minute slot or talk now
8. **Live** — real-time video conversation with Anja
9. **Graph** — memory graph of what mattered
10. **Dashboard** — your COLONII overview, "View on-chain" drawer
11. **Roadmap** — Live today / Next 90 days / Within a year
12. **Thesis** — "AI no longer resets"
13. **Wordmark** — final beat with Start again

---

## Running locally

You need Node 20+ and an `.env.local`:

```bash
npm install
npm run dev
# open http://localhost:3000  (auto-redirects to /colosseum)
```

The Guest path works without any external services — strangers landing on `/colosseum` get a session cookie via the `/api/demo-login` short-circuit and can walk the full flow. Live video requires `TAVUS_API_KEY`, `TAVUS_PERSONA_ID`, `TAVUS_REPLICA_ID`, plus Daily.co + ElevenLabs keys; the rest of the demo degrades gracefully without them.

For a production build:

```bash
npm run build
npm run start
```

Vercel deploy: `vercel --prod`.

---

## Repo layout

```
app/
├── colosseum/                   # The demo (this README)
│   ├── page.tsx                 # 13-scene linear flow
│   ├── LiveScene.tsx            # Real-time video + voice surface
│   ├── colonii-session.ts       # Singleton wrapper over the vendored SDK
│   └── wallet-providers.tsx     # Phantom + Solflare setup
├── components/
│   └── AvatarView.tsx           # Daily.co iframe + audio bridge
├── api/                         # Only the routes /colosseum uses
│   ├── chat/                    # LLM streaming text-chat
│   ├── demo-login/              # Guest short-circuit
│   ├── memories/                # Supabase memory recall
│   └── session/                 # Tavus + Daily provisioning (+ /end)
├── page.tsx                     # Redirects /  →  /colosseum
└── layout.tsx                   # Fonts + Vercel Analytics

lib/
├── colonii-sdk/                 # Browser-safe mirror of sdk/src
├── characters.ts                # Character lore (synced to Tavus personas)
└── auth.ts, supabase.ts         # Session + DB helpers

server/
└── prompts.py                   # Pipecat voice-pipeline prompts

scripts/
├── sync-anja-prompt.ts          # PATCH Anja's Tavus persona system_prompt
├── sync-prompts.ts              # Multi-persona sync
└── provision-personas.ts        # Bulk persona setup

public/
├── personas/                    # Character portraits for the demo cast
└── elevenlabs-grants-black.webp # Partner credit asset

programs/
└── colonii-identity/            # Anchor smart contract (Rust)

sdk/
└── src/                         # Upstream TypeScript SDK (live-mode client + IDL)

demo/
└── src/                         # CLI demo + localnet behavior tests

Anchor.toml, Cargo.toml, Cargo.lock # Anchor workspace at the repo root
```

---

## Credits

- **Concept + design:** Aileen Carville (CEO)
- **Engineering:** Sam Martín
- **Character portraits + replicas:** Luke Nugent
- **On-chain design:** Adi Drewinkowski (Solana program, identity PDAs)
- **Voice:** [ElevenLabs](https://elevenlabs.io) (Grants programme)
- **Avatar replicas:** [Tavus](https://tavus.io)
- **Real-time WebRTC:** [Daily.co](https://www.daily.co)
- **Inference:** Groq, OpenRouter, Google, OpenAI
- **Solana identity layer:** Anchor program in `programs/colonii-identity/` and SDK in `sdk/`

---

## License

Demo source available under MIT for the Colosseum judging period. Brand assets (logo, character portraits, voice samples) remain © COLONII 2026.
