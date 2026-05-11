"""
COLONII Real-Time Voice Avatar — Pipecat Pipeline Server

Orchestrates: Silero VAD -> Deepgram STT -> LLM -> ElevenLabs TTS -> Tavus Avatar
Transport: Daily.co WebRTC (audio + video)
"""

import argparse
import asyncio
import json
import os
import sys
import time

import aiohttp
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMMessagesFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.services.deepgram.stt import DeepgramSTTService, DeepgramSTTSettings
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.transports.daily.transport import DailyTransport, DailyParams

from prompts import ANJA_SYSTEM_PROMPT, ANJA_GREETING_TRIGGER, build_personalized_prompt, build_returning_user_greeting
from memory_extractor import extract_and_save_memories
from session_analytics import analyze_and_save_session
from tools import register_tools

logger.remove(0)
logger.add(sys.stderr, level="DEBUG")


def check_required_env(mode: str = "video"):
    required = {
        "DEEPGRAM_API_KEY": "Deepgram STT",
        "ELEVENLABS_API_KEY": "ElevenLabs TTS",
        "ELEVENLABS_VOICE_ID": "ElevenLabs voice",
    }
    if mode == "video":
        required["TAVUS_API_KEY"] = "Tavus avatar API key"
        required["TAVUS_REPLICA_ID"] = "Tavus replica ID"
    missing = [f"{k} ({v})" for k, v in required.items() if not os.getenv(k)]
    if missing:
        logger.error(f"Missing required env vars: {', '.join(missing)}")
        sys.exit(1)


def get_llm_service(model_name: str = "gemini"):
    if model_name == "gemini":
        from pipecat.services.google.llm import GoogleLLMService
        return GoogleLLMService(api_key=os.getenv("GOOGLE_API_KEY"), model="gemini-2.5-flash")
    elif model_name == "groq":
        from pipecat.services.groq.llm import GroqLLMService
        return GroqLLMService(api_key=os.getenv("GROQ_API_KEY"), model="llama-3.3-70b-versatile")
    elif model_name == "openai":
        from pipecat.services.openai.llm import OpenAILLMService
        return OpenAILLMService(api_key=os.getenv("OPENAI_API_KEY"), model="gpt-4o-mini")
    elif model_name in ("haiku", "sonnet"):
        from pipecat.services.openai.llm import OpenAILLMService
        model_id = "anthropic/claude-haiku-4-5-20251001" if model_name == "haiku" else "anthropic/claude-sonnet-4-6"
        return OpenAILLMService(api_key=os.getenv("OPENROUTER_API_KEY"), model=model_id, base_url="https://openrouter.ai/api/v1")
    else:
        raise ValueError(f"Unknown model: {model_name}")


