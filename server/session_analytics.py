"""Extract session analytics and sentiment from conversations."""

import json
import os
import urllib.request
import urllib.error
from loguru import logger

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

ANALYTICS_PROMPT = """You are analyzing a voice conversation between Anja (an AI companion) and a user.

Provide a brief analysis in JSON format with these fields:

1. "sentiment_score": integer 1-5 where:
   1 = Very negative (frustrated, angry, disappointed)
   2 = Somewhat negative (confused, bored, skeptical)
   3 = Neutral (polite but not engaged)
   4 = Positive (interested, friendly, enjoying it)
   5 = Very positive (excited, delighted, deeply engaged)

2. "sentiment_label": one of "very_negative", "negative", "neutral", "positive", "very_positive"

3. "engagement_level": one of "low", "medium", "high"
   - low: short answers, disengaged, trying to end conversation
   - medium: participating but not deeply invested
   - high: asking follow-ups, sharing personal info, extended exchanges

4. "topics": array of 1-5 topic tags discussed (e.g. ["music", "work", "relationships"])

5. "conversation_summary": 1-2 sentence anonymous summary of what was discussed (no names or identifying info)

6. "user_reaction": 1 sentence describing how the user seemed to feel about talking to Anja specifically

Respond with ONLY valid JSON, no markdown code blocks."""


def analyze_and_save_session(
    messages: list[dict],
    session_meta: dict,
) -> None:
    """Analyze conversation sentiment/engagement and save session record.

    session_meta should contain:
      - user_id (str or None for guests)
      - display_name (str)
      - model (str)
      - started_at (float, unix timestamp)
      - ended_at (float, unix timestamp)
      - is_guest (bool)
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.warning("Supabase env vars not set — skipping session analytics")
        return

    if not GROQ_API_KEY:
        logger.warning("GROQ_API_KEY not set — skipping session analytics")
        return

    # Build transcript (skip system and hidden triggers)
    transcript_lines = []
    user_turn_count = 0
    assistant_turn_count = 0
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "system":
            continue
        if role == "user" and content.startswith("[") and content.endswith("]"):
            continue
        speaker = "User" if role == "user" else "Anja"
        transcript_lines.append(f"{speaker}: {content}")
        if role == "user":
            user_turn_count += 1
        elif role == "assistant":
            assistant_turn_count += 1

    total_turns = user_turn_count + assistant_turn_count

    if total_turns < 2:
        logger.debug("Conversation too short for analytics")
        # Still save a minimal session record
        _save_session_record(session_meta, total_turns, user_turn_count, None)
        return

    # Limit transcript to last 200 lines to avoid exceeding LLM context window
    transcript = "\n".join(transcript_lines[-200:])

    # Call LLM for sentiment analysis
    try:
        analysis = _call_groq_analysis(transcript)
    except Exception as e:
        logger.error(f"Session analytics LLM call failed: {e}")
        _save_session_record(session_meta, total_turns, user_turn_count, None)
        return

    _save_session_record(session_meta, total_turns, user_turn_count, analysis)


def _call_groq_analysis(transcript: str) -> dict:
    """Call Groq API to analyze conversation sentiment."""
    payload = json.dumps({
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": ANALYTICS_PROMPT},
            {"role": "user", "content": f"Conversation transcript:\n{transcript}"},
        ],
        "temperature": 0.2,
        "max_tokens": 500,
    }).encode()

    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GROQ_API_KEY}",
        },
    )

    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())

    content = data["choices"][0]["message"]["content"].strip()

    # Handle markdown code blocks
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    return json.loads(content)


def _save_session_record(
    meta: dict,
    total_turns: int,
    user_turns: int,
    analysis: dict | None,
) -> None:
    """Save session record to Supabase."""
    started_at = meta.get("started_at")
    ended_at = meta.get("ended_at")
    duration = int(ended_at - started_at) if started_at and ended_at else None

    record: dict = {
        "model": meta.get("model", "unknown"),
        "is_guest": meta.get("is_guest", True),
        "total_turns": total_turns,
        "user_turns": user_turns,
        "duration_seconds": duration,
    }

    # Add user_id if not guest
    user_id = meta.get("user_id")
    if user_id:
        record["user_id"] = user_id

    # Add LLM analysis if available
    if analysis:
        record["sentiment_score"] = analysis.get("sentiment_score")
        record["sentiment_label"] = analysis.get("sentiment_label")
        record["engagement_level"] = analysis.get("engagement_level")
        record["topics"] = analysis.get("topics", [])
        record["conversation_summary"] = analysis.get("conversation_summary")
        record["user_reaction"] = analysis.get("user_reaction")

    payload = json.dumps(record).encode()

    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/demo_sessions",
        data=payload,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
        display = meta.get("display_name", "unknown")
        logger.info(
            f"Session analytics saved for {display}: "
            f"{total_turns} turns, {duration}s, "
            f"sentiment={analysis.get('sentiment_score') if analysis else 'n/a'}"
        )
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        logger.error(f"Failed to save session analytics ({e.code}): {body}")
