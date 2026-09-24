#!/usr/bin/env python3
"""gTTS (Google Translate) TTS worker - JSON lines over stdin/stdout."""
import sys
import json
import base64
import io

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

try:
    from gtts import gTTS
except ImportError:
    print(json.dumps({"type": "error", "message": "gTTS not installed. Run: pip install gTTS"}))
    sys.stdout.flush()
    sys.exit(1)

SUPPORTED = ("hi", "en", "mr", "bn", "ta", "te", "gu", "kn", "ml", "pa", "ur")

def main():
    for line in sys.stdin:
        try:
            msg = json.loads(line)
        except Exception:
            continue
        mid = msg.get("id", "")
        text = (msg.get("text") or "").strip()
        lang = (msg.get("lang") or "hi")[:2].lower()
        if lang not in SUPPORTED:
            lang = "hi"
        if not text:
            print(json.dumps({"type": "error", "id": mid, "message": "empty text"}))
            sys.stdout.flush()
            continue
        try:
            buf = io.BytesIO()
            gTTS(text=text, lang=lang, tld="com").write_to_fp(buf)
            data = base64.b64encode(buf.getvalue()).decode("ascii")
            print(json.dumps({"type": "audio", "id": mid, "data": data}))
        except Exception as e:
            print(json.dumps({"type": "error", "id": mid, "message": str(e)}))
        sys.stdout.flush()

if __name__ == "__main__":
    main()
