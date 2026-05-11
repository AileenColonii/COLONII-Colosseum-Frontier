"""Simple HTTP server that spawns Pipecat bot processes per session."""

import glob
import subprocess
import json
import os
import sys
import time
import tempfile
from http.server import HTTPServer, BaseHTTPRequestHandler

ALLOWED_MODELS = {"gemini", "groq", "openai", "haiku", "sonnet"}
MAX_BOTS = 10
BOT_SERVER_SECRET = os.environ.get("BOT_SERVER_SECRET", "")

active_pids: set[int] = set()


def reap_dead_pids():
    dead = set()
    for pid in active_pids:
        try:
            os.kill(pid, 0)
        except OSError:
            dead.add(pid)
    active_pids.difference_update(dead)

    server_dir = os.path.dirname(os.path.abspath(__file__))
    for f in glob.glob(os.path.join(server_dir, "ctx_*.json")):
        try:
            if time.time() - os.path.getmtime(f) > 300:
                os.unlink(f)
        except OSError:
            pass


class BotSpawner(BaseHTTPRequestHandler):
    def _cors_origin(self):
        origin = self.headers.get("Origin", "")
        if "colonii-demo.vercel.app" in origin or "localhost" in origin:
            return origin
        return "https://colonii-demo.vercel.app"

    def do_OPTIONS(self):
        """Handle CORS preflight for browser uploads."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self._cors_origin())
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self):
        # Serve uploaded files from /opt/colonii/uploads/
        if self.path.startswith("/uploads/"):
            filepath = os.path.join("/opt/colonii/uploads", os.path.basename(self.path))
            if os.path.isfile(filepath):
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Access-Control-Allow-Origin", self._cors_origin())
                self.end_headers()
                with open(filepath, "rb") as f:
                    self.wfile.write(f.read())
                return

        reap_dead_pids()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(
            json.dumps({"status": "ok", "active_bots": len(active_pids)}).encode()
        )

    def do_PUT(self):
        """Handle file uploads — saves to /opt/colonii/uploads/ and returns public URL."""
        if not self.path.startswith("/upload/"):
            self.send_response(404)
            self.end_headers()
            return

        # Auth check
        if BOT_SERVER_SECRET:
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {BOT_SERVER_SECRET}":
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "unauthorized"}).encode())
                return

        # File size limit: 50MB
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 50 * 1024 * 1024:
            self.send_response(413)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "file too large (max 50MB)"}).encode())
            return

        filename = os.path.basename(self.path)
        upload_dir = "/opt/colonii/uploads"
        os.makedirs(upload_dir, exist_ok=True)
        filepath = os.path.join(upload_dir, filename)

        with open(filepath, "wb") as f:
            remaining = content_length
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 65536))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)

        # Build public URL using the server's external IP
        public_url = f"http://{self.headers.get('Host', 'localhost')}/uploads/{filename}"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", self._cors_origin())
        self.end_headers()
        self.wfile.write(json.dumps({"url": public_url, "filename": filename}).encode())
        print(f"[upload] Saved {filename} ({content_length} bytes)")

    def do_POST(self):
        if BOT_SERVER_SECRET:
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {BOT_SERVER_SECRET}":
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "unauthorized"}).encode())
                return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except (ValueError, json.JSONDecodeError):
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "invalid request body"}).encode())
            return

        url = body.get("url", "")
        token = body.get("token", "")
        model = body.get("model", "groq")
        mode = body.get("mode", "video")
        user_context = body.get("user_context", None)

        if not url or not token:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "url and token required"}).encode())
            return

        if model not in ALLOWED_MODELS:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": f"invalid model, allowed: {sorted(ALLOWED_MODELS)}"}).encode()
            )
            return

        reap_dead_pids()
        if len(active_pids) >= MAX_BOTS:
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": f"at capacity ({MAX_BOTS} bots running)"}).encode()
            )
            return

        server_dir = os.path.dirname(os.path.abspath(__file__))
        # Use venv Python so spawned bots have all dependencies
        venv_python = os.path.join(os.path.dirname(server_dir), "venv", "bin", "python3")
        python_bin = venv_python if os.path.isfile(venv_python) else "python3"
        cmd = [python_bin, "bot.py", "-m", model, "--mode", mode]

        # Pass sensitive data via environment, not CLI args (visible in ps aux)
        bot_env = {
            **os.environ,
            "PYTHONUNBUFFERED": "1",
            "DAILY_ROOM_URL": url,
            "DAILY_TOKEN": token,
        }

        context_file_path = None
        if user_context:
            context_file = tempfile.NamedTemporaryFile(
                mode="w", suffix=".json", dir=server_dir,
                delete=False, prefix="ctx_",
            )
            json.dump(user_context, context_file)
            context_file.close()
            context_file_path = context_file.name
            cmd.extend(["-c", context_file_path])

        try:
            proc = subprocess.Popen(
                cmd,
                cwd=server_dir,
                env=bot_env,
            )
            active_pids.add(proc.pid)
        except Exception as e:
            if context_file_path:
                try:
                    os.unlink(context_file_path)
                except OSError:
                    pass
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "failed to spawn bot"}).encode())
            print(f"[bot-server] Popen failed: {e}")
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(
            json.dumps({"ok": True, "active_bots": len(active_pids)}).encode()
        )

    def log_message(self, format, *args):
        print(f"[bot-server] {args[0]}")


if __name__ == "__main__":
    if not BOT_SERVER_SECRET:
        print("[bot-server] FATAL: BOT_SERVER_SECRET not set — refusing to start without auth.")
        sys.exit(1)
    print(f"[bot-server] Listening on :8765 (auth=enabled)")
    HTTPServer(("0.0.0.0", 8765), BotSpawner).serve_forever()
