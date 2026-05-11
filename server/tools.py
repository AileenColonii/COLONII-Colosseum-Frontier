"""Anja's tool-calling capabilities — voice-driven settings and session awareness."""

import asyncio
import json
import os
import re
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from loguru import logger

UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# --- OpenAI-format tool definitions (Pipecat uses this format) ---

ANJA_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "update_notification_schedule",
            "description": "Update when Anja checks in with the user. Call this when the user asks to change notification frequency, days, or time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]},
                        "description": "Days of the week to send check-ins",
                    },
                    "time": {
                        "type": "string",
                        "description": "Time of day for check-ins in HH:MM format (24h), e.g. '10:00' or '18:30'",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_quiet_mode",
            "description": "Mute all notifications for a period. Call this when the user wants silence, space, or to pause check-ins.",
            "parameters": {
                "type": "object",
                "properties": {
                    "hours": {
                        "type": "integer",
                        "description": "Number of hours to stay quiet. Use 24 for a day, 168 for a week.",
                    },
                },
                "required": ["hours"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_notification_channels",
            "description": "Change how notifications feel — vibration, visual, or sound. Call this when the user mentions sensory preferences or overwhelm.",
            "parameters": {
                "type": "object",
                "properties": {
                    "haptic": {
                        "type": "boolean",
                        "description": "Enable vibration/haptic feedback",
                    },
                    "visual": {
                        "type": "boolean",
                        "description": "Enable visual banners",
                    },
                    "sound": {
                        "type": "boolean",
                        "description": "Enable notification sounds",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_session_time_limit",
            "description": "Set how long conversations should last before Anja suggests wrapping up. Call this when the user wants shorter or longer sessions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "minutes": {
                        "type": "integer",
                        "description": "Maximum session length in minutes before Anja suggests ending. Minimum 5, maximum 60.",
                    },
                },
                "required": ["minutes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_offline_activity",
            "description": "Suggest an offline activity to the user. Call this when the conversation has been going a while, when the user seems restless, or when there's a natural moment to encourage them to step away from the screen.",
            "parameters": {
                "type": "object",
                "properties": {
                    "activity": {
                        "type": "string",
                        "description": "A specific, personalized activity suggestion based on what you know about the user",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Why this activity would be good for them right now",
                    },
                },
                "required": ["activity"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "end_session_gracefully",
            "description": "Gracefully end the conversation. Call this ONLY after verbally suggesting wrapping up AND the user agrees or the session time limit is reached. Never call this abruptly.",
            "parameters": {
                "type": "object",
                "properties": {
                    "farewell_note": {
                        "type": "string",
                        "description": "A brief warm note to save as context for next time",
                    },
                },
                "required": [],
            },
        },
    },
]


# --- Tool handler functions ---

def _validate_user_id(uid: str) -> str:
    """Validate user_id is a proper UUID."""
    if not uid or not UUID_RE.match(uid):
        raise ValueError(f"Invalid user_id format: {uid}")
    return uid


def _supabase_upsert_preferences(user_id: str, updates: dict) -> bool:
    """Atomic upsert of user preferences in Supabase."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.warning("Supabase not configured — preference update skipped")
        return False

    try:
        user_id = _validate_user_id(user_id)
    except ValueError as e:
        logger.error(f"Invalid user_id: {e}")
        return False

    updates["user_id"] = user_id
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    payload = json.dumps(updates).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/user_preferences",
        data=payload,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal,resolution=merge-duplicates",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        logger.error(f"Preference upsert failed ({e.code}): {body}")
        return False


async def _run_sync(fn, *args):
    """Run a synchronous function in an executor to avoid blocking the event loop."""
    return await asyncio.get_event_loop().run_in_executor(None, fn, *args)


async def handle_update_notification_schedule(params):
    """Handle notification schedule changes."""
    args = params.arguments
    user_id = args.get("_user_id")

    updates = {}
    if "days" in args:
        updates["notification_days"] = args["days"]
    if "time" in args:
        updates["notification_time"] = args["time"]

    if user_id and updates:
        success = await _run_sync(_supabase_upsert_preferences, user_id, updates)
        if success:
            days_str = ", ".join(d.capitalize() for d in args.get("days", []))
            time_str = args.get("time", "")
            result = f"Updated: check-ins on {days_str}" + (f" at {time_str}" if time_str else "")
            logger.info(f"Notification schedule updated for {user_id}: {result}")
            await params.result_callback({"status": "ok", "message": result})
            return

    await params.result_callback({"status": "ok", "message": "Preferences noted"})


async def handle_set_quiet_mode(params):
    """Handle quiet mode activation."""
    args = params.arguments
    user_id = args.get("_user_id")
    hours = args.get("hours", 24)

    if user_id:
        from datetime import timedelta
        quiet_until = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
        success = await _run_sync(_supabase_upsert_preferences, user_id, {"quiet_until": quiet_until})
        if success:
            if hours <= 24:
                duration = f"{hours} hours"
            elif hours <= 168:
                duration = f"{hours // 24} days"
            else:
                duration = f"{hours // 168} weeks"
            logger.info(f"Quiet mode set for {user_id}: {duration}")
            await params.result_callback({"status": "ok", "duration": duration})
            return

    await params.result_callback({"status": "ok", "duration": f"{hours} hours"})


async def handle_set_notification_channels(params):
    """Handle notification channel preferences."""
    args = params.arguments
    user_id = args.get("_user_id")

    updates = {}
    if "haptic" in args:
        updates["haptic_enabled"] = args["haptic"]
    if "visual" in args:
        updates["visual_enabled"] = args["visual"]
    if "sound" in args:
        updates["sound_enabled"] = args["sound"]

    if user_id and updates:
        await _run_sync(_supabase_upsert_preferences, user_id, updates)
        channels = []
        if args.get("haptic", True):
            channels.append("vibration")
        if args.get("visual", True):
            channels.append("visual")
        if args.get("sound", True):
            channels.append("sound")
        logger.info(f"Notification channels updated for {user_id}: {channels}")

    await params.result_callback({"status": "ok"})


async def handle_set_session_time_limit(params):
    """Handle session time limit changes."""
    args = params.arguments
    user_id = args.get("_user_id")
    minutes = max(5, min(60, args.get("minutes", 20)))

    if user_id:
        await _run_sync(_supabase_upsert_preferences, user_id, {"session_time_limit_minutes": minutes})
        logger.info(f"Session time limit set to {minutes}min for {user_id}")

    await params.result_callback({"status": "ok", "minutes": minutes})


async def handle_suggest_offline_activity(params):
    """Handle offline activity suggestion — just logs it, Anja speaks the suggestion herself."""
    args = params.arguments
    activity = args.get("activity", "")
    reason = args.get("reason", "")
    logger.info(f"Offline activity suggested: {activity} — {reason}")
    await params.result_callback({"status": "ok", "activity": activity})


async def handle_end_session_gracefully(params):
    """Handle graceful session ending."""
    args = params.arguments
    farewell = args.get("farewell_note", "")
    user_id = args.get("_user_id")

    # Save the farewell note as a memory for next time
    if user_id and farewell and SUPABASE_URL and SUPABASE_KEY:
        payload = json.dumps({
            "user_id": user_id,
            "fact": f"Last session ended with: {farewell}",
            "source": "session_end",
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
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp.read()
        except Exception as e:
            logger.error(f"Failed to save farewell note: {e}")

    logger.info(f"Session ending gracefully: {farewell}")
    await params.result_callback({"status": "ok", "farewell": farewell})


# --- Registration helper ---

TOOL_HANDLERS = {
    "update_notification_schedule": handle_update_notification_schedule,
    "set_quiet_mode": handle_set_quiet_mode,
    "set_notification_channels": handle_set_notification_channels,
    "set_session_time_limit": handle_set_session_time_limit,
    "suggest_offline_activity": handle_suggest_offline_activity,
    "end_session_gracefully": handle_end_session_gracefully,
}


def register_tools(llm, context, user_id: str | None = None):
    """Register all Anja tools with the LLM service.

    Wraps each handler to inject _user_id into arguments so tools
    can persist preferences without the LLM knowing the user ID.
    """
    context.set_tools(ANJA_TOOLS)

    for name, handler in TOOL_HANDLERS.items():
        if user_id:
            # Wrap handler to inject user_id
            async def wrapped_handler(params, _handler=handler, _uid=user_id):
                params.arguments["_user_id"] = _uid
                await _handler(params)
            llm.register_function(name, wrapped_handler)
        else:
            llm.register_function(name, handler)

    logger.info(f"Registered {len(TOOL_HANDLERS)} tools (user_id={'set' if user_id else 'guest'})")