async def run_bot(room_url: str, token: str, model: str = "gemini", user_context: dict | None = None, mode: str = "video"):
    session_started_at = time.time()
    logger.info(f"Pipeline mode: {mode}, model: {model}")

    async with aiohttp.ClientSession() as aio_session:
        transport = DailyTransport(
            room_url, token, "Anja",
            params=DailyParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                audio_out_sample_rate=16000,
                video_out_enabled=(mode == "video"),
                video_out_is_live=(mode == "video"),
                video_out_width=1280 if mode == "video" else 0,
                video_out_height=720 if mode == "video" else 0,
                vad_enabled=True,
                vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.3, min_volume=0.5)),
            ),
        )

        stt = DeepgramSTTService(
            api_key=os.getenv("DEEPGRAM_API_KEY"),
            settings=DeepgramSTTSettings(
                model="nova-3-general", language="en",
                smart_format=True, punctuate=True, interim_results=True, endpointing=200,
            ),
        )

        llm = get_llm_service(model)

        tts = ElevenLabsTTSService(
            api_key=os.getenv("ELEVENLABS_API_KEY"),
            voice_id=os.getenv("ELEVENLABS_VOICE_ID"),
            model="eleven_flash_v2_5",
            output_format="pcm_16000",
        )

        avatar = None
        if mode == "video":
            from pipecat.services.tavus.video import TavusVideoService
            avatar = TavusVideoService(
                api_key=os.getenv("TAVUS_API_KEY"),
                replica_id=os.getenv("TAVUS_REPLICA_ID"),
                persona_id=os.getenv("TAVUS_PERSONA_ID", "pipecat-stream"),
                session=aio_session,
            )
            logger.info(f"Tavus avatar: replica={os.getenv('TAVUS_REPLICA_ID')}")

        if user_context:
            system_prompt = build_personalized_prompt(user_context)
            greeting_trigger = build_returning_user_greeting(user_context)
            logger.info(f"Personalized session for: {user_context.get('displayName', 'unknown')}")
        else:
            system_prompt = ANJA_SYSTEM_PROMPT
            greeting_trigger = ANJA_GREETING_TRIGGER

        messages = [{"role": "system", "content": system_prompt}]
        context = OpenAILLMContext(messages)
        context_aggregator = llm.create_context_aggregator(context)

        user_id = user_context.get("userId") if user_context else None
        register_tools(llm, context, user_id=user_id)

        pipeline_stages = [transport.input(), stt, context_aggregator.user(), llm, tts]
        if avatar:
            pipeline_stages.append(avatar)
        pipeline_stages.extend([transport.output(), context_aggregator.assistant()])

        pipeline = Pipeline(pipeline_stages)
        task = PipelineTask(pipeline, params=PipelineParams(
            allow_interruptions=True, enable_metrics=True, enable_usage_metrics=True,
            audio_in_sample_rate=16000, audio_out_sample_rate=16000,
        ))

        @transport.event_handler("on_first_participant_joined")
        async def on_first_participant_joined(transport, participant):
            participant_name = participant.get("info", {}).get("userName", "")
            logger.info(f"First participant joined: {participant['id']} ({participant_name})")
            messages.append({"role": "user", "content": greeting_trigger})
            await task.queue_frames([LLMMessagesFrame(messages)])

        @transport.event_handler("on_participant_joined")
        async def on_participant_joined(transport, participant):
            """Unsubscribe from Tavus replica mic to prevent STT feedback loop."""
            if not avatar:
                return
            if participant.get("info", {}).get("isLocal", False):
                return
            participant_name = participant.get("info", {}).get("userName", "")
            # Real users keep subscribed — only unsub the Tavus replica
            if participant_name == "Anja":
                return
            if not participant_name or "replica" in participant_name.lower() or "tavus" in participant_name.lower():
                try:
                    await transport.update_subscriptions(
                        participant_settings={
                            participant["id"]: {"media": {"microphone": "unsubscribed"}}
                        }
                    )
                    logger.info(f"Unsubscribed from participant {participant['id']} mic (Tavus replica)")
                except Exception as e:
                    logger.warning(f"Failed to unsubscribe from participant mic: {e}")

        @transport.event_handler("on_participant_left")
        async def on_participant_left(transport, participant, reason):
            participant_name = participant.get("info", {}).get("userName", "")
            logger.info(f"Participant left: {participant['id']} ({participant_name}), reason: {reason}")
            if participant.get("info", {}).get("isLocal", False):
                return
            loop = asyncio.get_event_loop()
            if user_context and user_context.get("userId"):
                try:
                    await loop.run_in_executor(None, extract_and_save_memories, messages, user_context)
                except Exception as e:
                    logger.error(f"Memory extraction failed: {e}")
            try:
                session_meta = {
                    "user_id": user_context.get("userId") if user_context else None,
                    "display_name": user_context.get("displayName", "Guest") if user_context else "Guest",
                    "model": model, "started_at": session_started_at, "ended_at": time.time(),
                    "is_guest": not (user_context and user_context.get("userId")),
                }
                await loop.run_in_executor(None, analyze_and_save_session, messages, session_meta)
            except Exception as e:
                logger.error(f"Session analytics failed: {e}")
            await task.cancel()

        @transport.event_handler("on_call_state_updated")
        async def on_call_state_updated(transport, state):
            logger.info(f"Call state: {state}")
            if state == "left":
                await task.cancel()

        runner = PipelineRunner()
        await runner.run(task)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="COLONII Anja Voice Bot")
    parser.add_argument("-m", "--model", type=str, default="gemini", choices=["gemini", "groq", "openai", "haiku", "sonnet"])
    parser.add_argument("--mode", type=str, default="video", choices=["video", "voice"])
    parser.add_argument("-c", "--context", type=str, default=None)
    args = parser.parse_args()

    room_url = os.getenv("DAILY_ROOM_URL")
    room_token = os.getenv("DAILY_TOKEN")
    if not room_url or not room_token:
        logger.error("DAILY_ROOM_URL and DAILY_TOKEN environment variables required")
        sys.exit(1)

    check_required_env(mode=args.mode)

    user_ctx = None
    if args.context:
        try:
            with open(args.context) as f:
                user_ctx = json.load(f)
            os.unlink(args.context)
        except Exception as e:
            logger.warning(f"Failed to load user context: {e}")

    asyncio.run(run_bot(room_url, room_token, args.model, user_ctx, mode=args.mode))
