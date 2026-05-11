"""
MuseTalk Video Service — RunPod Serverless FrameProcessor for Pipecat

Replaces SimliVideoService in the Colonii pipeline. Takes TTS audio frames
from ElevenLabs, sends them to a RunPod serverless endpoint running MuseTalk,
and outputs video frames for Daily.co WebRTC transport.

Pipeline position:
    transport.input() → STT → LLM → TTS → [MuseTalkVideoService] → transport.output()

Audio input:  PCM 16kHz mono int16 (AudioRawFrame from ElevenLabs TTS)
Video output: RGB frames at target fps (OutputImageRawFrame for Daily.co WebRTC)

Idle video: On startup, sends 1 second of silence to RunPod to pre-generate
Anja's resting-face frames. These are looped during idle state so the avatar
always shows real MuseTalk video, never a static image. The warmup call also
wakes the RunPod worker so the first speech response is fast.
"""

import asyncio
import base64
import io
import time
from typing import Optional

import aiohttp
from PIL import Image
from loguru import logger

from pipecat.frames.frames import (
    AudioRawFrame,
    CancelFrame,
    EndFrame,
    Frame,
    StartFrame,
    OutputImageRawFrame,
)
from pipecat.processors.frame_processor import FrameProcessor


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# At 16 kHz mono int16, one second of audio = 32000 bytes.
_BYTES_PER_SECOND_16K = 16000 * 2  # 16-bit = 2 bytes per sample

# Default audio chunk duration sent per RunPod request (seconds).
_DEFAULT_CHUNK_SECS = 0.64

# RunPod polling interval when using async /run endpoint (seconds).
_POLL_INTERVAL = 0.05

# Maximum time to wait for a RunPod response before falling back (seconds).
_RUNPOD_COLD_START_TIMEOUT = 90.0  # First request: model loading + preprocessing
_RUNPOD_WARM_TIMEOUT = 10.0        # Subsequent requests

# Idle frame rate — keeps the video stream alive when avatar is silent.
_IDLE_FPS = 25

# Duration of silence audio sent to RunPod to pre-generate idle frames.
_IDLE_WARMUP_SECS = 1.0

# Blank fallback frame color (dark grey, less jarring than pure black).
_BLANK_COLOR = (20, 20, 30)


