"use client";

/*
 LiveScene — real-time Anja experience embedded inside the Colosseum demo.

 Tries video first (Daily.co + MuseTalk pipeline via /api/session).
 Falls back to streaming chat (/api/chat) if video infra is unavailable.
 Falls back to fully scripted if both fail — the demo MUST always land.

 The right rail shows the on-chain anchor + live "memory anchor" pulses
 whenever Anja captures something worth remembering. This is the
 "experience first, plumbing visible" framing the pitch needs.*/

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import AvatarView from "../components/AvatarView";
import { anchorMemoryAndList, ensureIdentity } from "./colonii-session";

type CallState = "idle" | "listening" | "thinking" | "speaking";
// Four-tier fallback ladder:
// 1. loading — waiting for /api/session + Tavus handshake
// 2. video — Tavus replica streaming over Daily.co (the primary)
// 3. chat — text streaming via /api/chat if video can't establish
// 4. fallback — scripted canned replies if /api/chat is also unavailable
// audit the chat tier should be kept and
// fully wired with Anja's Colony lore (voice phonetic Anya → AHN-yah); the
// short-lived "unavailable" tier from an earlier patch has been
// retired. The legacy "unavailable" string is kept in the union only
// so the orphaned JSX block compiles until pruned in a follow-up.
type Mode = "loading" | "video" | "chat" | "fallback" | "unavailable";

