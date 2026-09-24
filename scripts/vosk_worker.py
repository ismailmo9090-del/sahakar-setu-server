#!/usr/bin/env python3
"""Vosk STT Worker - reads PCM audio from stdin, writes transcription to stdout."""
import sys
import json
import os
import wave

# Windows pipes default to cp1252, which corrupts Hindi text both ways.
# line_buffering: the Node bridge keeps stdin open, so prints must flush per line.
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

try:
    from vosk import Model, KaldiRecognizer
except ImportError:
    print(json.dumps({"type": "error", "message": "vosk not installed. Run: pip install vosk"}))
    sys.stdout.flush()
    sys.exit(1)

MODEL_PATH = os.environ.get("VOSK_MODEL_PATH", "models")

def find_model():
    if os.path.exists(MODEL_PATH) and os.path.isdir(MODEL_PATH):
        if os.path.exists(os.path.join(MODEL_PATH, "conf")):
            return MODEL_PATH
    alternatives = [
        "models",
        "models/vosk-model-small-hi-0.22",
        "./models",
        "./models/vosk-model-small-hi-0.22",
    ]
    for alt in alternatives:
        if os.path.exists(alt) and os.path.isdir(alt):
            if os.path.exists(os.path.join(alt, "conf")):
                return alt
    return MODEL_PATH

def main():
    model_path = find_model()
    
    if not os.path.exists(model_path):
        print(json.dumps({"type": "error", "message": f"Model not found at {model_path}. Checked: {MODEL_PATH}"}))
        sys.stdout.flush()
        return

    try:
        model = Model(model_path)
    except Exception as e:
        print(json.dumps({"type": "error", "message": f"Failed to load model: {e}"}))
        sys.stdout.flush()
        return

    rec = KaldiRecognizer(model, 16000)
    print(json.dumps({"type": "ready", "model_path": model_path}))
    sys.stdout.flush()

    for line in sys.stdin:
        try:
            msg = json.loads(line.strip())
        except json.JSONDecodeError:
            continue

        if msg.get("type") == "reset":
            rec = KaldiRecognizer(model, 16000)
            print(json.dumps({"type": "reset_done"}))
            sys.stdout.flush()
            continue

        if msg.get("type") == "audio":
            import base64
            audio_data = base64.b64decode(msg["data"])

            if rec.AcceptWaveform(audio_data):
                result = json.loads(rec.Result())
                text = result.get("text", "")
                if text:
                    print(json.dumps({"type": "transcript", "text": text, "is_final": True}))
                    sys.stdout.flush()
            else:
                partial = json.loads(rec.PartialResult())
                text = partial.get("partial", "")
                if text:
                    print(json.dumps({"type": "transcript", "text": text, "is_final": False}))
                    sys.stdout.flush()

        if msg.get("type") == "wav_file":
            filepath = msg["path"]
            lang = msg.get("lang", "hi")
            msg_id = msg.get("id", "")

            try:
                wf = wave.open(filepath, "rb")
                if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != 16000:
                    print(json.dumps({"type": "error", "id": msg_id, "message": "Audio must be mono 16-bit 16kHz WAV"}))
                    sys.stdout.flush()
                    continue

                rec_local = KaldiRecognizer(model, 16000)
                while True:
                    data = wf.readframes(4000)
                    if len(data) == 0:
                        break
                    if rec_local.AcceptWaveform(data):
                        result = json.loads(rec_local.Result())
                        text = result.get("text", "")
                        if text:
                            print(json.dumps({"type": "transcript", "id": msg_id, "text": text, "is_final": True}))
                            sys.stdout.flush()

                final = json.loads(rec_local.FinalResult())
                text = final.get("text", "")
                print(json.dumps({"type": "transcript", "id": msg_id, "text": text, "is_final": True}))
                sys.stdout.flush()

                wf.close()
            except Exception as e:
                print(json.dumps({"type": "error", "id": msg_id, "message": str(e)}))
                sys.stdout.flush()

if __name__ == "__main__":
    main()