class MuseTalkVideoService(FrameProcessor):
    """Pipecat FrameProcessor that converts TTS audio into talking-head video
    via a RunPod serverless MuseTalk endpoint.

    On startup, sends silence audio to RunPod to pre-generate Anja's resting-face
    frames for the idle loop. This also warms the RunPod worker so the first
    speech response is fast.

    Constructor args:
        runpod_endpoint_id: RunPod serverless endpoint ID.
        runpod_api_key:     RunPod API key (Bearer token).
        fps:                Target video framerate (default 25).
        frame_size:         Output frame dimensions as (width, height) tuple.
        chunk_duration:     Audio chunk length in seconds per RunPod call.
    """

    def __init__(
        self,
        *,
        runpod_endpoint_id: str,
        runpod_api_key: str,
        fps: int = 25,
        frame_size: tuple = (512, 512),
        chunk_duration: float = _DEFAULT_CHUNK_SECS,
    ):
        super().__init__()

        self._endpoint_id = runpod_endpoint_id
        self._api_key = runpod_api_key
        self._fps = fps
        self._frame_size = frame_size
        self._chunk_bytes = int(chunk_duration * _BYTES_PER_SECOND_16K)

        # --- Runtime state (initialized in _start) ---
        self._audio_buffer = bytearray()
        self._session: Optional[aiohttp.ClientSession] = None
        self._idle_task: Optional[asyncio.Task] = None
        self._warmup_task: Optional[asyncio.Task] = None
        self._processing = False  # True while a RunPod call is in flight
        self._flushing = False    # Guard against concurrent flush calls
        self._running = False
        self._first_request = True  # Use cold-start timeout for the first RunPod call

        # Idle video loop — populated by _warmup_idle_frames() from RunPod silence
        self._idle_frames: list[bytes] = []   # decoded RGB bytes per frame
        self._idle_frame_idx: int = 0

        logger.info(
            f"MuseTalkVideoService initialized — endpoint={runpod_endpoint_id}, "
            f"fps={fps}, frame_size={frame_size}, chunk={chunk_duration:.2f}s"
        )

    # ------------------------------------------------------------------
    # Lifecycle helpers
    # ------------------------------------------------------------------

    async def _start(self):
        """Open aiohttp session, emit blank idle frames immediately, then
        launch background warmup to generate real MuseTalk idle frames."""
        self._audio_buffer.clear()
        self._processing = False
        self._running = True
        self._idle_frames = []
        self._idle_frame_idx = 0

        # Blank fallback so the idle loop has something to push immediately
        blank = Image.new("RGB", self._frame_size, color=_BLANK_COLOR)
        self._idle_frames = [blank.tobytes()]

        self._session = aiohttp.ClientSession(
            headers={"Authorization": f"Bearer {self._api_key}"},
            timeout=aiohttp.ClientTimeout(total=_RUNPOD_COLD_START_TIMEOUT),
        )

        # Start idle loop right away (shows blank while warmup runs)
        self._start_idle_loop()

        # Background: generate real idle frames from MuseTalk silence audio
        self._warmup_task = asyncio.create_task(self._warmup_idle_frames())

        logger.info("MuseTalkVideoService started — idle warmup running in background")

    async def _stop(self):
        """Flush remaining audio and tear down resources."""
        self._running = False
        self._stop_idle_loop()

        if self._warmup_task and not self._warmup_task.done():
            self._warmup_task.cancel()
            self._warmup_task = None

        # Flush any leftover buffered audio
        if len(self._audio_buffer) > 0:
            await self._flush_audio()

        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

        logger.info("MuseTalkVideoService stopped")

    # ------------------------------------------------------------------
    # Idle video — MuseTalk-generated resting-face loop
    # ------------------------------------------------------------------

    async def _warmup_idle_frames(self):
        """Send silence to RunPod to pre-generate Anja's resting-face frames.
        This warms the RunPod worker AND produces real video for idle state.
        Runs as a background task — pipeline starts immediately without waiting."""
        logger.info(f"Warming up RunPod with {_IDLE_WARMUP_SECS}s silence...")
        try:
            silence = bytes(int(_IDLE_WARMUP_SECS * _BYTES_PER_SECOND_16K))
            audio_b64 = base64.b64encode(silence).decode("ascii")

            b64_frames = await self._call_runpod(audio_b64)

            if b64_frames:
                decoded = []
                for b64 in b64_frames:
                    rgb = self._decode_frame(b64)
                    if rgb:
                        decoded.append(rgb)

                if decoded:
                    self._idle_frames = decoded
                    self._idle_frame_idx = 0
                    # _first_request was set to False by _call_runpod — reset it so the
                    # first real speech call still benefits from warm-timeout behaviour
                    # (worker is now warm, 10s is enough)
                    logger.info(f"Idle warmup complete — {len(decoded)} frames, RunPod worker is warm")
                    return

            logger.warning("Idle warmup RunPod call failed — keeping blank idle frame")

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"Idle warmup error: {e} — keeping blank idle frame")

    def _make_idle_video_frame(self) -> OutputImageRawFrame:
        """Return the next frame in the idle loop (cycles through all frames)."""
        if not self._idle_frames:
            # Should never happen after _start(), but safe fallback
            blank = bytes(self._frame_size[0] * self._frame_size[1] * 3)
            return OutputImageRawFrame(image=blank, size=self._frame_size, format="RGB")

        frame_bytes = self._idle_frames[self._idle_frame_idx]
        self._idle_frame_idx = (self._idle_frame_idx + 1) % len(self._idle_frames)
        return OutputImageRawFrame(
            image=bytes(frame_bytes),
            size=self._frame_size,
            format="RGB",
        )

    def _start_idle_loop(self):
        """Spawn a background task that emits idle frames when not processing."""
        if self._idle_task is not None:
            return
        self._idle_task = asyncio.create_task(self._idle_frame_loop())

    def _stop_idle_loop(self):
        """Cancel the idle frame background task."""
        if self._idle_task is not None:
            self._idle_task.cancel()
            self._idle_task = None

    async def _idle_frame_loop(self):
        """Emit idle frames at target fps to keep the video stream alive."""
        interval = 1.0 / _IDLE_FPS
        try:
            while self._running:
                if not self._processing:
                    await self.push_frame(self._make_idle_video_frame())
                await asyncio.sleep(interval)
        except asyncio.CancelledError:
            pass

    # ------------------------------------------------------------------
    # RunPod API
    # ------------------------------------------------------------------

    async def _call_runpod(self, audio_b64: str) -> Optional[list[str]]:
        """Send audio to RunPod MuseTalk endpoint and return base64 JPEG frames.

        Uses /runsync for lowest latency (blocks until result is ready).
        Falls back to /run + polling if /runsync returns a job ID without
        a completed status.

        Returns a list of base64-encoded JPEG strings, or None on failure.
        """
        if not self._session or self._session.closed:
            logger.warning("No active aiohttp session — skipping RunPod call")
            return None

        timeout = _RUNPOD_COLD_START_TIMEOUT if self._first_request else _RUNPOD_WARM_TIMEOUT
        if self._first_request:
            logger.info(f"First RunPod request — using cold-start timeout ({timeout}s)")

        url_sync = f"https://api.runpod.ai/v2/{self._endpoint_id}/runsync"
        payload = {
            "input": {
                "audio": audio_b64,
                "fps": self._fps,
            }
        }

        for attempt in range(2):  # 1 retry for transient failures
            try:
                async with self._session.post(
                    url_sync, json=payload,
                    timeout=aiohttp.ClientTimeout(total=timeout),
                ) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        logger.warning(
                            f"RunPod /runsync returned {resp.status} "
                            f"(attempt {attempt + 1}): {body[:200]}"
                        )
                        if attempt == 0:
                            await asyncio.sleep(0.2)
                            continue
                        return None

                    data = await resp.json()

                status = data.get("status")

                # /runsync completed inline
                if status == "COMPLETED":
                    self._first_request = False
                    return self._extract_frames(data)

                # /runsync timed out server-side → poll async
                job_id = data.get("id")
                if job_id and status in ("IN_QUEUE", "IN_PROGRESS"):
                    result = await self._poll_job(job_id, timeout)
                    if result is not None:
                        self._first_request = False
                    return result

                # Unexpected status
                logger.warning(f"RunPod unexpected status: {status}, data keys: {list(data.keys())}")
                return None

            except asyncio.TimeoutError:
                logger.warning(f"RunPod request timed out (attempt {attempt + 1})")
                if attempt == 0:
                    continue
                return None
            except aiohttp.ClientError as e:
                logger.warning(f"RunPod request failed (attempt {attempt + 1}): {e}")
                if attempt == 0:
                    await asyncio.sleep(0.2)
                    continue
                return None
            except Exception as e:
                logger.error(f"RunPod unexpected error: {e}")
                return None

        return None

    async def _poll_job(self, job_id: str, timeout: float = _RUNPOD_WARM_TIMEOUT) -> Optional[list[str]]:
        """Poll /status/{job_id} until complete or timeout."""
        url = f"https://api.runpod.ai/v2/{self._endpoint_id}/status/{job_id}"
        deadline = time.monotonic() + timeout

        while time.monotonic() < deadline:
            try:
                async with self._session.get(url) as resp:
                    if resp.status != 200:
                        logger.warning(f"RunPod poll returned {resp.status}")
                        return None
                    data = await resp.json()

                status = data.get("status")
                if status == "COMPLETED":
                    return self._extract_frames(data)
                if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
                    logger.warning(f"RunPod job {job_id} ended with status: {status}")
                    return None

                await asyncio.sleep(_POLL_INTERVAL)

            except Exception as e:
                logger.warning(f"RunPod poll error for {job_id}: {e}")
                return None

        logger.warning(f"RunPod job {job_id} poll timed out after {timeout}s")
        return None

    @staticmethod
    def _extract_frames(data: dict) -> Optional[list[str]]:
        """Extract base64 JPEG frame list from RunPod response output."""
        output = data.get("output")
        if not output:
            logger.warning("RunPod response has no 'output' field")
            return None

        # Support both: {"output": {"frames": [...]}} and {"output": [...]}
        if isinstance(output, dict):
            frames = output.get("frames")
        elif isinstance(output, list):
            frames = output
        else:
            logger.warning(f"RunPod output is unexpected type: {type(output)}")
            return None

        if not frames:
            logger.warning("RunPod returned empty frames list")
            return None

        return frames

    # ------------------------------------------------------------------
    # Frame decoding
    # ------------------------------------------------------------------

    def _decode_frame(self, b64_jpeg: str) -> Optional[bytes]:
        """Decode a base64 JPEG string into raw RGB bytes at the target size."""
        try:
            jpeg_bytes = base64.b64decode(b64_jpeg)
            img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
            if img.size != self._frame_size:
                img = img.resize(self._frame_size, Image.LANCZOS)
            return img.tobytes()
        except Exception as e:
            logger.warning(f"Failed to decode video frame: {e}")
            return None

    # ------------------------------------------------------------------
    # Audio buffer management
    # ------------------------------------------------------------------

    async def _flush_and_release(self):
        """Background wrapper for _flush_audio that always releases the flushing flag."""
        try:
            await self._flush_audio()
        except Exception as e:
            logger.error(f"Background flush error: {e}")
        finally:
            self._flushing = False

    async def _flush_audio(self):
        """Send all buffered audio to RunPod and emit the resulting video frames."""
        if len(self._audio_buffer) == 0:
            return

        # Take the buffer and reset
        audio_data = bytes(self._audio_buffer)
        self._audio_buffer.clear()

        self._processing = True
        try:
            audio_b64 = base64.b64encode(audio_data).decode("ascii")
            chunk_ms = len(audio_data) / _BYTES_PER_SECOND_16K * 1000
            logger.debug(f"Sending {len(audio_data)} bytes ({chunk_ms:.0f}ms) to RunPod")

            b64_frames = await self._call_runpod(audio_b64)

            if b64_frames:
                await self._emit_video_frames(b64_frames)
            else:
                # Fallback: emit idle frames for the duration of the audio
                audio_duration = len(audio_data) / _BYTES_PER_SECOND_16K
                n_frames = max(1, int(audio_duration * self._fps))
                logger.debug(f"RunPod failed — emitting {n_frames} idle fallback frames")
                for _ in range(n_frames):
                    await self.push_frame(self._make_idle_video_frame())
        finally:
            self._processing = False

    async def _emit_video_frames(self, b64_frames: list[str]):
        """Decode and push video frames at the correct fps timing."""
        frame_interval = 1.0 / self._fps

        for i, b64_jpeg in enumerate(b64_frames):
            t_start = time.monotonic()

            raw_rgb = self._decode_frame(b64_jpeg)
            if raw_rgb is None:
                await self.push_frame(self._make_idle_video_frame())
            else:
                frame = OutputImageRawFrame(
                    image=raw_rgb,
                    size=self._frame_size,
                    format="RGB",
                )
                await self.push_frame(frame)

            # Pace output to match target fps (minus time already spent decoding)
            elapsed = time.monotonic() - t_start
            sleep_time = frame_interval - elapsed
            if sleep_time > 0 and i < len(b64_frames) - 1:
                await asyncio.sleep(sleep_time)

    # ------------------------------------------------------------------
    # FrameProcessor interface
    # ------------------------------------------------------------------

    async def process_frame(self, frame: Frame, direction):
        """Main frame routing — called by the Pipecat pipeline for every frame.

        - AudioRawFrame: buffer audio, trigger RunPod when threshold is reached.
        - StartFrame: initialize resources.
        - EndFrame / CancelFrame: flush and tear down.
        - All other frames: pass through unchanged.
        """
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            await self._start()
            await self.push_frame(frame, direction)

        elif isinstance(frame, (EndFrame, CancelFrame)):
            await self._stop()
            await self.push_frame(frame, direction)

        elif isinstance(frame, AudioRawFrame):
            # CRITICAL: Pass audio through immediately so the user hears Anja speak.
            # Buffer a copy for video processing in the background.
            await self.push_frame(frame, direction)

            self._audio_buffer.extend(frame.audio)

            if len(self._audio_buffer) >= self._chunk_bytes and not self._flushing:
                self._flushing = True
                # Process video in background — don't block the audio pipeline
                asyncio.create_task(self._flush_and_release())

        else:
            # Pass through text frames, LLM frames, control frames, etc.
            await self.push_frame(frame, direction)
