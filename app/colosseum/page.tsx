"use client";

/*
  COLONII — Colosseum hackathon clickable demo (3 min).
  Self-contained, fully scripted, all backend calls mocked.
  Source of truth: "User journey for DEMO" docs (Apr/May 2026).
  Critical: do NOT introduce real network calls here — every
  beat must land in <2s for the live demo. Speed is the point.
*/

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ColoniiWalletProviders } from "./wallet-providers";
import LiveScene from "./LiveScene";
import {
  adoptWalletOwner,
  anchorMemoryAndList,
  ensureIdentity,
  grantDemoCredential,
  getCurrentIdentity,
  getProofSnapshot,
} from "./colonii-session";
import type {
  AvatarName,
  IdentityRecord,
  MemoryRecord,
} from "../../lib/colonii-sdk/types";

type Scene =
  | "landing"
  | "consent"
  | "securing"
  | "secured"
  | "avatar"
  | "memories"
  | "availability"
  | "live"
  | "chat"
  | "focus"
  | "graph"
  | "return"
  | "dashboard"
  | "roadmap"
  // "rhythm" removed 2026-05-11 (Aileen) — roadmap now transitions
  // directly to thesis.
  | "thesis"
  | "wordmark";

interface SeededMemory {
  id: string;
  fact: string;
  created_at: string;
}

type ChatTurn = {
  who: "user" | "anja";
  text: string;
  highlight?: boolean;
};

const FRESH_SCRIPT: ChatTurn[] = [
  { who: "user", text: "Hey, I'm preparing for a big pitch and a bit scattered." },
  { who: "anja", text: "Got you. Let's ground it. What's the core idea you don't want to lose?" },
  { who: "user", text: "It's about identity — and how AI should actually remember you.", highlight: true },
  { who: "anja", text: "That's the thread. Hold it: AI that doesn't reset, because you don't." },
];

const RETURN_SCRIPT: ChatTurn[] = [
  {
    who: "anja",
    text:
      "Last time you were working on a pitch about identity — AI that doesn't reset. Want to pick that back up?",
  },
];

// Display fallbacks while the SDK is initialising or if it errors.
// Real values come from the on-chain Identity record (mock-mode SDK
// returns the same shapes the live mode will, so swapping is a no-op).
const WALLET_FALLBACK = "8xA3…k9L2";
const IDENTITY_HASH_FALLBACK = "0xA81F…92BC";

export default function ColosseumDemo() {
  // MotionConfig at the outer edge so reduced-motion preference applies
  // to the wallet modal too, and so the provider doesn't re-mount on
  // inner state changes (audit L3).
  return (
    <MotionConfig reducedMotion="user">
      <ColoniiWalletProviders>
        <ColosseumDemoInner />
      </ColoniiWalletProviders>
    </MotionConfig>
  );
}

