"use client";

import { useEffect, useRef, useState } from "react";

interface AvatarViewProps {
  roomUrl: string | null;
  token: string | null;
  connecting?: boolean;
  onStateChange: (state: "idle" | "listening" | "thinking" | "speaking") => void;
  onError?: (message: string) => void;
  /**
   * Called when the user clicks the "Type instead" escape hatch from
   * the connecting overlay. Surfaced after 10s of unconnected state,
   * because the most common live-demo failure mode is the Pipecat
   * bot-server being unreachable — the iframe stays connected, but
   * Anja never appears. Without this, the user is trapped on the
   * "Connecting to Anja…" overlay with no way to fall through to the
   * working text chat tier.
   */
  onUserRequestChat?: () => void;
}

const CONNECTING_LINES = [
  "Warming up the pixels...",
  "Teaching neurons to lip-sync...",
  "Calibrating the vibe...",
  "Loading personality: 94%...",
  "Synchronising the soul...",
  "Preparing to be charming...",
  "Making sure the hair looks good...",
  "Running final charisma checks...",
  "Almost there, just finishing the mascara...",
  "Asking the mirror for a confidence boost...",
  "Stretching the vocal cords...",
  "Thinking of something interesting to say...",
  "Manifesting good conversation energy...",
  "Googling 'how to seem effortlessly cool'...",
  "Buffering brilliance...",
];

/**
 * AvatarView — displays Anja's MuseTalk-rendered face via Daily.co WebRTC.
 *
 * Architecture (server-side MuseTalk):
 * - Pipecat bot runs MuseTalkVideoService in the pipeline (after TTS)
 * - MuseTalkVideoService sends TTS audio to MuseTalk API, receives avatar video frames
 * - DailyTransport sends both audio + video to this browser client via WebRTC
 * - This component just joins the Daily room and renders the video track
 */