interface LiveSceneProps {
  avatarName: string;
  wallet: string;
  identityHash: string;
  onEnd: (summary: { messageCount: number; usedRealLLM: boolean }) => void;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface MemoryAnchor {
  id: string;
  label: string;
  hash: string;
  at: number;
}

// No client-side max-call cap. Users end the conversation themselves
// via the End button — no surprise time-outs mid-conversation. Tavus
// has its own server-side timeouts (participant_absent_timeout fires
// only if no one is in the room; idle_timeout is configured on the
// persona) which we can't override from the browser.
//
// SESSION_TIMEOUT_MS only governs the initial connect. If we don't get
// a roomUrl back from /api/session within this window we fall to chat.
// Once video is connected, this timer is a no-op (functional setState
// guards against late-fires).
// C1: bumped from 20_000 → 35_000 — cold-start Tavus + Daily + MuseTalk
// warm-up + audio track on conference Wi-Fi routinely takes 25-30s.
const SESSION_TIMEOUT_MS = 35_000;

// C2: module-level helper so cleanup can fire-and-forget endConversation
// without awaiting — the request must survive component unmount.
function endConversation(conversationId: string): void {
  const body = JSON.stringify({ conversationId });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/session/end",
      new Blob([body], { type: "application/json" })
    );
  } else {
    fetch("/api/session/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }
}

// H2: module-level lock to serialize double-click / double-mount races.
// throttle memory anchors to max one per 10 seconds.
let lastAnchorAt = 0;

// (Removed: module-level `connectingLock` boolean. PERF-audit
// : a synchronous throw between setting the lock and
// registering the cleanup would strand it at `true` forever, hanging
// every subsequent LiveScene mount on the "loading" overlay. It also
// blocked legitimate multi-tab use of the demo on the same browser.
// The per-mount `cancelled` flag already serialises React 18 strict-
// mode double-invocation correctly, and AvatarView's getCallInstance
// teardown handles the actual Daily.co singleton concern.)

export default function LiveScene({
  avatarName,
  wallet,
  identityHash,
  onEnd,
}: LiveSceneProps) {
  const [mode, setMode] = useState<Mode>("loading");
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Chat fallback state
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // separate streaming state so existing bubbles don't reconcile per token
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Memory anchor stream (visualizes Solana-side activity)
  const [anchors, setAnchors] = useState<MemoryAnchor[]>([]);
  const [latestPulse, setLatestPulse] = useState(false);

  // Conversation ID for Tavus — tracked so we can end it on unmount and
  // stop billing the moment the user moves on.
  const conversationIdRef = useRef<string | null>(null);

  // --- start the session --------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    // Functional setState here is critical — using `mode` directly would
    // capture a stale closure value (always "loading") and force a fallback
    // even if video had already connected. Functional update reads live
    // state instead. This was the bug behind "video loaded then fell back".
    const t = window.setTimeout(() => {
      if (cancelled) return;
      setMode((current) => (current === "loading" ? "chat" : current));
    }, SESSION_TIMEOUT_MS);

    (async () => {
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "groq", mode: "video" }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(`Session unavailable (${res.status})`);
          setMode((current) => (current === "loading" ? "chat" : current));
          return;
        }
        const data = await res.json();
        if (!data.roomUrl) {
          setError("Session returned no room URL");
          setMode((current) => (current === "loading" ? "chat" : current));
          return;
        }
        // C2: check cancelled ONCE MORE after the async resolve —
        // if the user navigated away while fetch was in-flight, fire-and-
        // forget end the conversation immediately so Tavus credits stop.
        if (cancelled) {
          const convId = data.conversationId ?? null;
          if (convId) endConversation(convId);
          return;
        }
        setRoomUrl(data.roomUrl);
        setToken(data.token ?? null);
        conversationIdRef.current = data.conversationId ?? null;
        setMode("video");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Connection failed");
        setMode((current) => (current === "loading" ? "chat" : current));
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      // End Tavus conversation immediately so credits stop. Use sendBeacon
      // when available so the request survives unmount/navigation.
      const convId = conversationIdRef.current;
      if (convId) {
        endConversation(convId);
      }
    };
  }, []);

  // (No max-call timer here — the conversation ends when the user
  // clicks End conversation, never automatically.)

  // --- real on-chain memory anchor pulses ---------------------------------
  // Each beat writes a real MemoryAnchor PDA via the mock-mode SDK.
  // Identifiers are deterministice input → same hash → same PDA.
  // When the team flips to live devnet mode the same code path produces
  // real Solana tx signatures.
  // C5: ensureIdentity called at mount (before scheduling beats) so the
  // anchor calls don't throw inside MockBackend.anchorMemory if
  // adoptWalletOwner reset the backend between mount and the first beat.
  useEffect(() => {
    if (mode === "loading") return;
    let cancelled = false;
    const labels = ["Pitch", "Identity", "Focus", "Tone"];
    let i = 0;

    // C5: ensure the identity PDA exists before we try to write memory anchors.
    // If ensureIdentity fails (wallet race / backend reset) we skip scheduling
    // rather than crashing — the user still gets the full video experience.
    const schedule = async () => {
      try {
        await ensureIdentity(avatarName as any);
      } catch (e) {
        console.warn("[LiveScene] ensureIdentity failed, skipping anchor pulses:", e);
        return;
      }
      if (cancelled) return;

      const beat = async () => {
        if (cancelled) return;
        const label = labels[i % labels.length];
        const result = await anchorMemoryAndList({
          sessionId: "colosseum-live",
          topic: label.toLowerCase(),
          notes: `LiveScene autopulse #${i + 1}`,
        });
        if (cancelled) return;
        if (result?.anchored) {
          const a = result.anchored;
          setAnchors((prev) =>
            [
              {
                id: a.address.toBase58(),
                label,
                hash: a.memoryHashShort,
                at: Date.now(),
              },
              ...prev,
            ].slice(0, 4)
          );
          setLatestPulse(true);
          window.setTimeout(() => setLatestPulse(false), 1800);
        }
        i++;
      };
      const t1 = window.setTimeout(beat, 6_000);
      const t2 = window.setTimeout(beat, 22_000);
      const t3 = window.setTimeout(beat, 44_000);
      // Store cleanup handles so the effect cleanup can cancel them.
      timersRef.current = [t1, t2, t3];
    };

    const timersRef = { current: [] as number[] };
    schedule();

    return () => {
      cancelled = true;
      timersRef.current.forEach((t) => window.clearTimeout(t));
    };
  }, [mode, avatarName]);

  // --- chat fallback: greet + handle input -------------------------------
  useEffect(() => {
    if (mode !== "chat") return;
    let cancelled = false;
    // Hard 15s safety: if the greeting fetch or its stream stalls (rare,
    // but breaks the demo loudly), abort and show a scripted greeting so
    // the user always sees Anja saying something on entry.
    const controller = new AbortController();
    const safety = window.setTimeout(() => {
      controller.abort();
    }, 15_000);
    (async () => {
      setSending(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "__greeting__",
            model: "groq",
            history: [],
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          if (!cancelled) {
            setMode("fallback");
            setChat([{ role: "assistant", content: SCRIPTED_GREETING }]);
          }
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        setStreamingContent("");
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          if (cancelled) return;
          setStreamingContent(acc);
        }
        if (!cancelled) {
          const finalContent = acc || SCRIPTED_GREETING;
          setChat([{ role: "assistant", content: finalContent }]);
          setStreamingContent(null);
        }
      } catch {
        if (!cancelled) {
          setMode("fallback");
          setChat([{ role: "assistant", content: SCRIPTED_GREETING }]);
          setStreamingContent(null);
        }
      } finally {
        if (!cancelled) setSending(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(safety);
      controller.abort();
    };
  }, [mode]);

  // --- send chat message --------------------------------------------------
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      // capture user message without stale chat snapshot —
      // append user turn functionally, then stream assistant into streamingContent.
      setChat((prev) => [...prev, { role: "user", content: text }]);
      setDraft("");
      setSending(true);

      // Substantive turns get a real on-chain memory anchor, throttled
      // to one anchor per 10 seconds so fast-typing judges don't stack identical hashes.
      if (text.length > 25 && Date.now() - lastAnchorAt > 10_000) {
        lastAnchorAt = Date.now();
        setLatestPulse(true);
        window.setTimeout(() => setLatestPulse(false), 1800);
        const labels = ["Topic", "Intent", "Tone"];
        // Use a stable label based on text length since chat state isn't captured here
        const label = labels[text.length % labels.length];
        anchorMemoryAndList({
          sessionId: "colosseum-live-chat",
          topic: label.toLowerCase(),
          notes: text,
        }).then((result) => {
          if (!result?.anchored) return;
          const a = result.anchored;
          setAnchors((prev) =>
            [
              {
                id: a.address.toBase58(),
                label,
                hash: a.memoryHashShort,
                at: Date.now(),
              },
              ...prev,
            ].slice(0, 4)
          );
        });
      }

      if (mode === "fallback") {
        // No LLM — pick from scripted reply pool
        setChat((prev) => {
          const reply = SCRIPTED_REPLIES[prev.length % SCRIPTED_REPLIES.length];
          window.setTimeout(() => {
            setChat((p) => [...p, { role: "assistant", content: reply }]);
            setSending(false);
          }, 900);
          return prev;
        });
        return;
      }

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            model: "groq",
            // pass current chat snapshot for history — captured at call time
            history: chat,
          }),
        });
        if (!res.ok || !res.body) {
          setChat((prev) => [
            ...prev,
            { role: "assistant", content: SCRIPTED_REPLIES[0] },
          ]);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        setStreamingContent("");
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          // update streaming bubble only — existing bubbles don't reconcile
          setStreamingContent(acc);
        }
        // Commit the completed assistant turn
        setChat((prev) => [...prev, { role: "assistant", content: acc }]);
        setStreamingContent(null);
      } catch {
        setChat((prev) => [
          ...prev,
          { role: "assistant", content: SCRIPTED_REPLIES[0] },
        ]);
        setStreamingContent(null);
      } finally {
        setSending(false);
      }
    },
    [chat, mode]
  );

  // Throttle smooth-scroll to message-count changes only — the previous
  // version fired per token during streaming and got janky .
  useEffect(() => {
    if (!chatEndRef.current) return;
    chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [chat.length]);

  function handleEnd() {
    // confirm before ending a real Daily.co session — billing stops
    // immediately on confirm. Skip confirm in fallback mode (no real session).
    if (mode === "video" || mode === "chat") {
      const ok = window.confirm("End the conversation with " + avatarName + "?");
      if (!ok) return;
    }
    onEnd({ messageCount: chat.length, usedRealLLM: mode === "video" || mode === "chat" });
  }

  return (
    <motion.section
      data-colosseum-chat
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      style={S.shell}
    >
      <div style={S.left}>
        <header style={S.header}>
          <div style={S.headerLeft}>
            {/* the design: a small COLONII mark anchors
 the top-left of the call surface so every state of the
 live experience reads as "you are inside COLONII." We
 use the icon-only mark (not the full wordmark) so the
 pill row beside it stays the dominant signal.*/}
            {/* eslint-disable-next-line @next/next/no-img-element*/}
            <img
              src="/colonii-icon-white.png"
              alt=""
              aria-hidden="true"
              style={S.headerBrand}
            />
            <div style={S.statePill}>
              <span style={S.dot(callState, mode)} />
              {labelForState(callState, mode)}
            </div>
            <div style={S.title}>{avatarName}</div>
          </div>
          <div style={S.headerRight}>
            <ModePill mode={mode} />
            <button
              onClick={handleEnd}
              style={S.endBtn}
              aria-label={`End conversation with ${avatarName}`}
            >
              End conversation
            </button>
          </div>
        </header>

        <div style={S.stage}>
          {mode === "loading" && (
            <div style={S.loadingWrap}>
              <div style={S.loadingOrb} />
              <div style={S.loadingText}>Connecting to {avatarName}…</div>
            </div>
          )}

          {/* (the "unavailable" surface from a
 short-lived earlier patch is gone — the chat tier is the
 fallback again. The type union still carries the value
 so the orphaned label-helper compiles; this comment marks
 the deletion point.)*/}

          {mode === "video" && (
            <div style={S.videoWrap}>
              <AvatarView
                roomUrl={roomUrl}
                token={token}
                onStateChange={(s) => setCallState(s)}
                onError={(m) => {
                  // Surface but do NOT auto-fallback once video is up —
                  // a transient blip shouldn't yank the user to chat.
                  setError(`Video: ${m}`);
                }}
                onUserRequestChat={() => {
                  // the report the demo deadlocking on the
                  // "Connecting to Anja…" overlay when the Pipecat bot
                  // server isn't reachable. AvatarView surfaces this
                  // button after 10s of unconnected state; clicking it
                  // ends the Tavus conversation (stops billing) and
                  // hands the user off to the text-chat tier, which
                  // /api/chat already serves cleanly with the right
                  // Anja + COLONII personality.
                  const convId = conversationIdRef.current;
                  if (convId) endConversation(convId);
                  conversationIdRef.current = null;
                  setRoomUrl(null);
                  setToken(null);
                  setMode("chat");
                }}
              />
              <div style={S.videoCaption}>
                Live · {avatarName} is responding in real time.
              </div>
              {/* Voice attribution — ElevenLabs powers the TTS pipeline.
 The provided asset is the black-on-transparent "Grants" mark;
 we invert it via CSS so it reads white on the dark scrim.*/}
              <div style={S.voiceCredit}>
                <span style={S.voiceCreditLabel}>Voice</span>
                <span style={S.voiceCreditDot} />
                {/* eslint-disable-next-line @next/next/no-img-element*/}
                <img
                  src="/elevenlabs-grants-black.webp"
                  alt="ElevenLabs"
                  style={S.voiceCreditLogo}
                />
              </div>
            </div>
          )}

          {(mode === "chat" || mode === "fallback") && (
            <ChatStage
              chat={chat}
              streamingContent={streamingContent}
              draft={draft}
              setDraft={setDraft}
              sendMessage={sendMessage}
              sending={sending}
              chatEndRef={chatEndRef}
            />
          )}
        </div>
      </div>

      <aside style={S.right}>
        <div style={S.rightSection}>
          <div style={S.label}>Your COLONII</div>
          <div style={S.statusRow}>
            <Pill>Secured</Pill>
            <Pill>Portable</Pill>
            <Pill>Owned</Pill>
          </div>
        </div>

        <div style={S.divider} />

        <div style={S.rightSection}>
          <div style={S.label}>Memory anchors</div>
          <p style={S.faintSm}>
            Anything worth remembering becomes a tiny verifiable record. You
            never have to think about it.
          </p>
          <AnimatePresence initial={false}>
            {anchors.map((a) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: -6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.4 }}
                style={S.anchor}
              >
                <div style={S.anchorTop}>
                  <span style={S.anchorLabel}>{a.label}</span>
                  {/* RelTime owns its own interval — no outer setNow tick*/}
                  <RelTime at={a.at} />
                </div>
                <div style={S.anchorHash}>{a.hash}</div>
              </motion.div>
            ))}
          </AnimatePresence>
          {anchors.length === 0 && (
            <div style={S.anchorEmpty}>
              No anchors yet. They appear as Anja remembers things.
            </div>
          )}
        </div>

        <div style={S.divider} />

        <div style={S.rightSection}>
          <div style={S.label}>Identity anchor</div>
          <motion.div
            animate={{
              boxShadow: latestPulse
                ? "0 0 0 2px var(--accent), 0 0 32px rgba(201,150,90,0.3)"
                : "0 0 0 1px var(--border)",
            }}
            transition={{ duration: 0.5 }}
            style={S.anchorBox}
          >
            <div style={S.kv}>
              <span style={S.faintSm}>Wallet</span>
              <span style={S.mono}>{wallet}</span>
            </div>
            <div style={S.kv}>
              <span style={S.faintSm}>Hash</span>
              <span style={S.mono}>{identityHash}</span>
            </div>
            <div style={S.kv}>
              <span style={S.faintSm}>Status</span>
              <span style={S.verifiedRow}>
                <span style={S.greenDot} /> Verified
              </span>
            </div>
          </motion.div>
          <p style={{ ...S.faintSm, marginTop: 10 }}>
            The chain is invisible. It just makes your COLONII portable.
          </p>
        </div>

        {error && <div style={S.error}>{error}</div>}
      </aside>
    </motion.section>
  );
}

