#!/usr/bin/env python3
import sys, json, base64, struct

# Windows pipes default to locale encoding (cp1252); Node sends UTF-8.
sys.stdin.reconfigure(encoding='utf-8', errors='surrogateescape')
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    print(json.dumps({"type": "error", "message": "sentence-transformers not installed. Run: pip install sentence-transformers"}), flush=True)
    sys.exit(1)

model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')

for line in sys.stdin:
    try:
        msg = json.loads(line.strip())
        if msg["type"] == "embed":
            emb = model.encode(msg["text"], normalize_embeddings=True)
            binary = struct.pack(f'{len(emb)}f', *emb.tolist())
            print(json.dumps({
                "type": "embedding",
                "id": msg.get("id"),
                "data": base64.b64encode(binary).decode(),
                "dim": len(emb),
            }), flush=True)
        elif msg["type"] == "embed_batch":
            results = []
            for item in msg["texts"]:
                emb = model.encode(item["text"], normalize_embeddings=True)
                binary = struct.pack(f'{len(emb)}f', *emb.tolist())
                results.append({
                    "id": item.get("id"),
                    "data": base64.b64encode(binary).decode(),
                    "dim": len(emb),
                })
            print(json.dumps({"type": "embeddings", "results": results}), flush=True)
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(json.dumps({
            "type": "error",
            "message": str(e),
            "traceback": tb[-1500:],
            "raw_len": len(line) if line else 0,
            "raw_head": repr(line[:300]) if line else "",
        }), flush=True)