function ColosseumDemoInner() {
  const [scene, setScene] = useState<Scene>("landing");
  const [email, setEmail] = useState("");
  const [terms, setTerms] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [memoryPulse, setMemoryPulse] = useState(false);
  const [memoryNodes, setMemoryNodes] = useState<string[]>([]);
  const [typing, setTyping] = useState(false);
  const [demoLoggedIn, setDemoLoggedIn] = useState(false);
  const [bookedSlot, setBookedSlot] = useState<string | null>(null);
  // Default to "guest" so a stranger landing on the public hackathon URL
  // meets Ania for the first time — no pre-seeded memories, no personalized
  // greeting, just a fresh Phase-1 stranger introduction that matches the
  // new Colony lore. The 4 named demo users (sam/aileen/luke/lollie) stay
  // available via the presenter panel (Shift+P) for internal demos where
  // Sam wants the personalized "Ania remembers me" moment.
  const [demoUser, setDemoUser] = useState("guest");

  // ── Wallet adapter integration ─────────────────────────────────────────
  // Adopt the connected wallet's pubkey as the identity owner. When no
  // wallet is connected, the SDK falls back to Keypair.generate() (in-
  // memory). User chooses on the landing scene. Locked at handleStart.
  const { publicKey, disconnect, connected, connecting, wallet: adapterWallet } =
    useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  useEffect(() => {
    adoptWalletOwner(publicKey);
  }, [publicKey]);

  // H4: if Phantom popup is dismissed, the adapter can stay in `connecting`
  // state with no recovery affordance. Force a UI-side bail-out after 4s
  // (was 8s — halved to surface the "Try again" affordance faster without
  // risking false positives on slow connections).
  const [walletStuck, setWalletStuck] = useState(false);
  useEffect(() => {
    if (!connecting) {
      setWalletStuck(false);
      return;
    }
    const t = window.setTimeout(() => setWalletStuck(true), 4_000);
    return () => window.clearTimeout(t);
  }, [connecting]);

  // Real on-chain identity record (mock-mode SDK; same shape as live mode).
  // Lazily populated when the user reaches the "secured" beat.
  const [identity, setIdentity] = useState<IdentityRecord | null>(null);
  const wallet = identity?.ownerWalletShort ?? WALLET_FALLBACK;
  const identityHash = identity?.identityHashShort ?? IDENTITY_HASH_FALLBACK;

  // Proof drawer ("View on-chain" reveal). Opens on demand from the
  // dashboard. Pulls the latest identity + memory list at open time so
  // judges always see fresh data (memory_count, sequence numbers, etc).
  const [proofOpen, setProofOpen] = useState(false);
  const [proofData, setProofData] = useState<{
    identity: IdentityRecord | null;
    memories: MemoryRecord[];
  } | null>(null);
  async function openProof() {
    const snap = await getProofSnapshot();
    setProofData(snap);
    setProofOpen(true);
  }

  // Tracked timeouts so a presenter jumping mid-script doesn't get
  // ghost setScene calls firing after the user has already moved on.
  // IMPORTANT: do NOT auto-clear on scene change — that would kill the
  // very timeouts that handlers schedule to advance the scene. Clear
  // only on unmount, or explicitly when the presenter jumps.
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const setTrackedTimeout = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timeoutsRef.current.delete(id);
      fn();
    }, ms);
    timeoutsRef.current.add(id);
    return id;
  };
  const clearTrackedTimeouts = () => {
    timeoutsRef.current.forEach((id) => clearTimeout(id));
    timeoutsRef.current.clear();
  };
  useEffect(() => {
    return () => clearTrackedTimeouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Used by the presenter jumper: cancels any pending auto-transitions
  // before forcing a manual scene change.
  const jumpToScene = (s: Scene) => {
    clearTrackedTimeouts();
    setScene(s);
  };

  // HIGH-3: Restore wallet name hover-identification after the CSS icon-only
  // restyle collapsed wallet names to font-size:0 / color:transparent. The
  // text node is still in the DOM (screen reader accessible), so we read it
  // and write it back as a `title` attribute so sighted users see a native
  // browser tooltip on hover. Uses MutationObserver so it works even if the
  // modal re-renders (React reconciliation, adapter re-init, etc.).
  useEffect(() => {
    function applyTitles() {
      const btns = document.querySelectorAll<HTMLButtonElement>(
        ".wallet-adapter-modal-list .wallet-adapter-button"
      );
      btns.forEach((btn) => {
        const text = btn.textContent?.trim();
        if (text && !btn.title) btn.title = text;
      });
    }

    const observer = new MutationObserver(() => applyTitles());
    observer.observe(document.body, { childList: true, subtree: true });
    applyTitles(); // run once on mount in case modal is already open

    return () => observer.disconnect();
  }, []);

  // Hydrate from URL params so judges/submitters can deep-link a configuration.
  // Supports: ?scene=live ?u=aileen ?email=demo@colonii.net ?avatar=Anja
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sceneParam = params.get("scene") as Scene | null;
    if (sceneParam) setScene(sceneParam);
    const u = params.get("u");
    if (u) setDemoUser(u);
    const e = params.get("email");
    if (e) setEmail(e);
    const a = params.get("avatar");
    if (a) setAvatar(a);
  }, []);

  const canEnter = email.includes("@");
  const canStart = terms && aiConsent;

  // --- LANDING -> CONSENT -----------------------------------------------
  function handleEnter() {
    if (!canEnter) return;
    setScene("consent");
  }

  // --- CONSENT -> IDENTITY SECURING --------------------------------------
  function handleStart() {
    if (!canStart) return;
    setScene("securing");

    // Silently authenticate as a seeded demo user so the live experience
    // (real video + LLM) works downstream. Never blocks the demo: if it
    // fails the live scene falls back to streaming chat, and that to
    // scripted. Demo-only — never expose real user PII.
    fetch("/api/demo-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: demoUser }),
    })
      .then((r) => {
        if (r.ok) setDemoLoggedIn(true);
      })
      .catch(() => {});

    // Create the on-chain identity (mock-mode SDK — real PDA, real hash,
    // no network). We default to "Anja" here so the wallet/hash labels
    // shown on the "Identity secured" screen are already populated by
    // the time the orb finishes pulsing. If the user later picks a
    // different avatar, we keep the same identity (DID is stable per
    // wallet) — switching avatars hits a separate update_avatar
    // instruction in the live program.
    ensureIdentity("Anja").then((id) => {
      if (id) setIdentity(id);
    });

    // Aileen note (May 10 deck): the "Securing your identity / This takes a
    // moment" screen was flashing too fast to read. Bumped from 1.7s → 3.0s
    // so the subcopy ("this takes a moment") actually gets a moment.
    setTrackedTimeout(() => setScene("secured"), 3000);
    // MED-12: bumped 5000 → 6500ms so the secured-beat checkmark (spring
    // delay 0.4s) + ring-draw animation (1.6s) fully settle before the
    // avatar transition fires (~2s animation + >0.1s settled = visible).
    setTrackedTimeout(() => setScene("avatar"), 6500);
  }

  // --- AVATAR -> CHAT ----------------------------------------------------
  function handlePickAvatar(name: string) {
    setAvatar(name);
  }
  function handleStartChat() {
    if (!avatar) return;
    // Grant the demo credential — flips Identity.status from `secured`
    // → `active`, which is what powers the "Verified" pill downstream.
    if (identity) {
      grantDemoCredential(identity.did)
        .then(() => getCurrentIdentity())
        .then((refreshed) => {
          if (refreshed) setIdentity(refreshed);
        })
        .catch(() => {});
    }
    setScene("memories");
  }

  function handleMemoriesContinue() {
    setScene("availability");
  }

  // --- AVAILABILITY -> LIVE OR BOOKED -----------------------------------
  function handleTalkNow() {
    setScene("live");
  }
  function handleBookSlot(slot: string) {
    setBookedSlot(slot);
    // Skip live; the user "booked" — proceed to graph after a brief beat
    setScene("graph");
    setMemoryNodes(["Booked", "Identity", "Pitch"]);
  }
  function handleLiveEnd() {
    // After real conversation ends, advance through proof beats
    setMemoryNodes(["Pitch", "Identity", "Focus"]);
    setScene("graph");
  }

  // --- SCRIPTED CHAT (fresh user) ----------------------------------------
  function runFreshScript() {
    setTurns([]);
    setTyping(false);
    let i = 0;
    const tick = () => {
      const turn = FRESH_SCRIPT[i];
      if (!turn) return;

      // Show typing indicator before AI replies — feels human
      if (turn.who === "anja") {
        setTyping(true);
        setTrackedTimeout(() => {
          setTyping(false);
          setTurns((prev) => [...prev, turn]);
          advance();
        }, 900);
        return;
      }

      setTurns((prev) => [...prev, turn]);
      if (turn.highlight) {
        setTrackedTimeout(() => {
          setMemoryPulse(true);
          setMemoryNodes(["Pitch", "Identity"]);
          // Real on-chain memory anchor (mock-mode SDK). The hash and
          // sequence are derived from real cryptographic primitives even
          // though no network is touched. The "View on-chain" panel can
          // surface these to skeptical judges.
          anchorMemoryAndList({
            sessionId: "colosseum-demo",
            topic: "identity",
            notes: turn.text,
          })
            .then(() => getCurrentIdentity())
            .then((refreshed) => {
              if (refreshed) setIdentity(refreshed);
            })
            .catch(() => {});
        }, 500);
        setTrackedTimeout(() => setMemoryPulse(false), 2600);
      }
      advance();
    };
    const advance = () => {
      i += 1;
      if (i < FRESH_SCRIPT.length) {
        const prev = FRESH_SCRIPT[i - 1];
        setTrackedTimeout(tick, prev.who === "user" ? 900 : 1100);
      } else {
        setTrackedTimeout(() => setScene("focus"), 1500);
      }
    };
    setTrackedTimeout(tick, 500);
  }

  function handleStartFocus() {
    setMemoryNodes(["Pitch", "Identity", "Focus"]);
    setScene("graph");
  }

  // --- HARD CUT -> RETURN USER ------------------------------------------
  function handleReturnUser() {
    setScene("return");
    // Pre-load avatar reply with no typing delay — this is the killer beat
    setTurns(RETURN_SCRIPT);
    setTrackedTimeout(() => setScene("dashboard"), 4200);
  }

  // --- DASHBOARD -> ROADMAP -> THESIS -> WORDMARK -----------------------
  function handleClose() {
    setScene("roadmap");
  }
  // Aileen 2026-05-11: rhythm scene removed; roadmap now goes
  // straight to thesis, then on to the wordmark close-out.
  function handleRoadmapNext() {
    setScene("thesis");
    setTrackedTimeout(() => setScene("wordmark"), 3600);
  }

  // --- DEV NAV (hidden, for stage rehearsal) ----------------------------
  const scenes: Scene[] = [
    "landing",
    "consent",
    "securing",
    "secured",
    "avatar",
    "memories",
    "availability",
    "live",
    "chat",
    "focus",
    "graph",
    "return",
    "dashboard",
    "roadmap",
    // "rhythm" removed 2026-05-11 (Aileen)
    "thesis",
    "wordmark",
  ];

  return (
    <>
      <main data-colosseum-shell style={styles.shell}>
        {/* faint identity orb backdrop so scenes feel anchored */}
        <BackdropOrb scene={scene} />

        <AnimatePresence mode="wait">
        {scene === "landing" && (
          <Frame key="landing" maxWidth={520}>
            {/* Editorial credit line — magazine-cover styling. The numerals
                + dotted leader pattern reads as deliberate art direction
                rather than templated UI. */}
            <div style={styles.editorialCredit}>
              <span style={styles.editorialNumeral}>01</span>
              <span style={styles.editorialDots} />
              <span style={styles.editorialLabel}>Identity</span>
            </div>
            <h1 style={styles.brandLogoWrap}>
              <span className="sr-only">COLONII</span>
              <Image
                src="/colonii-logo-white.png"
                alt=""
                aria-hidden
                width={200}
                height={40}
                priority
                style={styles.brandLogoImg}
              />
            </h1>
            {/* Aileen's edited slide 3: heading reads without the trailing
                period — keeps the line feeling continuous with the body. */}
            <p style={styles.heroLine}>An identity that remembers you</p>
            <p style={styles.muted}>
              The companion layer for human AI systems. No crypto wallet
              required — but bring one if you have it.
            </p>

            {/* Wallet adapter affordance — opt-in, never required.
                Two-path UX matches the original demo doc's 25/75 split:
                25% have a wallet → connect; 75% don't → app generates one. */}
            <div style={styles.walletChoiceRow}>
              {connected && publicKey ? (
                <button
                  onClick={() => disconnect().catch(() => {})}
                  style={styles.walletConnectedPill}
                  aria-label={`Disconnect ${adapterWallet?.adapter.name ?? "wallet"}`}
                >
                  <span style={styles.walletDot} />
                  Connected · {publicKey.toBase58().slice(0, 4)}…
                  {publicKey.toBase58().slice(-4)}
                  <span style={styles.walletPillX}>✕</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    setWalletStuck(false);
                    openWalletModal(true);
                  }}
                  disabled={connecting && !walletStuck}
                  style={styles.walletConnectButton}
                >
                  {connecting && !walletStuck
                    ? "Connecting…"
                    : walletStuck
                    ? "Try again"
                    : "Connect a wallet"}
                </button>
              )}
              <span style={styles.walletChoiceFaint}>
                or just continue — we'll create one for you.
              </span>
            </div>
            <label htmlFor="colosseum-email" className="sr-only">
              Email address
            </label>
            <input
              id="colosseum-email"
              autoFocus
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@somewhere.com"
              aria-label="Email address"
              style={styles.input}
              onKeyDown={(e) => e.key === "Enter" && handleEnter()}
            />
            <button
              style={{ ...styles.cta, opacity: canEnter ? 1 : 0.45 }}
              onClick={handleEnter}
              disabled={!canEnter}
            >
              Continue
            </button>
          </Frame>
        )}

        {scene === "consent" && (
          <Frame key="consent" maxWidth={520}>
            {/* Aileen's edited slide 7: drop the trailing period to keep
                the heading visually quieter — matches the "one beat / one
                breath" pacing of the deck's other headings. */}
            <h2 style={styles.h1}>One quick thing</h2>
            <p style={styles.muted}>
              COLONII is built around your consent. You can revoke any of this later.
            </p>
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={terms}
                onChange={(e) => setTerms(e.target.checked)}
              />
              <span>I agree to the Terms &amp; Conditions.</span>
            </label>
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={aiConsent}
                onChange={(e) => setAiConsent(e.target.checked)}
              />
              <span>I consent to interacting with an AI companion.</span>
            </label>
            <button
              style={{ ...styles.cta, opacity: canStart ? 1 : 0.45 }}
              onClick={handleStart}
              disabled={!canStart}
            >
              Start
            </button>
          </Frame>
        )}

        {scene === "securing" && (
          <Frame key="securing" maxWidth={520} center>
            <LogoMark size={160} pulsing />
            <p style={styles.statusText}>Securing your identity</p>
            {/* Aileen's edited slide 24: no period after the subcopy. */}
            <p style={styles.faint}>This takes a moment</p>
          </Frame>
        )}

        {scene === "secured" && (
          <Frame key="secured" maxWidth={520} center>
            <div style={{ position: "relative" }}>
              <LogoMark size={160} solid />
              <motion.svg
                width="140"
                height="140"
                viewBox="0 0 140 140"
                style={{ position: "absolute", inset: 0 }}
                initial={{ rotate: -90 }}
                animate={{ rotate: 270 }}
                transition={{ duration: 1.6, ease: "easeOut" }}
              >
                <circle
                  cx="70"
                  cy="70"
                  r="68"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                  strokeDasharray="427"
                  strokeDashoffset="0"
                  opacity="0.5"
                />
              </motion.svg>
              <motion.svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                }}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.4, type: "spring", stiffness: 200 }}
              >
                <path
                  d="M5 12 L10 17 L19 7"
                  fill="none"
                  stroke="rgba(20,17,15,0.85)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </motion.svg>
            </div>
            <p style={styles.statusText}>Identity secured</p>
            <div style={styles.verifiedPill}>
              <span style={styles.dotGreenLive} /> Verified · {wallet}
            </div>
          </Frame>
        )}

        {scene === "avatar" && (
          <motion.section
            key="avatar"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.5 }}
            style={styles.castShell}
          >
            {/* Editorial header — chapter device */}
            {/* Aileen's edited slides 11 & 13: the label reads "COMPANIONS"
                (not "THE CAST") to keep the language warm. The numeral and
                dashed line stay the same chapter device. */}
            <div style={styles.editorialCredit}>
              <span style={styles.editorialNumeral}>03</span>
              <span style={styles.editorialDots} />
              <span style={styles.editorialLabel}>Companions</span>
            </div>

            <div data-cast-split style={styles.castSplit}>
              {/* Left rail — vertical list of personas. Selected highlights;
                  unselected dim. Hover reveals the bio without committing. */}
              <ol style={styles.castList}>
                {AVATARS.map((a, i) => {
                  const selected = avatar === a.name;
                  // Aileen 2026-05-11 (19:34): only Anja is interactive in
                  // this build — Hung/Femi/Leon are coming-soon. Showing
                  // them in the line-up keeps the "4 AI personas" story
                  // intact, but they are visibly dim and non-clickable so
                  // a presenter can't accidentally interrupt the flow.
                  const isAnja = a.name === "Anja";
                  return (
                    <li key={a.name} style={styles.castItem}>
                      <button
                        onClick={() => {
                          if (!isAnja) return;
                          handlePickAvatar(a.name);
                        }}
                        disabled={!isAnja}
                        style={{
                          ...styles.castEntry,
                          borderColor: selected
                            ? "var(--accent)"
                            : "var(--border)",
                          background: selected
                            ? "var(--accent-dim)"
                            : "transparent",
                          opacity: isAnja
                            ? selected || !avatar
                              ? 1
                              : 0.55
                            : 0.35,
                          cursor: isAnja ? "pointer" : "not-allowed",
                        }}
                        aria-pressed={selected}
                        aria-disabled={!isAnja}
                        aria-label={
                          isAnja
                            ? `Pick ${a.name} (${a.tag})`
                            : `${a.name} (${a.tag}) — available in the next release`
                        }
                        title={
                          isAnja ? undefined : "Available in the next release"
                        }
                      >
                        <span style={styles.castEntryNum}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <AvatarOrb name={a.name} size={36} />
                        <span style={styles.castEntryText}>
                          <span style={styles.castEntryName}>{a.name}</span>
                          <span style={styles.castEntryTag}>{a.tag}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {/* Right side — feature page for the chosen avatar.
                  Empty state when nothing picked. */}
              <div data-cast-feature style={styles.castFeature}>
                <AnimatePresence mode="wait">
                  {avatar ? (
                    <motion.div
                      key={avatar}
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.35 }}
                      style={styles.castFeatureInner}
                    >
                      <AvatarOrb name={avatar} size={140} />
                      <div style={styles.castFeatureName}>{avatar}</div>
                      <div style={styles.castFeatureTag}>
                        {AVATARS.find((a) => a.name === avatar)?.tag}
                      </div>
                      <p style={styles.castFeatureBio}>
                        {AVATARS.find((a) => a.name === avatar)?.bio}
                      </p>
                      <button
                        onClick={handleStartChat}
                        style={{ ...styles.cta, marginTop: 12 }}
                      >
                        Meet {avatar}
                      </button>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      style={styles.castEmpty}
                    >
                      {/* Aileen's edited slide 11: phrasing flips from
                          declarative ("Choose who…") to invitational
                          ("Who will you meet first?"). Reads less like a
                          form, more like a question to a friend. */}
                      <h2 style={styles.castEmptyTitle}>
                        Who will you meet first?
                      </h2>
                      <p style={styles.muted}>
                        You can switch later. Each of them remembers you
                        differently.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.section>
        )}

        {scene === "memories" && (
          <MemoriesFrame
            key="memories"
            avatarName={avatar ?? "Anja"}
            demoUser={demoUser}
            onContinue={handleMemoriesContinue}
          />
        )}

        {scene === "availability" && (
          <AvailabilityFrame
            key="availability"
            avatarName={avatar ?? "Anja"}
            onTalkNow={handleTalkNow}
            onBook={handleBookSlot}
          />
        )}

        {scene === "live" && (
          <LiveScene
            key="live"
            avatarName={avatar ?? "Anja"}
            wallet={wallet}
            identityHash={identityHash}
            onEnd={handleLiveEnd}
          />
        )}

        {(scene === "chat" || scene === "focus" || scene === "graph") && (
          <ChatLayout
            key="chat"
            avatar={avatar ?? "Anja"}
            turns={turns}
            memoryPulse={memoryPulse}
            memoryNodes={memoryNodes}
            scene={scene}
            typing={typing}
            wallet={wallet}
            identityHash={identityHash}
            onStartFocus={handleStartFocus}
            onReturnUser={handleReturnUser}
          />
        )}

        {scene === "return" && (
          <ChatLayout
            key="return"
            avatar={avatar ?? "Anja"}
            turns={turns}
            memoryPulse={false}
            memoryNodes={["Pitch", "Identity", "Focus"]}
            scene="return"
            typing={false}
            wallet={wallet}
            identityHash={identityHash}
            instantReply
          />
        )}

        {scene === "dashboard" && (
          <motion.section
            key="dashboard"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.5 }}
            style={styles.dashShell}
          >
            {/* Editorial header: title left, big numerals right.
                Breaks the centered-column composition that the audit
                flagged as the root "AI-template" tell. */}
            <div data-dash-header style={styles.dashHeader}>
              <div>
                <div style={styles.editorialCredit}>
                  <span style={styles.editorialNumeral}>02</span>
                  <span style={styles.editorialDots} />
                  <span style={styles.editorialLabel}>Your COLONII</span>
                </div>
                {/* Aileen's edited slide 9: heading becomes the three-word
                    chant ("Yours. Portable. Verifiable.") with a separate
                    subline carrying the explanatory copy — replaces the
                    earlier em-dash construction. */}
                <h2 style={styles.dashHeadline}>
                  Yours. Portable. Verifiable.
                </h2>
                <p style={styles.dashSubline}>
                  Your identity, memory and presence carried seamlessly
                  on-chain.
                </p>
              </div>
              <div style={styles.dashHeaderRight}>
                <Pill>Secured</Pill>
                <Pill>Portable</Pill>
                <Pill>Owned</Pill>
              </div>
            </div>

            {/* 2/3 + 1/3 split — magazine spread. Memory timeline gets
                primary visual weight; identity + scheduling sit secondary. */}
            <div data-dash-split style={styles.dashSplit}>
              <div style={styles.dashColPrimary}>
                <div style={styles.cardLabel}>Memory timeline</div>
                <ol style={styles.timelineEditorial}>
                  {/* Aileen's edited slide 9: timeline copy rewritten to
                      lead with the *idea* of identity travelling forward,
                      not the artefact. Item-by-item changes verified against
                      the May-10 deck. */}
                  {[
                    { num: "01", topic: "Pitch", note: "Identity-first AI for the next generation internet." },
                    { num: "02", topic: "Identity", note: "Persistent AI identity that moves with you." },
                    { num: "03", topic: "Focus session", note: "15 minutes — Anja remembered the context." },
                  ].map((m) => (
                    <li key={m.num} style={styles.timelineItem}>
                      <span style={styles.timelineNum}>{m.num}</span>
                      <div>
                        <div style={styles.timelineTopic}>{m.topic}</div>
                        <div style={styles.timelineNote}>{m.note}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div data-dash-secondary style={styles.dashColSecondary}>
                <div style={styles.dashSecondaryBlock}>
                  <div style={styles.cardLabel}>Next session</div>
                  <div style={styles.dashSecondaryHead}>
                    {bookedSlot ?? "Whenever you're ready"}
                  </div>
                  <p style={styles.faint}>
                    {bookedSlot
                      ? "We'll nudge you 5 minutes before. No spam."
                      : "Anja isn't always-on. Selective by design."}
                  </p>
                </div>

                <div style={styles.dashDivider} />

                <div style={styles.dashSecondaryBlock}>
                  <div style={styles.cardLabel}>Identity anchor</div>
                  <div style={styles.kv}>
                    <span style={styles.faint}>Wallet</span>
                    <span style={styles.mono}>{wallet}</span>
                  </div>
                  <div style={styles.kv}>
                    <span style={styles.faint}>Hash</span>
                    <span style={styles.mono}>{identityHash}</span>
                  </div>
                  <div style={styles.kv}>
                    <span style={styles.faint}>Status</span>
                    <span>
                      <span style={styles.dotGreen} /> Verified
                    </span>
                  </div>
                  <p style={{ ...styles.faint, marginTop: 8 }}>
                    The chain runs underneath. You never had to think about it.
                  </p>
                </div>
              </div>
            </div>

            <div style={styles.dashCtaRow}>
              <button
                onClick={openProof}
                style={styles.ctaSecondary}
                aria-label="View the on-chain identity record"
              >
                View on-chain
              </button>
              <button onClick={handleClose} style={styles.cta}>
                View roadmap
              </button>
            </div>
          </motion.section>
        )}

        {scene === "roadmap" && (
          <RoadmapFrame key="roadmap" onNext={handleRoadmapNext} />
        )}

        {scene === "thesis" && (
          <Frame key="thesis" maxWidth={620} center>
            <motion.h2
              style={styles.thesis}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.0 }}
            >
              AI no longer resets.
            </motion.h2>
          </Frame>
        )}

        {scene === "wordmark" && (
          <Frame key="wordmark" maxWidth={620} center>
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.2 }}
              style={styles.wordmarkWrap}
            >
              <span className="sr-only">COLONII</span>
              {/* Aileen note (May 10 deck): "Just change the background to
                  holographic and colonii white logo" — using the high-res
                  wordmark Aileen dropped in the Drive folder. Natural aspect
                  is 7024×4100 (~1.71); pre-allocating proportional space to
                  prevent CLS while the image decodes. */}
              {/* MED-8: no `priority` — this scene only renders at the end of
                  the demo (~3 min in). Preloading the ~324KB PNG on landing
                  wasted bandwidth for an asset shown to a fraction of users. */}
              <Image
                src="/colonii-wordmark-white.png"
                alt=""
                aria-hidden
                width={480}
                height={280}
                style={styles.wordmarkImg}
              />
            </motion.div>

            {/* "Start again" affordance — fades in 2.4s after the
                wordmark appears so the held final beat lands before
                the action surfaces. A judge who wants to re-run the
                demo (typical evaluation behaviour) gets a single
                obvious affordance instead of having to know to
                refresh the browser. window.location.reload() is the
                cleanest reset — every piece of state (scene, email,
                avatar, identity, memories) starts fresh. */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 2.4, duration: 0.9 }}
              style={styles.startAgainWrap}
            >
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") window.location.reload();
                }}
                style={styles.startAgainBtn}
                aria-label="Restart the COLONII demo from the beginning"
              >
                Start again
              </button>
            </motion.div>
          </Frame>
        )}
        </AnimatePresence>

        {/* Hidden scene jumper for rehearsal — Shift+P toggles */}
        <SceneJumper
          scenes={scenes}
          current={scene}
          setScene={jumpToScene}
          demoUser={demoUser}
          setDemoUser={setDemoUser}
        />

        {/* Demo status pill (audit H8: surface demoLoggedIn) */}
        {demoLoggedIn && scene !== "wordmark" && scene !== "thesis" && (
          <div data-pill-demo style={styles.demoStatusPill} aria-live="polite">
            <span style={styles.demoStatusDot} />{" "}
            {demoUser === "guest" ? "Live · Guest mode" : `Live · seeded as ${demoUser}`}
          </div>
        )}

        {/* Wallet status pill — visible across all flow scenes when
            user opted into wallet path. Hidden on closing scenes. */}
        {connected && publicKey && scene !== "wordmark" && scene !== "thesis" && (
          <div
            data-pill-wallet
            style={styles.walletMiniPill}
            aria-live="polite"
          >
            <span style={styles.walletDot} />
            {adapterWallet?.adapter.name ?? "Wallet"} ·{" "}
            {publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)}
          </div>
        )}

        {/* ── ElevenLabs partner credit (Option C) ─────────────────────
            Persistent bottom-left corner credit, visible across the
            back half of the demo — the scenes where the ElevenLabs
            voice pipeline either is in active use (`live`) or where
            the user is reflecting on the experience that just happened
            (graph, dashboard, roadmap, thesis, wordmark). The
            in-tile "VOICE · [logo]" pill on the live video stays
            (LiveScene.tsx) — it's a moment-of-use attribution inside
            the player; this one is the page-level persistent credit
            matching Aileen's deck treatment.

            Hidden on pre-Anja scenes (auth/consent/securing/secured/
            avatar/cast/memories/availability) — showing it before the
            voice has fired would be premature attribution. */}
        {(scene === "live" ||
          scene === "graph" ||
          scene === "dashboard" ||
          scene === "roadmap" ||
          scene === "thesis" ||
          scene === "wordmark") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/elevenlabs-grants-black.webp"
            alt="Voice powered by ElevenLabs"
            style={styles.elevenLabsCredit}
            data-eleven-credit
          />
        )}

        <ProofDrawer
          open={proofOpen}
          onClose={() => setProofOpen(false)}
          data={proofData}
        />
      </main>
    </>
  );
}