/* ── RelTime micro-component ─────────────────────────────────*/
// owns its own 5s interval so the outer LiveScene doesn't re-render
// the whole tree just to update "Xs ago" labels.

function secondsAgo(t: number) {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 1) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

function RelTime({ at }: { at: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => tick((n) => n + 1), 5_000);
    return () => window.clearInterval(interval);
  }, []);
  return <span style={S.anchorTime}>{secondsAgo(at)}</span>;
}

/* ── Chat stage subcomponent ─────────────────────────────────*/

function ChatStage({
  chat,
  streamingContent,
  draft,
  setDraft,
  sendMessage,
  sending,
  chatEndRef,
}: {
  chat: ChatMsg[];
  streamingContent: string | null;
  draft: string;
  setDraft: (s: string) => void;
  sendMessage: (s: string) => void;
  sending: boolean;
  chatEndRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div style={S.chatStage}>
      <div style={S.chatThread}>
        <div style={S.chatThreadInner}>
          {chat.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              style={{
                ...S.bubble,
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                background:
                  m.role === "user" ? "var(--accent-dim)" : "var(--bg-surface)",
                borderRadius:
                  m.role === "user"
                    ? "14px 14px 4px 14px"
                    : "14px 14px 14px 4px",
              }}
            >
              {m.content}
            </motion.div>
          ))}
          {/* streaming bubble is separate — existing bubbles don't reconcile per token*/}
          {streamingContent !== null && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              style={{
                ...S.bubble,
                alignSelf: "flex-start",
                background: "var(--bg-surface)",
                borderRadius: "14px 14px 14px 4px",
              }}
            >
              {streamingContent || (sending ? "…" : "")}
            </motion.div>
          )}
          <div ref={chatEndRef} />
        </div>
      </div>
      <div style={S.composer}>
        <label htmlFor="colosseum-chat-input" className="sr-only">
          Message to Anja
        </label>
        <input
          id="colosseum-chat-input"
          autoFocus
          type="text"
          value={draft}
          placeholder="Tell Anja what's on your mind…"
          aria-label="Message to Anja"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !sending) sendMessage(draft);
          }}
          style={S.composerInput}
        />
        <button
          onClick={() => sendMessage(draft)}
          disabled={sending || !draft.trim()}
          aria-label="Send message"
          style={S.sendBtn}
        >
          Send
        </button>
      </div>
    </div>
  );
}