export default function AvatarView({ roomUrl, token, connecting, onStateChange, onError, onUserRequestChat }: AvatarViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dailyRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  // H1: Safari autoplay — track whether user needs a tap to unmute
  const [showUnmute, setShowUnmute] = useState(false);
  const userInteractedRef = useRef(false);
  const unmuteDismissedRef = useRef(false);
  // Show the "Type instead" escape after 10s of unconnected state.
  // Demo flow: judge sees connecting overlay for a beat (charming), but
  // if Anja still isn't speaking after 10s we surface a clearly-visible
  // way out so the demo never deadlocks.
  const [showChatEscape, setShowChatEscape] = useState(false);

  // Mirror callbacks in refs so the connect effect doesn't depend on
  // their identities. Without this, every parent re-render (memory
  // pulses, callState updates, secondsAgo ticks) tore down the Daily
  // call and rebuilt it mid-session — the real cause of "video drops
  // back to chat" reports.
  const onStateChangeRef = useRef(onStateChange);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
    onErrorRef.current = onError;
  });

  // Both audio and video tracks must arrive before hiding the connecting overlay
  const connected = audioReady && videoReady;

  // Cycle connecting lines every 3 seconds while not yet connected
  useEffect(() => {
    if (connected) return;
    const interval = setInterval(() => {
      setLineIndex((i) => (i + 1) % CONNECTING_LINES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [connected]);

  // Fallback: if video is ready but audio hasn't arrived within 8s, show avatar anyway
  useEffect(() => {
    if (!videoReady || audioReady) return;
    const t = setTimeout(() => setAudioReady(true), 8000);
    return () => clearTimeout(t);
  }, [videoReady, audioReady]);

  // Surface the "Type instead" escape after 10s of unconnected state.
  // Only reveal it if a chat callback is wired — otherwise it'd be a
  // dead button.
  useEffect(() => {
    if (connected || !onUserRequestChat) {
      setShowChatEscape(false);
      return;
    }
    const t = setTimeout(() => setShowChatEscape(true), 10_000);
    return () => clearTimeout(t);
  }, [connected, onUserRequestChat]);

  // H1: track user interaction for Safari autoplay detection
  useEffect(() => {
    const mark = () => { userInteractedRef.current = true; };
    window.addEventListener("click", mark, { once: true, passive: true });
    window.addEventListener("touchstart", mark, { once: true, passive: true });
    return () => {
      window.removeEventListener("click", mark);
      window.removeEventListener("touchstart", mark);
    };
  }, []);

  useEffect(() => {
    if (!roomUrl) return;

    let cleanup = false;

    const connect = async () => {
      const DailyIframe = (await import("@daily-co/daily-js")).default;

      // Defensive: Daily.co only allows one call object per page. React 18
      // StrictMode double-invokes effects on dev/cold boots, and a previous
      // unmount may not have fully released the singleton before this mount
      // fires. Probe for an existing instance and tear it down first.
      // (See `Failed to connect: Duplicate DailyIframe instances` in console.)
      const existing = (DailyIframe as any).getCallInstance?.();
      if (existing) {
        try {
          await existing.leave();
        } catch {
          /* ignore — leave is best-effort */
        }
        try {
          await existing.destroy();
        } catch {
          /* ignore — destroy may be a no-op if already torn down */
        }
      }
      if (cleanup) return; // unmounted while we awaited the teardown

      const daily = DailyIframe.createCallObject();
      dailyRef.current = daily;

      // Handle bot's video and audio tracks
      daily.on("track-started", (event: any) => {
        if (cleanup) return;
        const { track, participant } = event;

        // Only process tracks from remote participants (the Pipecat bot)
        if (participant?.local) return;

        if (track.kind === "video" && videoRef.current) {
          const stream = new MediaStream([track]);
          videoRef.current.srcObject = stream;
          setVideoReady(true);
          onStateChangeRef.current("idle");
        }

        if (track.kind === "audio") {
          // Clean up previous audio element if it exists
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.srcObject = null;
          }
          const audio = new Audio();
          audioRef.current = audio;
          audio.srcObject = new MediaStream([track]);
          audio.autoplay = true;
          audio.play().catch((e) => {
            console.warn("Audio autoplay blocked:", e);
            // H1: Safari blocked autoplay — show unmute affordance after 4s
            // if the user still hasn't interacted and hasn't dismissed it.
            if (!unmuteDismissedRef.current) {
              setTimeout(() => {
                if (!cleanup && audioRef.current &&
                    (audioRef.current.muted || audioRef.current.paused) &&
                    !unmuteDismissedRef.current) {
                  setShowUnmute(true);
                }
              }, 4000);
            }
          });
          setAudioReady(true);
        }
      });

      daily.on("track-stopped", (event: any) => {
        if (!event.participant?.local && event.track?.kind === "audio") {
          onStateChangeRef.current("idle");
        }
      });

      // Activity signal for the parent's silence-shutdown timer. Fires every
      // time someone starts/stops talking, so a chatty call keeps resetting
      // the clock; a truly silent room does not.
      daily.on("active-speaker-change", (event: any) => {
        const activeId = event?.activeSpeaker?.peerId;
        if (!activeId) {
          onStateChangeRef.current("idle");
          return;
        }
        const local = daily.participants()?.local;
        onStateChangeRef.current(
          activeId === local?.session_id ? "listening" : "speaking"
        );
      });

      // Join the Daily room with mic on, camera off.
      // userName is required for Tavus to register the browser as a present
      // participant — without it, Tavus treats the session as empty and
      // kills it via participant_absent_timeout after ~60s.
      const joinOpts: any = {
        url: roomUrl,
        startVideoOff: true,
        startAudioOff: false,
        userName: "user",
      };
      // Tavus rooms don't need a token; our own Daily rooms do
      if (token) {
        joinOpts.token = token;
      }

      // Pre-flight mic permission so Tavus sees an actual audio track on
      // join, not just a ghost participant.
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (e) {
        console.warn("Microphone permission not granted:", e);
      }

      await daily.join(joinOpts);

      if (!cleanup) {
        onStateChangeRef.current("idle");
      }
    };

    connect().catch((err) => {
      console.error("Failed to connect:", err);
      const message =
        err instanceof Error ? err.message : "Daily connect failed";
      if (onErrorRef.current) onErrorRef.current(message);
    });

    return () => {
      cleanup = true;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
      }
      dailyRef.current?.leave();
      dailyRef.current?.destroy();
    };
    // Only roomUrl + token can legitimately change mid-session.
    // onStateChange/onError are intentionally excluded — see the
    // ref-mirror at the top of the component.
  }, [roomUrl, token]);

  // H1: handler to resume audio on user tap
  function handleUnmute() {
    unmuteDismissedRef.current = true;
    setShowUnmute(false);
    if (audioRef.current) {
      audioRef.current.muted = false;
      audioRef.current.play().catch(() => {});
    }
  }

  const showContainer = roomUrl || connecting;

  return (
    <div className="avatar-container" style={{ background: showContainer ? "#000" : "transparent", pointerEvents: showContainer ? "auto" : "none" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="avatar-video"
      />

      {!connected && (roomUrl || connecting) && (
        <div className="connecting-overlay">
          {/* Idle avatar silhouette while bot connects */}
          <div className="idle-avatar">
            <div className="idle-glow" />
            <div className="idle-silhouette" />
            <div className="idle-ring idle-ring-1" />
            <div className="idle-ring idle-ring-2" />
            <div className="idle-ring idle-ring-3" />
          </div>
          <span className="connecting-text">Connecting to Anja...</span>
          <span className="connecting-line" key={lineIndex}>
            {CONNECTING_LINES[lineIndex]}
          </span>
          {showChatEscape && onUserRequestChat && (
            <button
              type="button"
              onClick={onUserRequestChat}
              className="chat-escape"
              aria-label="Skip video and chat with Anja in text instead"
            >
              Anja taking too long? <span className="chat-escape-cta">Type with her instead →</span>
            </button>
          )}
        </div>
      )}

      {/* H1: Safari autoplay unmute affordance — small pill, bottom-right,
          dismissable. Only shown when audio.play() was blocked and the
          user hasn't tapped yet. Chrome skips this because autoplay works. */}
      {showUnmute && (
        <button
          onClick={handleUnmute}
          className="unmute-pill"
          aria-label="Tap to unmute avatar audio"
        >
          Tap to unmute
        </button>
      )}

      <style jsx>{`
        .avatar-container {
          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .avatar-video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .connecting-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 24px;
          background: radial-gradient(ellipse at center, #0a0a0a 0%, #000 70%);
          color: #aaa;
          font-size: 14px;
        }
        .idle-avatar {
          position: relative;
          width: 200px;
          height: 200px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        /* HIGH-1: rethemed from purple to neon green (var(--accent) / #0ef283) */
        .idle-glow {
          position: absolute;
          width: 160px;
          height: 160px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(14, 242, 131, 0.25) 0%, rgba(14, 242, 131, 0) 70%);
          animation: idle-breathe 3s ease-in-out infinite;
        }
        .idle-silhouette {
          position: relative;
          width: 100px;
          height: 100px;
          border-radius: 50%;
          background: linear-gradient(135deg, #0a0a0a 0%, #111111 50%, #0a0a0a 100%);
          border: 2px solid rgba(14, 242, 131, 0.25);
          box-shadow: 0 0 40px rgba(14, 242, 131, 0.1), inset 0 0 30px rgba(14, 242, 131, 0.04);
          animation: idle-breathe 3s ease-in-out infinite;
        }
        .idle-ring {
          position: absolute;
          border-radius: 50%;
          border: 1px solid rgba(14, 242, 131, 0.12);
        }
        .idle-ring-1 {
          width: 130px;
          height: 130px;
          animation: idle-ring-pulse 3s ease-in-out infinite;
        }
        .idle-ring-2 {
          width: 160px;
          height: 160px;
          animation: idle-ring-pulse 3s ease-in-out 0.5s infinite;
        }
        .idle-ring-3 {
          width: 190px;
          height: 190px;
          animation: idle-ring-pulse 3s ease-in-out 1s infinite;
        }
        .connecting-text {
          font-size: 13px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--text-muted, #555);
          animation: text-fade 2s ease-in-out infinite;
        }
        .connecting-line {
          font-size: 13px;
          letter-spacing: 0.02em;
          color: rgba(14, 242, 131, 0.5);
          font-style: italic;
          animation: line-fadein 0.5s ease forwards;
          text-align: center;
          max-width: 280px;
        }
        /* H1: unmute pill — non-intrusive, bottom-right, green accent */
        .unmute-pill {
          position: absolute;
          bottom: 16px;
          right: 16px;
          background: rgba(0, 0, 0, 0.75);
          color: rgba(14, 242, 131, 0.9);
          border: 1px solid rgba(14, 242, 131, 0.4);
          border-radius: 999px;
          padding: 6px 14px;
          font-size: 12px;
          letter-spacing: 0.04em;
          cursor: pointer;
          backdrop-filter: blur(6px);
          transition: background 0.2s, border-color 0.2s;
          z-index: 10;
        }
        .unmute-pill:hover {
          background: rgba(14, 242, 131, 0.12);
          border-color: rgba(14, 242, 131, 0.7);
        }
        /* Escape hatch that fades in after 10s of unconnected state.
           Visible enough to read at presenter distance but quiet enough
           to not yell at the user when video does eventually arrive. */
        .chat-escape {
          margin-top: 8px;
          background: transparent;
          color: rgba(220, 220, 220, 0.7);
          border: 1px solid rgba(14, 242, 131, 0.4);
          border-radius: 999px;
          padding: 8px 18px;
          font-size: 13px;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s, color 0.2s;
          animation: chat-escape-in 0.6s ease forwards;
        }
        .chat-escape:hover {
          background: rgba(14, 242, 131, 0.08);
          border-color: rgba(14, 242, 131, 0.8);
          color: rgba(255, 255, 255, 0.95);
        }
        .chat-escape-cta {
          color: rgba(14, 242, 131, 0.95);
          font-weight: 500;
          margin-left: 6px;
        }
        @keyframes chat-escape-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes line-fadein {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes idle-breathe {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        @keyframes idle-ring-pulse {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.08); opacity: 0.6; }
        }
        @keyframes text-fade {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
