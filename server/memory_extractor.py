"""Extract memorable facts from conversations and save to Supabase."""

import json
import os
import urllib.request
import urllib.error
from loguru import logger

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

EXTRACTION_PROMPT = """You are analyzing a voice conversation transcript between Anja (an AI companion) and a user.

Extract 1-5 NEW facts about the user that are worth remembering for future conversations. Focus on:
- Their name (if mentioned and different from what's already known)
- Personal interests, hobbies, or passions they mentioned
- Their job, role, or what they're working on
- Emotional states or things they care about
- Preferences or opinions they shared
- Life events or plans they mentioned

Rules:
- Only extract facts about the USER, not about Anja
- Skip generic/obvious facts (e.g., "they said hello")
- Skip facts that are already in the existing memories list
- Each fact should be a single clear sentence
- If no new notable facts were shared, return an empty array

Respond with ONLY a JSON array of strings. Examples:
["They are learning to play guitar", "They work at a startup in Berlin"]
[]
"""


def extract_and_save_memories(
    messages: list[dict],
    user_context: dict,
) -> None:
    """Extract facts from conversation and save to Supabase.

    Called after the user disconnects. Runs synchronously since the
    pipeline is already shutting down.
    """
    user_id = user_context.get("userId")
    if not user_id:
        logger.debug("No userId in context — skipping memory extraction")
        return

    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.warning("Supabase env vars not set — skipping memory extraction")
        return

    if not GROQ_API_KEY:
        logger.warning("GROQ_API_KEY not set — skipping memory extraction")
        return

    # Build transcript from messages (skip system prompt and hidden triggers)
    transcript_lines = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "system":
            continue
        # Skip hidden trigger messages (they start with "[")
        if role == "user" and content.startswith("[") and content.endswith("]"):
            continue
        speaker = "User" if role == "user" else "Anja"
        transcript_lines.append(f"{speaker}: {content}")

    if len(transcript_lines) < 2:
        logger.debug("Conversation too short for memory extraction")
        return

    transcript = "\n".join(transcript_lines)

    # Include existing memories so the LLM doesn't extract duplicates
    existing = user_context.get("memories", [])
    existing_block = ""
    if existing:
        existing_block = "\n\nExisting memories (do NOT repeat these):\n" + "\n".join(
            f"- {m}" for m in existing
        )

    display_name = user_context.get("displayName", "the user")

    # Call Groq API to extract facts
    try:
        facts = _call_groq_extraction(transcript, display_name, existing_block)
    except Exception as e:
        logger.error(f"Memory extraction LLM call failed: {e}")
        return

    if not facts:
        logger.info(f"No new memories to save for {display_name}")
        return

    # Save each fact to Supabase
    saved = 0
    for fact in facts[:5]:  # Cap at 5
        if not isinstance(fact, str) or len(fact.strip()) < 5:
            continue
        try:
            _save_memory(user_id, fact.strip())
            saved += 1
        except Exception as e:
            logger.error(f"Failed to save memory: {e}")

    logger.info(f"Saved {saved} new memories for {display_name}")


def _call_groq_extraction(
    transcript: str, display_name: str, existing_block: str
) -> list[str]:
    """Call Groq API to extract facts from the conversation."""
    user_msg = (
        f"The user's name is {display_name}.{existing_block}\n\n"
        f"Conversation transcript:\n{transcript}"
    )

    payload = json.dumps({
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": EXTRACTION_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.3,
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

    # Parse JSON array from response (handle markdown code blocks)
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    return json.loads(content)


def _save_memory(user_id: str, fact: str) -> None:
    """Save a single memory fact to Supabase via REST API."""
    payload = json.dumps({
        "user_id": user_id,
        "fact": fact,
        "source": "conversation",
    }).encode()

    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/demo_memories",
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
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        raise RuntimeError(f"Supabase POST failed ({e.code}): {body}") from e