/* ── Tiny components ─────────────────────────────────────────*/

function Pill({ children }: { children: React.ReactNode }) {
  return <span style={S.pill}>{children}</span>;
}

// META hoisted to module scope — not recreated per render.
// H3: fallback pill brightened to amber so scripted replies are obvious to judges.
const MODE_META: Record<Mode, { text: string; color: string }> = {
  loading: { text: "Connecting", color: "#6EA8FF" },
  video: { text: "Live video", color: "var(--success)" },
  unavailable: { text: "Unavailable", color: "#FFA500" },
  // "chat" / "fallback" entries kept so the existing JSX branches and
  // ModePill helper compile, but neither mode is reachable in the
  // current flow — see the Mode type comment.
  chat: { text: "Online", color: "var(--success)" },
  fallback: { text: "Demo mode (offline)", color: "#FFA500" },
};

// the design paint the right-side mode indicator in a
// state-specific colour: blue while connecting, green once the call is
// live (whether video or chat fallback). Fallback is amber — visible
// enough that the presenter can call it out without being shouty.
function ModePill({ mode }: { mode: Mode }) {
  const m = MODE_META[mode];
  return (
    <span style={{ ...S.modePill, color: m.color, borderColor: m.color }}>
      <span style={{ ...S.modeDot, background: m.color }} />
      {m.text}
    </span>
  );
}