/* ── Components ───────────────────────────────────────────── */

function Frame({
  children,
  maxWidth = 720,
  center = false,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  center?: boolean;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      style={{
        ...styles.frame,
        maxWidth,
        textAlign: center ? "center" : "left",
        alignItems: center ? "center" : "stretch",
      }}
    >
      {children}
    </motion.section>
  );
}

function ChatLayout({
  avatar,
  turns,
  memoryPulse,
  memoryNodes,
  scene,
  typing,
  wallet,
  identityHash,
  onStartFocus,
  onReturnUser,
  instantReply,
}: {
  avatar: string;
  turns: ChatTurn[];
  memoryPulse: boolean;
  memoryNodes: string[];
  scene: Scene;
  typing: boolean;
  wallet: string;
  identityHash: string;
  onStartFocus?: () => void;
  onReturnUser?: () => void;
  instantReply?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns.length, memoryPulse]);

  return (
    <motion.section
      data-colosseum-chat
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: instantReply ? 0.1 : 0.5 }}
      style={styles.chatShell}
    >
      <div style={styles.chatLeft}>
        <header style={styles.chatHeader}>
          <div style={styles.chatHeaderLeft}>
            <AvatarOrb name={avatar} size={36} />
            <div>
              <div style={styles.chatName}>{avatar}</div>
              <div style={styles.chatStatus}>
                <span style={styles.dotGreenLive} />
                {scene === "return" ? "Welcome back" : "Online"}
              </div>
            </div>
          </div>
          <div style={styles.headerPill}>
            <span style={styles.dotGreenLive} />
            <span style={styles.faintSm}>Verified</span>
            <span style={styles.divDot} />
            <span style={styles.mono}>{wallet}</span>
          </div>
        </header>

        <div ref={scrollRef} style={styles.thread}>
          <div style={styles.threadInner}>
            <AnimatePresence initial={false}>
              {turns.map((t, i) => (
                <motion.div
                  key={`${i}-${t.text.slice(0, 8)}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: instantReply ? 0.15 : 0.35 }}
                  style={{
                    ...styles.bubble,
                    alignSelf: t.who === "user" ? "flex-end" : "flex-start",
                    background:
                      t.who === "user" ? "var(--accent-dim)" : "var(--bg-surface)",
                    borderColor:
                      memoryPulse && t.highlight
                        ? "var(--accent)"
                        : "var(--border)",
                    boxShadow:
                      memoryPulse && t.highlight
                        ? "0 0 0 2px var(--accent-glow), 0 8px 32px rgba(201,150,90,0.18)"
                        : "0 1px 0 rgba(0,0,0,0.2)",
                    borderRadius:
                      t.who === "user"
                        ? "14px 14px 4px 14px"
                        : "14px 14px 14px 4px",
                  }}
                >
                  {t.text}
                </motion.div>
              ))}
            </AnimatePresence>

            <AnimatePresence>
              {typing && (
                <motion.div
                  key="typing"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  style={styles.typingBubble}
                >
                  <TypingDots />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {memoryPulse && (
                <motion.div
                  key="mem-toast"
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                  style={styles.memoryToast}
                >
                  <Sparkle />
                  <span>COLONII is remembering this</span>
                </motion.div>
              )}
            </AnimatePresence>

            {scene === "focus" && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                style={styles.sessionPrompt}
              >
                <div style={styles.sessionPromptHead}>
                  <span style={styles.sessionDot} />
                  <strong>Start a Focus Session?</strong>
                </div>
                <p style={styles.faintSm}>
                  15 minutes. Anja keeps the thread, you keep going.
                </p>
                <button onClick={onStartFocus} style={styles.ctaSmall}>
                  Start session
                </button>
              </motion.div>
            )}
          </div>
        </div>

        <div style={styles.composer}>
          <div style={styles.composerInner}>
            <input
              disabled
              placeholder="Type your message…"
              style={styles.composerInput}
            />
            <div style={styles.composerHint}>↵</div>
          </div>
        </div>
      </div>

      <aside style={styles.chatRight}>
        <div style={styles.cardLabel}>Your COLONII</div>
        <div style={styles.statusRow}>
          <Pill>Secured</Pill>
          <Pill>Portable</Pill>
          <Pill>Owned</Pill>
        </div>

        <div style={styles.divider} />

        <div style={styles.cardLabel}>Memory</div>
        <IdentityGraph nodes={memoryNodes} active={scene === "graph"} />

        <div style={styles.divider} />

        <div style={styles.cardLabel}>On-chain anchor</div>
        <div style={styles.kv}>
          <span style={styles.faint}>Wallet</span>
          <span style={styles.mono}>{wallet}</span>
        </div>
        <div style={styles.kv}>
          <span style={styles.faint}>Hash</span>
          <span style={styles.mono}>{identityHash}</span>
        </div>
        <div style={styles.kv}>
          <span style={styles.faint}>Status</span>
          <span>
            <span style={styles.dotGreen} /> Verified
          </span>
        </div>

        {scene === "graph" && (
          <button onClick={onReturnUser} style={{ ...styles.ctaSmall, marginTop: 16 }}>
            Demo: simulate return user
          </button>
        )}
      </aside>
    </motion.section>
  );
}

function IdentityGraph({ nodes, active }: { nodes: string[]; active: boolean }) {
  // Simple SVG: central orb + nodes connected by lines that draw in.
  const center = { x: 100, y: 80 };
  const positions = useMemo(
    () =>
      nodes.map((_, i) => {
        const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const r = 56;
        return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
      }),
    [nodes.length]
  );

  return (
    <svg viewBox="0 0 200 160" style={styles.graphSvg}>
      {positions.map((p, i) => (
        <motion.line
          key={`line-${i}`}
          x1={center.x}
          y1={center.y}
          x2={p.x}
          y2={p.y}
          stroke="var(--accent)"
          strokeOpacity={active ? 0.55 : 0.35}
          strokeWidth={1}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, delay: 0.1 * i }}
        />
      ))}
      <motion.circle
        cx={center.x}
        cy={center.y}
        r={10}
        fill="var(--accent)"
        animate={{ opacity: active ? [0.7, 1, 0.7] : 0.85 }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      {positions.map((p, i) => (
        <g key={`node-${i}`}>
          <motion.circle
            cx={p.x}
            cy={p.y}
            r={5}
            fill="var(--text)"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2 + 0.1 * i }}
          />
          <text
            x={p.x}
            y={p.y - 9}
            textAnchor="middle"
            fontSize={9}
            fill="var(--text-muted)"
          >
            {nodes[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * LogoMark — replaces the generic gradient "pearl" with the actual COLONII
 * mark surrounded by breathing concentric halos. The logo image itself
 * stays steady (pulsating a fixed-shape logo looks cheap); the halos +
 * radial glow do the breathing. Three rings expanding at staggered phases
 * gives the scene atmosphere without becoming a generic loading spinner.
 */
function LogoMark({
  size = 140,
  pulsing = false,
  solid = false,
}: {
  size?: number;
  pulsing?: boolean;
  solid?: boolean;
}) {
  // Three rings at offset phases — visual rhythm is the second-order trick.
  const rings = [0, 0.7, 1.4];
  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Soft radial glow under everything */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: -size * 0.4,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, var(--accent-dim) 0%, rgba(0,0,0,0) 65%)",
          filter: "blur(8px)",
        }}
      />

      {/* Breathing halos. They bloom and fade outward in sequence. */}
      {pulsing &&
        rings.map((delay, i) => (
          <motion.span
            key={i}
            aria-hidden
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: [0.6, 1.6], opacity: [0.55, 0] }}
            transition={{
              duration: 2.6,
              repeat: Infinity,
              delay,
              ease: "easeOut",
            }}
            style={{
              position: "absolute",
              width: size,
              height: size,
              borderRadius: "50%",
              border: "1px solid var(--accent)",
              boxShadow:
                i === 0 ? "0 0 30px var(--accent-dim)" : undefined,
            }}
          />
        ))}

      {/* Static accent ring */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: size * 0.95,
          height: size * 0.95,
          borderRadius: "50%",
          border: "1px solid var(--border-warm)",
          opacity: solid ? 0.9 : 0.5,
        }}
      />

      {/* The mark itself — keep it steady, let the halos breathe. */}
      <motion.img
        src="/colonii-icon-white.png"
        alt=""
        aria-hidden
        animate={
          pulsing
            ? { opacity: [0.85, 1, 0.85] }
            : { opacity: 1 }
        }
        transition={{
          duration: 2.6,
          repeat: pulsing ? Infinity : 0,
          ease: "easeInOut",
        }}
        style={{
          position: "relative",
          width: size * 0.62,
          height: size * 0.62,
          objectFit: "contain",
          filter: solid
            ? "drop-shadow(0 0 24px var(--accent-dim))"
            : "drop-shadow(0 0 16px var(--accent-glow))",
          zIndex: 1,
        }}
      />
    </div>
  );
}

function BackdropOrb({ scene }: { scene: Scene }) {
  // Aurora on hero scenes. Holographic wash on closing wordmark.
  // Chat/live scenes get clean black so video stays crisp.
  const auroraVisible = [
    "landing",
    "consent",
    "securing",
    "secured",
    "avatar",
    "memories",
    "availability",
    "roadmap",
  ].includes(scene);
  const holographicVisible = scene === "wordmark";
  const grainVisible = ["landing", "consent", "securing", "secured", "avatar"].includes(
    scene
  );
  return (
    <>
      {/* Aurora — soft gradient blobs in the new neon-green + iridescent
          register. Animates the background composition every 14s. */}
      <motion.div
        aria-hidden
        animate={{
          opacity: auroraVisible ? 1 : 0,
          background: auroraVisible
            ? [
                "radial-gradient(40% 50% at 25% 60%, rgba(14,242,131,0.14), rgba(0,0,0,0) 70%), radial-gradient(35% 45% at 75% 40%, rgba(140,200,255,0.10), rgba(0,0,0,0) 70%)",
                "radial-gradient(45% 55% at 30% 55%, rgba(14,242,131,0.18), rgba(0,0,0,0) 70%), radial-gradient(35% 45% at 70% 50%, rgba(184,159,204,0.10), rgba(0,0,0,0) 70%)",
                "radial-gradient(40% 50% at 25% 60%, rgba(14,242,131,0.14), rgba(0,0,0,0) 70%), radial-gradient(35% 45% at 75% 40%, rgba(140,200,255,0.10), rgba(0,0,0,0) 70%)",
              ]
            : "radial-gradient(40% 50% at 25% 60%, rgba(14,242,131,0.14), rgba(0,0,0,0) 70%)",
        }}
        transition={{
          opacity: { duration: 0.6, ease: "easeOut" },
          background: { duration: 14, repeat: Infinity, ease: "easeInOut" },
        }}
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          filter: "blur(40px)",
        }}
      />

      {/* Holographic wash for the closing wordmark — slowly rotating
          iridescent gradient. Per the COLOSSEUM mockup's "change
          background to holographic and colonii white logo" note. */}
      {holographicVisible && (
        <motion.div
          aria-hidden
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
          style={{
            position: "fixed",
            inset: "-25%",
            pointerEvents: "none",
            background: "var(--holographic)",
            filter: "blur(60px)",
            opacity: 0.85,
          }}
        />
      )}

      {/* Faint horizon line — magazine-cover architecture trick. */}
      {auroraVisible && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            height: 1,
            background:
              "linear-gradient(90deg, rgba(0,0,0,0) 0%, var(--accent) 50%, rgba(0,0,0,0) 100%)",
            opacity: 0.35,
            pointerEvents: "none",
          }}
        />
      )}

      {grainVisible && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            opacity: 0.06,
            mixBlendMode: "overlay",
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>\")",
          }}
        />
      )}
    </>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span style={styles.pill}>{children}</span>;
}

/* ── Memories scene (real /api/memories with safe fallback) ─ */

const FALLBACK_MEMORIES: Record<string, string[]> = {
  // Guest mode: empty. A first-time visitor meets Ania fresh — there is
  // nothing for her to remember yet. The Memories Carried scene handles
  // the empty case gracefully (renders the heading + body copy + "0 of 0
  // memories active" footer; the user can still click "Continue to Ania"
  // to enter the live experience).
  guest: [],
  sam: [
    "His name is Sam. He is the product strategist.",
    "He loves gaming, especially strategy and RPG games.",
    "He is great at seeing the big picture and connecting dots others miss.",
    "He is curious about behavioral psychology and what motivates people.",
  ],
  aileen: [
    "Her name is Aileen. She is a co-founder of COLONII.",
    "She is the creative director and cares deeply about brand identity and visual storytelling.",
    "She loves design systems, mood boards, and typography.",
    "She gets excited when talking about how technology can feel more human.",
  ],
  luke: [
    "His name is Luke. He is the tech lead at COLONII.",
    "He is passionate about AI and building real-time voice systems.",
    "He produces music in his spare time and loves electronic music.",
    "He values clean architecture and hates over-engineering.",
  ],
  lollie: [
    "Her name is Lollie. She is the community heart of the group.",
    "She has dogs that she absolutely adores and talks about them often.",
  ],
};

/* ── Proof drawer (the "View on-chain" reveal panel) ──────── */

function ProofDrawer({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: { identity: IdentityRecord | null; memories: MemoryRecord[] } | null;
}) {
  // Esc key closes — keyboard parity with the close button.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={styles.proofScrim}
            aria-hidden
          />
          <motion.aside
            initial={{ x: 360 }}
            animate={{ x: 0 }}
            exit={{ x: 360 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            style={styles.proofDrawer}
            role="dialog"
            aria-label="On-chain identity record"
          >
            <header style={styles.proofHeader}>
              <div>
                <div style={styles.brandMark}>On-chain</div>
                <h3 style={styles.proofTitle}>Your COLONII, raw.</h3>
              </div>
              <button
                onClick={onClose}
                style={styles.proofClose}
                aria-label="Close on-chain reveal"
              >
                ✕
              </button>
            </header>

            {!data?.identity && (
              <p style={styles.faintSm}>
                No identity created yet — finish onboarding to populate this view.
              </p>
            )}

            {data?.identity && (
              <>
                <div style={styles.proofSection}>
                  <div style={styles.cardLabel}>DID</div>
                  <code style={styles.proofCode}>{data.identity.did}</code>
                </div>

                <div style={styles.proofGrid}>
                  <ProofKv label="Status" value={data.identity.status} />
                  <ProofKv label="Avatar" value={data.identity.avatar} />
                  <ProofKv
                    label="Memory count"
                    value={String(data.identity.memoryCount)}
                  />
                  <ProofKv
                    label="Credentials"
                    value={String(data.identity.credentialCount)}
                  />
                </div>

                <div style={styles.proofSection}>
                  <div style={styles.cardLabel}>Owner wallet</div>
                  <code style={styles.proofCode}>
                    {data.identity.ownerWallet.toBase58()}
                  </code>
                </div>

                <div style={styles.proofSection}>
                  <div style={styles.cardLabel}>Identity PDA</div>
                  <code style={styles.proofCode}>
                    {data.identity.address.toBase58()}
                  </code>
                </div>

                <div style={styles.proofSection}>
                  <div style={styles.cardLabel}>
                    Anchored memories ({data.memories.length})
                  </div>
                  {data.memories.length === 0 ? (
                    <p style={styles.faintSm}>None yet.</p>
                  ) : (
                    <ul style={styles.proofMemList}>
                      {data.memories.map((m) => (
                        <li key={m.address.toBase58()} style={styles.proofMemItem}>
                          <span style={styles.proofMemSeq}>
                            #{m.sequence}
                          </span>
                          <code style={styles.proofMemHash}>
                            {m.memoryHash}
                          </code>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Aileen 2026-05-11: dropped the "Mock-mode SDK" phrasing.
                    The technical-honesty signal stays — these are the exact
                    identifiers a Solana devnet would produce, derived from
                    real cryptographic primitives — just without the word. */}
                <p style={styles.proofFootnote}>
                  Identity PDA and memory anchors derived from real Ed25519
                  + SHA-256 primitives. The same wallet produces these
                  identifiers on Solana devnet.
                </p>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function ProofKv({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.proofKv}>
      <span style={styles.faintSm}>{label}</span>
      <span style={styles.proofKvValue}>{value}</span>
    </div>
  );
}

function MemoriesFrame({
  avatarName,
  demoUser,
  onContinue,
}: {
  avatarName: string;
  demoUser: string;
  onContinue: () => void;
}) {
  const [memories, setMemories] = useState<SeededMemory[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/memories");
        if (!res.ok) throw new Error("not authed");
        const data = await res.json();
        if (cancelled) return;
        const list: SeededMemory[] = data.memories || [];
        if (list.length === 0) throw new Error("empty");
        setMemories(list);
        setActive(new Set(list.map((m) => m.id)));
      } catch {
        if (cancelled) return;
        const fallback = (FALLBACK_MEMORIES[demoUser] ||
          FALLBACK_MEMORIES.sam).map((fact, i) => ({
          id: `fb-${i}`,
          fact,
          created_at: new Date().toISOString(),
        }));
        setMemories(fallback);
        setActive(new Set(fallback.map((m) => m.id)));
        setUsedFallback(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demoUser]);

  function toggle(id: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.5 }}
      style={{ ...styles.frame, maxWidth: 720, zIndex: 1 }}
    >
      <div style={styles.editorialCredit}>
        <span style={styles.editorialNumeral}>04</span>
        <span style={styles.editorialDots} />
        <span style={styles.editorialLabel}>Memories carried</span>
      </div>
      {/* Aileen's no-trailing-period rule */}
      <h2 style={styles.h2}>Bring what matters into the conversation</h2>
      {/* Empty-state copy for guests / first-time visitors. The seeded
          memories path keeps its original copy so the demo of memory
          management still reads correctly when a presenter flips to a
          named user via Shift+P. */}
      <p style={styles.muted}>
        {!loading && memories.length === 0
          ? `${avatarName} hasn't met you yet — this is where her memory of you will live. As you talk, she'll capture what matters and you'll be able to manage it here.`
          : `These are facts ${avatarName} has carried from past sessions. You're in control — turn off anything you don't want her to bring up today.`}
      </p>

      {loading && (
        <div style={styles.faintSm}>Loading memories…</div>
      )}

      {!loading && memories.length > 0 && (
        <div data-colosseum-grid="memories" style={styles.memoriesGrid}>
          {memories.map((m) => {
            const on = active.has(m.id);
            return (
              <button
                key={m.id}
                onClick={() => toggle(m.id)}
                style={{
                  ...styles.memoryCard,
                  borderColor: on ? "var(--accent)" : "var(--border)",
                  background: on ? "var(--accent-glow)" : "var(--bg-surface)",
                  opacity: on ? 1 : 0.55,
                }}
              >
                <div style={styles.memoryHead}>
                  <span
                    style={{
                      ...styles.memoryToggle,
                      background: on ? "var(--accent)" : "transparent",
                      borderColor: on ? "var(--accent)" : "var(--border)",
                    }}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span style={styles.memoryStatus}>
                    {on ? "Active" : "Muted"}
                  </span>
                </div>
                <div style={styles.memoryFact}>{m.fact}</div>
              </button>
            );
          })}
        </div>
      )}

      <div style={styles.memoryFooter}>
        <div style={styles.faintSm}>
          {active.size} of {memories.length} memories active
          {usedFallback && (
            <span style={{ marginLeft: 8, color: "var(--text-faint)" }}>
              · offline preview
            </span>
          )}
        </div>
        <button onClick={onContinue} style={styles.cta}>
          Continue to {avatarName}
        </button>
      </div>
    </motion.section>
  );
}

/* ── Availability scene (scaling story made visible) ──────── */

function AvailabilityFrame({
  avatarName,
  onTalkNow,
  onBook,
}: {
  avatarName: string;
  onTalkNow: () => void;
  onBook: (slot: string) => void;
}) {
  // Synthesized "live" capacity. Production wires this to real session counts.
  const activeSessions = 6;
  const totalSlots = 8;
  const slotsOpen = totalSlots - activeSessions;

  // Generate next 8 bookable slots (5-min cadence)
  const slots = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 8 }, (_, i) => {
      const t = new Date(now.getTime() + (i + 1) * 5 * 60_000);
      return t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    });
  }, []);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.5 }}
      style={{ ...styles.frame, maxWidth: 720, zIndex: 1 }}
    >
      <div style={styles.editorialCredit}>
        <span style={styles.editorialNumeral}>05</span>
        <span style={styles.editorialDots} />
        <span style={styles.editorialLabel}>{avatarName}'s availability</span>
      </div>
      {/* Sam's reversed call on the May-10 deck note (2026-05-11): instead
          of "Anja is selective with her time" we use the warmer original
          "Anja is looking forward to hanging out with you!" as the
          header. Exclamation, no period — Aileen's no-trailing-period
          rule still applies (exclamation is fine). avatarName is the
          subject so it stays parametrised. */}
      <h2 style={styles.h1}>{avatarName} is looking forward to hanging out with you!</h2>
      <p style={styles.muted}>
        She's in {activeSessions} sessions right now. Like the most interesting
        people in your life — Anja isn't always-on. Take your slot when it
        suits you.
      </p>

      <div style={styles.availabilityRow}>
        <div style={styles.capacityCard}>
          <div style={styles.cardLabel}>Right now</div>
          <div style={styles.capacityBar}>
            {Array.from({ length: totalSlots }, (_, i) => (
              <div
                key={i}
                style={{
                  ...styles.capacitySlot,
                  background:
                    i < activeSessions
                      ? "var(--accent)"
                      : "rgba(245,240,235,0.12)",
                }}
              />
            ))}
          </div>
          <div style={styles.faintSm}>
            {slotsOpen} of {totalSlots} slots open · 5-min sessions
          </div>
        </div>
        <button onClick={onTalkNow} style={styles.cta}>
          Talk to {avatarName} now
        </button>
      </div>

      <div style={styles.divider} />

      <div style={styles.cardLabel}>Or book a slot in the next 40 minutes</div>
      <div data-colosseum-grid="slots" style={styles.slotGrid}>
        {slots.map((s) => (
          <button
            key={s}
            onClick={() => onBook(s)}
            style={styles.slotBtn}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--accent-dim)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "var(--bg-surface)")
            }
          >
            {s}
          </button>
        ))}
      </div>
      <p style={styles.faintSm}>
        Booking is unlimited and free during beta. Anja runs in 24h × multi-region
        slots — that's how we serve thousands of you with one of her.
      </p>
    </motion.section>
  );
}

