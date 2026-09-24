#!/usr/bin/env python3
"""Edge TTS Worker - reads text from stdin, writes audio to stdout using edge-tts."""
import sys
import json
import asyncio
import base64
import os
import tempfile

# Windows pipes default to cp1252, which corrupts Hindi text both ways.
# line_buffering: the Node bridge keeps stdin open, so prints must flush per line.
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

try:
    import edge_tts
except ImportError:
    print(json.dumps({"type": "error", "message": "edge-tts not installed. Run: pip install edge-tts"}))
    sys.stdout.flush()
    sys.exit(1)

VOICE_MAP = {
    "hi": os.getenv("TTS_VOICE_HINDI", "hi-IN-MadhurNeural"),
    "en": os.getenv("TTS_VOICE_ENGLISH", "en-IN-PrabhatNeural"),
    "mr": "mr-IN-ManoharNeural",
    "ta": "ta-IN-ValluvarNeural",
    "te": "te-IN-MohanNeural",
    "bn": "bn-IN-BashkarNeural",
    "gu": "gu-IN-NiranjanNeural",
    "kn": "kn-IN-GaganNeural",
    "ml": "ml-IN-MidhunNeural",
    "pa": "pa-IN-GurpreetNeural",
    "ur": "ur-PK-AsadNeural",
}

async def synthesize(text: str, lang: str, output_path: str):
    voice = VOICE_MAP.get(lang, VOICE_MAP["hi"])
    communicate = edge_tts.Communicate(text, voice, rate="+5%")
    await communicate.save(output_path)

def main():
    for line in sys.stdin:
        try:
            msg = json.loads(line.strip())
        except json.JSONDecodeError:
            continue

        text = msg.get("text", "")
        lang = msg.get("lang", "hi")
        msg_id = msg.get("id", "")

        if not text:
            print(json.dumps({"type": "error", "message": "No text provided", "id": msg_id}))
            sys.stdout.flush()
            continue

        try:
            output_path = os.path.join(tempfile.gettempdir(), f"tts_{msg_id}.mp3")
            asyncio.run(synthesize(text, lang, output_path))

            with open(output_path, "rb") as f:
                audio_bytes = f.read()

            audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

            print(json.dumps({
                "type": "audio",
                "id": msg_id,
                "data": audio_b64,
                "format": "mp3",
                "sample_rate": 24000,
            }))
            sys.stdout.flush()

            try:
                os.remove(output_path)
            except:
                pass

        except Exception as e:
            print(json.dumps({"type": "error", "message": f"{type(e).__name__}: {e} | text={repr(text[:80])}", "id": msg_id}))
            sys.stdout.flush()

if __name__ == "__main__":
    main()