function labelForState(s: CallState, mode: Mode): string {
  if (mode === "loading") return "Connecting";
  if (mode === "unavailable") return "Unavailable";
  if (mode === "fallback") return "Offline replay";
  if (mode === "chat") return "Online";
  switch (s) {
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking";
    case "speaking":
      return "Speaking";
    default:
      return "Online";
  }
}

/* ── Scripted fallback content ───────────────────────────────*/

const SCRIPTED_GREETING =
  "Hey. Good to see you. What's on your mind right now?";

const SCRIPTED_REPLIES = [
  "Got you. Let's ground it. What's the core idea you don't want to lose?",
  "That's the thread. Hold it: AI that doesn't reset, because you don't.",
  "I'll keep that close. We'll come back to it.",
  "Say more. I'm tracking.",
];

/* ── Styles ─────────────────────────────────────────────────*/

const S: Record<string, any> = {
  shell: {
    width: "100%",
    maxWidth: 1180,
    height: "min(760px, 92vh)",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 320px",
    gap: 16,
    position: "relative",
    zIndex: 1,
  },
  left: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 24px 60px -20px rgba(0,0,0,0.5)",
  },
  header: {
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid var(--border)",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  // the design anchor the call surface with a small
  // COLONII mark in the top-left. Sized to sit visually equal to the
  // pill row beside it — not a brand stamp, more a presence cue.
  headerBrand: {
    width: 22,
    height: 22,
    objectFit: "contain" as const,
    opacity: 0.92,
    // Subtle bloom so it reads on the dark header band.
    filter: "drop-shadow(0 0 6px rgba(255,255,255,0.18))",
  },
  statePill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    border: "1px solid var(--border)",
    borderRadius: 999,
    fontSize: 11,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
  },
  // State dot reflects two axes:
  // 1) `mode` — overall video/chat/loading state of the call.
  // 2) `callState` — fine-grained speaking/listening/thinking inside
  // the call once we're connected.
  // when mode is "video" but callState is still "idle" (Daily
  // hasn't produced a frame yet), show loading-blue — not green —
  // so the pill doesn't claim "Online · pulsing green" before any
  // video has arrived. Green only when callState leaves idle.
  dot: (s: CallState, mode: Mode = "video"): React.CSSProperties => {
    // Loading phase: cool blue pulses while the pipeline warms up.
    if (mode === "loading") {
      return {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#6EA8FF",
        boxShadow: "0 0 10px #6EA8FF",
      };
    }
    if (mode === "fallback") {
      return {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--text-muted)",
        boxShadow: "none",
      };
    }
    // video mode but no frame yet → stay blue (loading)
    if (mode === "video" && s === "idle") {
      return {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#6EA8FF",
        boxShadow: "0 0 10px #6EA8FF",
      };
    }
    return {
      width: 6,
      height: 6,
      borderRadius: "50%",
      background:
        s === "speaking"
          ? "var(--accent)"
          : s === "listening"
          ? "var(--success)"
          : s === "thinking"
          ? "var(--persona-grace)"
          : "var(--success)",
      boxShadow: "0 0 8px currentColor",
    };
  },
  title: {
    fontFamily: "var(--font-display)",
    fontSize: 18,
  },
  modePill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    border: "1px solid",
    borderRadius: 999,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  modeDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
  },
  endBtn: {
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 14px",
    minHeight: 40,
    fontSize: 13,
    cursor: "pointer",
  },
  stage: {
    flex: 1,
    position: "relative" as const,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  loadingWrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  loadingOrb: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    background:
      "radial-gradient(circle at 30% 30%, rgba(232,181,112,0.6), rgba(201,150,90,0.25) 60%, rgba(0,0,0,0) 100%)",
    boxShadow: "0 0 80px rgba(201,150,90,0.25)",
    animation: "spin 4s linear infinite",
  },
  loadingText: { color: "var(--text-muted)", fontSize: 14 },
  // Retry button on the unavailable-mode surface. Quiet outlined pill,
  // greens up on focus via the global :focus-visible rule.
  retryBtn: {
    marginTop: 18,
    background: "transparent",
    color: "var(--text)",
    fontFamily: "var(--font-display)",
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase" as const,
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 999,
    padding: "8px 18px",
    cursor: "pointer",
    transition: "border-color 200ms ease, transform 160ms ease",
  },
  videoWrap: {
    flex: 1,
    position: "relative" as const,
    background: "#000",
    minHeight: 0,
  },
  videoCaption: {
    position: "absolute" as const,
    bottom: 12,
    left: 12,
    color: "var(--text)",
    fontSize: 12,
    background: "var(--scrim)",
    padding: "6px 10px",
    borderRadius: 6,
    backdropFilter: "blur(6px)",
  },
  voiceCredit: {
    position: "absolute" as const,
    bottom: 12,
    right: 12,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "var(--text)",
    fontSize: 11,
    background: "var(--scrim)",
    padding: "6px 10px",
    borderRadius: 6,
    backdropFilter: "blur(6px)",
    letterSpacing: 0.5,
  },
  voiceCreditLabel: {
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
  },
  voiceCreditDot: {
    width: 3,
    height: 3,
    borderRadius: "50%",
    background: "var(--accent)",
  },
  voiceCreditLogo: {
    height: 14,
    width: "auto" as const,
    display: "block",
    // The asset is black-on-transparent; invert so it reads as the
    // brand-correct ElevenLabs mark on a dark scrim.
    filter: "invert(1) brightness(1.05)",
    opacity: 0.92,
  },
  chatStage: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  chatThread: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "20px 16px",
  },
  chatThreadInner: {
    width: "100%",
    maxWidth: 600,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  bubble: {
    padding: "11px 14px",
    border: "1px solid var(--border)",
    maxWidth: "82%",
    fontSize: 14,
    lineHeight: 1.5,
  },
  composer: {
    padding: 14,
    borderTop: "1px solid var(--border)",
    display: "flex",
    gap: 8,
    maxWidth: 720,
    margin: "0 auto",
    width: "100%",
  },
  composerInput: {
    flex: 1,
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 14,
    outline: "none",
  },
  sendBtn: {
    background: "var(--accent)",
    color: "var(--on-accent)",
    border: "none",
    borderRadius: 10,
    padding: "12px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  right: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    overflowY: "auto" as const,
    boxShadow: "0 24px 60px -20px rgba(0,0,0,0.5)",
  },
  rightSection: { display: "flex", flexDirection: "column", gap: 8 },
  label: {
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
  },
  faintSm: { color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 },
  statusRow: { display: "flex", gap: 6, flexWrap: "wrap" as const },
  pill: {
    fontSize: 12,
    padding: "4px 10px",
    border: "1px solid var(--border-warm)",
    color: "var(--text)",
    borderRadius: 999,
    background: "var(--accent-glow)",
  },
  divider: {
    height: 1,
    background: "var(--border)",
    margin: "10px 0",
  },
  anchor: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "10px 12px",
    background: "var(--bg)",
    marginBottom: 6,
  },
  anchorTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  anchorLabel: {
    fontFamily: "var(--font-display)",
    fontSize: 14,
    color: "var(--text)",
  },
  anchorTime: { color: "var(--text-faint)", fontSize: 11 },
  anchorHash: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    fontSize: 11,
    color: "var(--accent)",
  },
  anchorEmpty: {
    color: "var(--text-faint)",
    fontSize: 12,
    fontStyle: "italic" as const,
  },
  anchorBox: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 12,
    transition: "box-shadow 500ms ease",
  },
  kv: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    padding: "4px 0",
  },
  mono: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    fontSize: 12,
  },
  verifiedRow: { display: "inline-flex", alignItems: "center", gap: 6 },
  greenDot: {
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--success)",
    boxShadow: "0 0 8px var(--success-glow)",
  },
  error: {
    marginTop: 8,
    color: "var(--error)",
    fontSize: 12,
    border: "1px solid var(--error-border)",
    background: "var(--error-bg)",
    borderRadius: 6,
    padding: "6px 10px",
  },
};