/* ── Roadmap scene (positioning + scaling story) ──────────── */

/**
 * Rhythm scene — the poetic prose page between roadmap and thesis.
 * Each stanza fades in on its own timing; the page reads like a
 * magazine close-out essay. Per the COLOSSEUM PDF mockup.
 */
// Aileen 2026-05-11: RhythmFrame removed entirely from the demo flow.
// The roadmap scene now transitions directly to the closing thesis,
// saving ~30s of held copy that wasn't earning its airtime.

function RoadmapFrame({ onNext }: { onNext: () => void }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.6 }}
      style={{ ...styles.frame, maxWidth: 980, zIndex: 1 }}
    >
      <div style={styles.editorialCredit}>
        <span style={styles.editorialNumeral}>06</span>
        <span style={styles.editorialDots} />
        <span style={styles.editorialLabel}>What's next</span>
      </div>
      <h2 style={styles.h2}>How COLONII Scales</h2>
      <p style={styles.muted}>
        The identity layer was designed to feel human first. Presence, memory,
        friendship, continuity — carried quietly beneath every interaction.
      </p>

      <div data-colosseum-grid="roadmap" style={styles.roadmapGrid}>
        <div style={styles.roadmapCol}>
          <div style={styles.roadmapTag}>Live today</div>
          <h3 style={styles.roadmapTitle}>Beta cohort</h3>
          <ul style={styles.roadmapList}>
            <li>· Real-time video + voice with Anja</li>
            <li>· Memory recall from prior sessions</li>
            <li>· Identity anchor on Solana</li>
            <li>· 4 AI personas, voice-first config</li>
          </ul>
        </div>
        <div style={styles.roadmapCol}>
          <div style={styles.roadmapTag}>Next 90 days</div>
          <h3 style={styles.roadmapTitle}>900 users without breaking</h3>
          <ul style={styles.roadmapList}>
            <li>· Booking-first scheduling (you saw it)</li>
            <li>· Multi-region replicas — 24h slot coverage</li>
            <li>· Memory graph view + portability</li>
            <li>· Friend introductions through your COLONII</li>
          </ul>
        </div>
        <div style={styles.roadmapCol}>
          <div style={styles.roadmapTag}>Within a year</div>
          <h3 style={styles.roadmapTitle}>Identity that travels</h3>
          <ul style={styles.roadmapList}>
            <li>· Take your COLONII to other AI surfaces</li>
            <li>· Verifiable consent across providers</li>
            <li>· Optional companion marketplace</li>
            <li>· Anja learns the rhythm of your life</li>
          </ul>
        </div>
      </div>

      {/* Aileen 2026-05-11 (19:30 WhatsApp): the scaling-math strip and
          the "What you just saw / Mock mode" disclaimer block both
          removed. The roadmap now reads as: chapter device + heading
          + 3 cohort columns + CTA. The numerical scaling story is
          covered in the voice-over instead. */}

      <button onClick={onNext} style={styles.cta}>
        Continue
      </button>
    </motion.section>
  );
}

/* ── Data ──────────────────────────────────────────────────── */

const AVATARS: {
  name: string;
  color: string;
  hex: string;
  tag: string;
  bio: string;
  // Optional portrait — when present, AvatarOrb renders the photo
  // instead of the gradient initial circle. Falls back to the gradient
  // if the file 404s. All four portraits were delivered by Luke on
  // 2026-05-11 (see /public/personas/). Femi replaced Grace in this
  // delivery, so the warm-archetype slot is now Femi (observant).
  portrait?: string;
}[] = [
  {
    name: "Anja",
    color: "var(--persona-anja)",
    hex: "#E07A5F",
    tag: "grounding",
    bio: "Anchors scattered thoughts. Asks one question that brings the whole picture into focus.",
    portrait: "/personas/anja.jpg",
  },
  {
    name: "Hung",
    color: "var(--persona-hung)",
    hex: "#6E8FB6",
    tag: "incisive",
    bio: "Cuts through the noise. Names what others tiptoe around. Best for hard decisions.",
    portrait: "/personas/hung.jpg",
  },
  {
    name: "Femi",
    color: "var(--persona-grace)",
    hex: "#B89FCC",
    tag: "observant",
    bio: "Notices what slips past everyone else. The right one when you can't quite put your finger on it.",
    portrait: "/personas/femi.jpg",
  },
  {
    name: "Leon",
    color: "var(--persona-leon)",
    hex: "#6FBFA8",
    tag: "playful",
    bio: "Shows up like a good friend before coffee. The right amount of irreverent.",
    portrait: "/personas/leon.jpg",
  },
];

// Pre-compute avatar gradients once per persona — lighten/darken parsed
// hex on every render before this (audit M8).
const AVATAR_GRADIENTS: Record<string, string> = AVATARS.reduce(
  (acc, a) => {
    acc[a.name] = `radial-gradient(circle at 30% 30%, ${lighten(a.hex)}, ${a.hex} 60%, ${darken(a.hex)} 100%)`;
    return acc;
  },
  {} as Record<string, string>
);

function AvatarOrb({ name, size = 36 }: { name: string; size?: number }) {
  const gradient = AVATAR_GRADIENTS[name] ?? AVATAR_GRADIENTS.Anja;
  const persona = AVATARS.find((a) => a.name === name);
  const portrait = persona?.portrait;
  // Portrait load failure (404, malformed image) flips us back to the
  // gradient initial circle so the cast picker never renders a broken
  // image icon — important when a future persona ships before its
  // photo asset is in /public/personas/.
  const [imgFailed, setImgFailed] = useState(false);
  const showPortrait = !!portrait && !imgFailed;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: gradient,
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 24px var(--accent-dim)",
        position: "relative",
        overflow: "hidden",
      }}
      aria-hidden
    >
      {showPortrait ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={portrait}
          alt=""
          onError={() => setImgFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            // Tiny lift in saturation so the photo reads warm against
            // the pure-black backdrop without going neon.
            filter: "saturate(1.05) contrast(1.02)",
          }}
        />
      ) : (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-display)",
            fontSize: size * 0.42,
            color: "rgba(20,17,15,0.65)",
          }}
        >
          {name[0]}
        </span>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--text-muted)",
            display: "inline-block",
          }}
        />
      ))}
    </span>
  );
}

function Sparkle() {
  return (
    <motion.svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      animate={{ rotate: [0, 180, 360], scale: [1, 1.1, 1] }}
      transition={{ duration: 3, repeat: Infinity }}
      style={{ flexShrink: 0 }}
    >
      <path
        d="M12 2 L13.5 9 L20 10 L13.5 11 L12 18 L10.5 11 L4 10 L10.5 9 Z"
        fill="var(--accent)"
      />
    </motion.svg>
  );
}

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 50);
  const g = Math.min(255, ((n >> 8) & 255) + 50);
  const b = Math.min(255, (n & 255) + 50);
  return `rgb(${r}, ${g}, ${b})`;
}
function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 70);
  const g = Math.max(0, ((n >> 8) & 255) - 70);
  const b = Math.max(0, (n & 255) - 70);
  return `rgb(${r}, ${g}, ${b})`;
}

function SceneJumper({
  scenes,
  current,
  setScene,
  demoUser,
  setDemoUser,
}: {
  scenes: Scene[];
  current: Scene;
  setScene: (s: Scene) => void;
  demoUser: string;
  setDemoUser: (u: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key.toLowerCase() === "j") setOpen((v) => !v);
      if (e.shiftKey && e.key.toLowerCase() === "p") setOpen((v) => !v);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function shareUrl() {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams();
    params.set("scene", current);
    if (demoUser) params.set("u", demoUser);
    return `${window.location.origin}${window.location.pathname}?${params}`;
  }

  if (!open) return null;
  return (
    <div style={styles.jumper}>
      <div style={{ ...styles.faint, marginBottom: 6 }}>
        Shift+P · presenter panel
      </div>
      <div style={{ marginBottom: 6 }}>
        <label
          htmlFor="presenter-demo-user"
          style={{ ...styles.faintSm, fontSize: 10, marginBottom: 2, display: "block" }}
        >
          Demo user (seeded memories)
        </label>
        <select
          id="presenter-demo-user"
          aria-label="Demo user with seeded memories"
          value={demoUser}
          onChange={(e) => setDemoUser(e.target.value)}
          style={styles.jumperSelect}
        >
          {/* Guest is the default for public hackathon visitors —
              fresh Phase-1 meeting with Ania, no seeded memories.
              The 4 named users below stay for internal/presenter
              demos where the personalized "Ania remembers me"
              moment is the goal. */}
          <option value="guest">guest (no memories, fresh meeting)</option>
          <option value="sam">sam (product strategist)</option>
          <option value="aileen">aileen (creative director)</option>
          <option value="luke">luke (tech lead)</option>
          <option value="lollie">lollie (community)</option>
        </select>
      </div>
      <div style={{ ...styles.faintSm, fontSize: 10, marginTop: 6, marginBottom: 2 }}>
        Jump to scene
      </div>
      {scenes.map((s) => (
        <button
          key={s}
          onClick={() => setScene(s)}
          style={{
            ...styles.jumperBtn,
            background: s === current ? "var(--accent-dim)" : "transparent",
          }}
        >
          {s}
        </button>
      ))}
      <button
        onClick={() => navigator.clipboard?.writeText(shareUrl())}
        style={{ ...styles.jumperBtn, marginTop: 6 }}
        title="Copy a link that deep-links to this scene"
        aria-label="Copy a share link to the current scene"
      >
        Copy share-link
      </button>
    </div>
  );
}

/* ── Styles (inline; Colonii warm-dark palette from globals.css) ──── */

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 24px",
    background: "var(--bg)",
    color: "var(--text)",
    position: "relative",
    overflow: "hidden",
  },
  frame: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 18,
    position: "relative",
    zIndex: 1,
  },
  brandMark: {
    fontFamily: "var(--font-display)",
    fontSize: 14,
    letterSpacing: 6,
    color: "var(--accent)",
    marginBottom: 4,
  },
  // Chapter device — Aileen's edited slides (3, 7, 9, 11, 17, 22, 29)
  // show the section indicator as a *fully green* line: numeral, dashed
  // bar, and label all tinted to the neon accent (#0EF283). Previously
  // the dashes and label were muted-grey which made the divider read as
  // utility. The all-green treatment turns it into a piece of design
  // signage that anchors every chapter.
  editorialCredit: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
    paddingBottom: 14,
    borderBottom: "1px solid var(--border)",
  },
  editorialNumeral: {
    fontFamily: "var(--font-display)",
    fontSize: 14,
    color: "var(--accent)",
    letterSpacing: 1,
    fontVariantNumeric: "tabular-nums",
  },
  editorialDots: {
    flex: 1,
    height: 1,
    // True dashed-line bar (was a dotted radial-gradient before) — matches
    // the long-dash treatment in the deck.
    backgroundImage:
      "linear-gradient(to right, var(--accent) 0, var(--accent) 6px, transparent 6px, transparent 10px)",
    backgroundSize: "10px 1px",
    backgroundRepeat: "repeat-x",
    backgroundPosition: "left center",
    opacity: 0.75,
  },
  editorialLabel: {
    fontFamily: "var(--font-display)",
    fontSize: 13,
    color: "var(--accent)",
    letterSpacing: 2,
    textTransform: "uppercase" as const,
  },
  brandLogoWrap: {
    display: "flex",
    margin: "0 0 18px",
    padding: 0,
  },
  brandLogoImg: {
    height: 40,
    width: "auto",
    objectFit: "contain" as const,
    filter: "drop-shadow(0 0 24px rgba(224,122,95,0.18))",
  },
  heroLine: {
    fontFamily: "var(--font-display)",
    fontSize: 44,
    lineHeight: 1.05,
    fontWeight: 400,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  h1: {
    fontFamily: "var(--font-display)",
    fontSize: 48,
    lineHeight: 1.1,
    fontWeight: 400,
  },
  h2: {
    fontFamily: "var(--font-display)",
    fontSize: 32,
    fontWeight: 400,
  },
  thesis: {
    fontFamily: "var(--font-display)",
    fontSize: 56,
    fontWeight: 400,
    textAlign: "center" as const,
    color: "var(--accent)",
    letterSpacing: -0.5,
  },
  wordmark: {
    fontFamily: "var(--font-display)",
    fontSize: 80,
    letterSpacing: 4,
    color: "var(--text)",
    textAlign: "center" as const,
  },
  wordmarkWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  wordmarkImg: {
    width: "min(480px, 82vw)",
    height: "auto",
    objectFit: "contain" as const,
    // Soft neon-green halo behind the white mark — sits inside the
    // holographic wash so the logo still pops without competing with it.
    filter: "drop-shadow(0 0 60px rgba(14,242,131,0.35))",
  },

  // "Start again" affordance on the closing wordmark scene. Sits
  // visually quiet so the held final beat (logo + holographic wash)
  // stays the dominant signal; the button is the second-layer
  // affordance that surfaces after the closing image has landed.
  startAgainWrap: {
    display: "flex",
    justifyContent: "center",
    marginTop: 28,
  },
  startAgainBtn: {
    background: "transparent",
    color: "var(--text)",
    fontFamily: "var(--font-display)",
    fontSize: 13,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 999,
    padding: "10px 22px",
    cursor: "pointer",
    backdropFilter: "blur(6px)",
    transition: "border-color 200ms ease, color 200ms ease, transform 160ms ease",
  },

  // Rhythm scene — poetic close-out
  rhythmBody: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    margin: "12px 0 20px",
  },
  rhythmStanza: {
    fontFamily: "var(--font-display)",
    fontSize: 20,
    lineHeight: 1.5,
    color: "var(--text)",
  },
  muted: { color: "var(--text-muted)", fontSize: 16, lineHeight: 1.5 },
  faint: { color: "var(--text-faint)", fontSize: 13 },
  input: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    padding: "14px 16px",
    borderRadius: 8,
    fontSize: 16,
    outline: "none",
  },
  cta: {
    background: "var(--accent)",
    color: "var(--on-accent)",
    border: "none",
    padding: "14px 18px",
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    transition: "transform 120ms ease",
  },
  ctaSmall: {
    background: "var(--accent)",
    color: "var(--on-accent)",
    border: "none",
    padding: "10px 14px",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "var(--text)",
    fontSize: 15,
    cursor: "pointer",
  },
  statusText: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    marginTop: 24,
  },
  verifiedPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    border: "1px solid var(--border-warm)",
    borderRadius: 999,
    color: "var(--text)",
    fontSize: 13,
    background: "var(--accent-glow)",
  },
  dotGreen: {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--success)",
    marginRight: 6,
    verticalAlign: "middle",
  },
  avatarGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 12,
  },
  avatarTile: {
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 16,
    cursor: "pointer",
    color: "var(--text)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    transition: "background 200ms ease, border-color 200ms ease",
  },
  avatarBubble: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    boxShadow: "0 0 30px rgba(201,150,90,0.2)",
  },
  avatarBubbleSmall: {
    width: 32,
    height: 32,
    borderRadius: "50%",
  },
  avatarName: {
    fontFamily: "var(--font-display)",
    fontSize: 18,
  },
  chatShell: {
    width: "100%",
    maxWidth: 1120,
    height: "min(740px, 90vh)",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 312px",
    gap: 16,
    position: "relative",
    zIndex: 1,
  },
  chatLeft: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 24px 60px -20px rgba(0,0,0,0.5)",
  },
  chatHeader: {
    padding: "14px 18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottom: "1px solid var(--border)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0) 100%)",
  },
  chatHeaderLeft: { display: "flex", alignItems: "center", gap: 12 },
  chatName: {
    fontFamily: "var(--font-display)",
    fontSize: 18,
    lineHeight: 1.1,
  },
  chatStatus: {
    color: "var(--text-muted)",
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  headerPill: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    border: "1px solid var(--border)",
    borderRadius: 999,
    background: "var(--bg)",
    fontSize: 12,
  },
  divDot: {
    display: "inline-block",
    width: 3,
    height: 3,
    borderRadius: "50%",
    background: "var(--text-faint)",
  },
  dotGreenLive: {
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--success)",
    boxShadow: "0 0 8px var(--success-glow)",
  },
  thread: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 16px",
  },
  threadInner: {
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
    transition: "border-color 300ms ease, box-shadow 300ms ease",
  },
  typingBubble: {
    alignSelf: "flex-start",
    padding: "10px 14px",
    border: "1px solid var(--border)",
    borderRadius: "14px 14px 14px 4px",
    background: "var(--bg-surface)",
  },
  memoryToast: {
    alignSelf: "center",
    color: "var(--accent)",
    fontSize: 13,
    letterSpacing: 0.4,
    padding: "7px 14px",
    border: "1px solid var(--border-warm)",
    borderRadius: 999,
    background:
      "linear-gradient(180deg, rgba(201,150,90,0.14), rgba(201,150,90,0.06))",
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  sessionPrompt: {
    alignSelf: "center",
    width: "min(420px, 100%)",
    border: "1px solid var(--border-warm)",
    background:
      "linear-gradient(180deg, rgba(201,150,90,0.10), rgba(201,150,90,0.03))",
    borderRadius: 14,
    padding: "16px 18px",
    textAlign: "left",
    marginTop: 8,
  },
  sessionPromptHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  sessionDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--accent)",
    boxShadow: "0 0 12px var(--accent)",
  },
  composer: {
    padding: 14,
    borderTop: "1px solid var(--border)",
  },
  composerInner: {
    position: "relative",
    width: "100%",
    maxWidth: 600,
    margin: "0 auto",
  },
  composerInput: {
    width: "100%",
    background: "var(--bg)",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "12px 44px 12px 14px",
    fontSize: 14,
    outline: "none",
  },
  composerHint: {
    position: "absolute",
    right: 12,
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: 11,
    color: "var(--text-faint)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "2px 6px",
  },
  chatRight: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    overflowY: "auto",
    boxShadow: "0 24px 60px -20px rgba(0,0,0,0.5)",
  },
  faintSm: { color: "var(--text-muted)", fontSize: 12 },
  cardLabel: {
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "var(--text-muted)",
  },
  statusRow: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 },
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
  graphSvg: { width: "100%", height: 160 },
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
  card: {
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    borderRadius: 12,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  dashGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  timeline: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    color: "var(--text)",
    fontSize: 14,
  },
  jumper: {
    position: "fixed",
    bottom: 16,
    right: 16,
    background: "rgba(28,25,22,0.92)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    zIndex: 100,
    backdropFilter: "blur(8px)",
  },
  jumperBtn: {
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "8px 12px",
    minHeight: 32,
    fontSize: 12,
    textAlign: "left",
    cursor: "pointer",
  },
  jumperSelect: {
    width: "100%",
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "8px 8px",
    minHeight: 32,
    fontSize: 12,
    outline: "none",
  },

  // ── Memories scene ────────────────────────────────────────
  memoriesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 10,
    margin: "12px 0",
  },
  memoryCard: {
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 14,
    cursor: "pointer",
    color: "var(--text)",
    textAlign: "left",
    transition: "all 200ms ease",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  memoryHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  memoryToggle: {
    width: 18,
    height: 18,
    borderRadius: 4,
    border: "1px solid var(--border)",
    color: "var(--on-accent)",
    fontSize: 12,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 200ms ease, border-color 200ms ease",
  },
  memoryStatus: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "var(--text-muted)",
  },
  memoryFact: {
    fontSize: 14,
    lineHeight: 1.45,
    color: "var(--text)",
  },
  memoryFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 6,
  },

  // ── Availability scene ────────────────────────────────────
  availabilityRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 16,
    alignItems: "center",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: 18,
    background: "var(--bg-surface)",
  },
  capacityCard: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  capacityBar: {
    display: "flex",
    gap: 6,
  },
  capacitySlot: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    transition: "background 200ms ease",
  },
  slotGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 8,
  },
  slotBtn: {
    background: "var(--bg-surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "14px 0",
    minHeight: 44,
    fontSize: 14,
    cursor: "pointer",
    transition: "background 150ms ease",
  },

  // ── Roadmap scene ─────────────────────────────────────────
  roadmapGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 16,
    margin: "16px 0",
  },
  roadmapCol: {
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: 18,
    background: "var(--bg-surface)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  roadmapTag: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "var(--accent)",
  },
  roadmapTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    lineHeight: 1.2,
  },
  roadmapList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    color: "var(--text-muted)",
    fontSize: 14,
    lineHeight: 1.5,
  },
  // Flattened scaling strip (audit H6: replaces nested card)
  scalingStrip: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    padding: "16px 18px",
    margin: "8px 0 16px",
    borderTop: "1px solid var(--border-warm)",
    borderBottom: "1px solid var(--border-warm)",
    background: "var(--accent-glow)",
    fontSize: 13,
    lineHeight: 1.5,
  },
  scalingLabel: {
    fontFamily: "var(--font-display)",
    fontSize: 14,
    color: "var(--accent)",
    marginRight: 8,
    letterSpacing: 0.4,
  },
  scalingItem: {
    color: "var(--text)",
  },
  scalingDot: {
    width: 4,
    height: 4,
    borderRadius: "50%",
    background: "var(--text-faint)",
    flexShrink: 0,
  },

  // ── Avatar scene: 'meet the cast' editorial spread (audit H2) ───
  castShell: {
    width: "100%",
    maxWidth: 1080,
    display: "flex",
    flexDirection: "column",
    gap: 22,
    position: "relative",
    zIndex: 1,
  },
  castSplit: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr)",
    gap: 48,
    alignItems: "start",
  },
  castList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  castItem: {
    display: "block",
  },
  castEntry: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "auto auto 1fr",
    alignItems: "center",
    gap: 14,
    padding: "14px 14px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background 200ms ease, border-color 200ms ease, opacity 200ms ease",
    minHeight: 44,
  },
  castEntryNum: {
    fontFamily: "var(--font-display)",
    fontSize: 13,
    color: "var(--accent)",
    fontVariantNumeric: "tabular-nums",
  },
  castEntryText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  castEntryName: {
    fontFamily: "var(--font-display)",
    fontSize: 18,
    color: "var(--text)",
    lineHeight: 1.1,
  },
  castEntryTag: {
    color: "var(--text-muted)",
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
  },
  castFeature: {
    paddingLeft: 32,
    borderLeft: "1px solid var(--border)",
    minHeight: 360,
    display: "flex",
    alignItems: "center",
  },
  castFeatureInner: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 10,
  },
  castFeatureName: {
    fontFamily: "var(--font-display)",
    fontSize: 64,
    lineHeight: 0.95,
    color: "var(--text)",
    marginTop: 14,
    letterSpacing: -1,
  },
  castFeatureTag: {
    color: "var(--accent)",
    fontSize: 12,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
    marginBottom: 8,
  },
  castFeatureBio: {
    fontFamily: "var(--font-display)",
    fontStyle: "italic" as const,
    fontSize: 22,
    lineHeight: 1.4,
    color: "var(--text)",
    maxWidth: 460,
  },
  castEmpty: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingTop: 40,
  },
  castEmptyTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 36,
    lineHeight: 1.1,
    fontWeight: 400,
    color: "var(--text)",
  },

  // ── Dashboard: editorial 2/3 + 1/3 spread (audit H2) ──────
  dashShell: {
    width: "100%",
    maxWidth: 1080,
    display: "flex",
    flexDirection: "column",
    gap: 22,
    position: "relative",
    zIndex: 1,
  },
  // HIGH-2: editorialCredit inside dashHeader now carries its own
  // borderBottom divider — removing borderBottom + paddingBottom here
  // prevents the double horizontal rule on slide 9.
  dashHeader: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 24,
    alignItems: "end",
  },
  dashHeadline: {
    fontFamily: "var(--font-display)",
    fontSize: 36,
    lineHeight: 1.1,
    fontWeight: 400,
    color: "var(--text)",
    marginTop: 8,
  },
  // Aileen's slide 9: a calm body-font subline sits directly under the
  // three-beat headline. Keeps the page breathing instead of jamming the
  // chain explanation into the title.
  dashSubline: {
    fontFamily: "var(--font-body)",
    fontSize: 15,
    lineHeight: 1.55,
    color: "var(--text-muted)",
    marginTop: 8,
    maxWidth: 440,
  },
  dashHeaderRight: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  dashSplit: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
    gap: 32,
    alignItems: "start",
  },
  dashColPrimary: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  dashColSecondary: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    paddingLeft: 24,
    borderLeft: "1px solid var(--border)",
  },
  dashSecondaryBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  dashSecondaryHead: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    color: "var(--text)",
    marginTop: 2,
  },
  dashDivider: {
    height: 1,
    background: "var(--border)",
    margin: "8px 0",
  },
  timelineEditorial: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  timelineItem: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: 18,
    alignItems: "start",
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
  },
  timelineNum: {
    fontFamily: "var(--font-display)",
    fontSize: 28,
    color: "var(--accent)",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
    paddingTop: 2,
  },
  timelineTopic: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    color: "var(--text)",
    lineHeight: 1.2,
  },
  timelineNote: {
    color: "var(--text-muted)",
    fontSize: 14,
    marginTop: 4,
    lineHeight: 1.5,
  },

  // ── Mock-mode disclaimer (in roadmap scene) ───────────────
  disclaimerBlock: {
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: "18px 20px",
    margin: "8px 0 16px",
    background: "var(--bg-surface)",
  },
  disclaimerHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  disclaimerTag: {
    fontFamily: "var(--font-display)",
    fontSize: 16,
    color: "var(--text)",
  },
  disclaimerStatus: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    letterSpacing: 0.6,
    color: "var(--text-muted)",
    padding: "4px 10px",
    border: "1px solid var(--border-warm)",
    borderRadius: 999,
    background: "var(--accent-glow)",
    textTransform: "uppercase" as const,
  },
  disclaimerStatusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--accent)",
    boxShadow: "0 0 6px var(--accent)",
  },
  disclaimerBody: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  disclaimerLead: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text)",
  },
  disclaimerList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-muted)",
  },
  disclaimerKey: {
    fontFamily: "var(--font-display)",
    color: "var(--text)",
    marginRight: 4,
  },
  disclaimerCode: {
    // Inline typeset (audit M8) — was boxed monospace, read too Slack-y.
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    fontSize: 12,
    color: "var(--accent)",
    padding: "0 2px",
    letterSpacing: 0.2,
  },

  // ElevenLabs partner credit (Option C). Persistent corner mark
  // on the back-half scenes of the demo. The asset Aileen shipped is
  // black-on-transparent (the "Grants" mark); we invert it via CSS so
  // it renders white on the pure-black page background.
  // Height 16px keeps it readable at viewing distance but quiet
  // enough not to compete with the chapter headings or buttons.
  elevenLabsCredit: {
    position: "fixed",
    left: 20,
    bottom: 20,
    height: 16,
    width: "auto",
    pointerEvents: "none" as const,
    userSelect: "none" as const,
    filter: "invert(1) brightness(1.05)",
    opacity: 0.75,
    zIndex: 30,
  },

  // Status pill: "Live · seeded as sam" (audit H8)
  demoStatusPill: {
    position: "fixed",
    top: 16,
    right: 16,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    background: "rgba(28,25,22,0.92)",
    border: "1px solid var(--border)",
    borderRadius: 999,
    fontSize: 12,
    color: "var(--text-muted)",
    backdropFilter: "blur(6px)",
    zIndex: 50,
  },
  demoStatusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--success)",
    boxShadow: "0 0 6px var(--success-glow)",
  },

  // ── Wallet adapter UI ─────────────────────────────────────
  walletChoiceRow: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: "8px 0 12px",
  },
  walletConnectButton: {
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border-warm)",
    borderRadius: 8,
    padding: "11px 16px",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    minHeight: 44,
    alignSelf: "flex-start",
    transition: "background 200ms ease, border-color 200ms ease",
  },
  walletConnectedPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: "var(--accent-glow)",
    color: "var(--text)",
    border: "1px solid var(--border-warm)",
    borderRadius: 999,
    padding: "8px 14px",
    fontSize: 13,
    cursor: "pointer",
    minHeight: 36,
    alignSelf: "flex-start",
  },
  walletDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--accent)",
    boxShadow: "0 0 8px var(--accent)",
  },
  walletPillX: {
    color: "var(--text-faint)",
    marginLeft: 4,
    fontSize: 11,
  },
  walletChoiceFaint: {
    color: "var(--text-faint)",
    fontSize: 12,
  },
  walletMiniPill: {
    position: "fixed",
    top: 16,
    left: 16,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    background: "rgba(13,20,38,0.92)",
    border: "1px solid var(--border-warm)",
    borderRadius: 999,
    fontSize: 12,
    color: "var(--text-muted)",
    backdropFilter: "blur(6px)",
    zIndex: 50,
  },

  // ── Dashboard CTA row + secondary button ──────────────────
  dashCtaRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  ctaSecondary: {
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border-warm)",
    padding: "13px 18px",
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 500,
    cursor: "pointer",
    minHeight: 44,
  },

  // ── Proof drawer ──────────────────────────────────────────
  proofScrim: {
    position: "fixed",
    inset: 0,
    background: "var(--scrim, rgba(0,0,0,0.5))",
    zIndex: 200,
    backdropFilter: "blur(2px)",
  },
  proofDrawer: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width: "min(420px, 92vw)",
    background: "var(--bg-surface)",
    borderLeft: "1px solid var(--border-warm)",
    zIndex: 201,
    padding: "24px 22px",
    overflowY: "auto",
    boxShadow: "-24px 0 60px -20px rgba(0,0,0,0.6)",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  proofHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  proofTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 24,
    lineHeight: 1.15,
    fontWeight: 400,
    marginTop: 4,
  },
  proofClose: {
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border)",
    width: 32,
    height: 32,
    borderRadius: 8,
    fontSize: 14,
    cursor: "pointer",
    flexShrink: 0,
  },
  proofSection: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  proofCode: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--accent)",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 10px",
    wordBreak: "break-all",
  },
  proofGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
  },
  proofKv: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
  },
  proofKvValue: {
    fontFamily: "var(--font-display)",
    fontSize: 16,
    color: "var(--text)",
    textTransform: "capitalize",
  },
  proofMemList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    maxHeight: 220,
    overflowY: "auto",
  },
  proofMemItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg)",
  },
  proofMemSeq: {
    fontFamily: "var(--font-display)",
    fontSize: 13,
    color: "var(--accent)",
    minWidth: 28,
  },
  proofMemHash: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    fontSize: 11,
    color: "var(--text-muted)",
    wordBreak: "break-all",
  },
  proofFootnote: {
    color: "var(--text-faint)",
    fontSize: 12,
    lineHeight: 1.5,
    marginTop: "auto",
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
  },
};
