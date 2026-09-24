#!/usr/bin/env python3
"""Build corpus: extract text (PDF/txt/md), chunk (~500 tokens, 100 overlap),
generate embeddings with paraphrase-multilingual-MiniLM-L12-v2, and write
a JSONL file ready for the TS loader (scripts/load-corpus.ts).

Usage:
    python scripts/build-corpus.py [--max-chars N]
"""
import argparse
import json
import os
import re
import sys
import time

try:
    from PyPDF2 import PdfReader
except ImportError:
    PdfReader = None

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    sys.exit("sentence-transformers not installed")

SERVER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS_DIR = os.path.join(SERVER_ROOT, "corpus")
OUTPUT_PATH = os.path.join(SERVER_ROOT, "corpus-processed", "passages.jsonl")

TOKEN_TARGET = 500
TOKEN_OVERLAP = 100
VERSION = os.environ.get("CORPUS_VERSION", "2.0")


def extract_pdf(path):
    if PdfReader is None:
        return ""
    try:
        reader = PdfReader(path)
        pages = []
        for pg in reader.pages:
            t = pg.extract_text() or ""
            if t:
                pages.append(t)
        return "\n".join(pages)
    except Exception as e:
        print(json.dumps({"type": "warn", "file": path, "message": str(e)}, ensure_ascii=False), flush=True)
        return ""


def extract_text(path):
    lower = path.lower()
    if lower.endswith(".pdf"):
        return extract_pdf(path)
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def detect_language(text):
    devanagari = sum(1 for c in text if "\u0900" <= c <= "\u097F")
    ratio = devanagari / max(len(text), 1)
    return "hi" if ratio > 0.3 else "en"


def detect_category(filename, section_ref, text):
    lowered = filename.lower() + " " + section_ref.lower()
    if "pmfby" in lowered or "fasal" in lowered or "insurance" in lowered or "premium" in text.lower()[:2000]:
        return "pmfby"
    if "act" in lowered or "law" in lowered or "amendment" in lowered or "constitution" in lowered or "bylaw" in lowered or "by-law" in lowered:
        return "laws"
    if "scheme" in lowered or "yojana" in lowered or "sahakar" in lowered or "ncct" in lowered or "ricm" in lowered or "computerisation" in lowered or "computerization" in lowered:
        return "schemes"
    if "pacs" in lowered or "kcc" in lowered or "loan" in lowered or "savings" in lowered or "fd" in lowered or "deposit" in lowered:
        return "pacs"
    if "grievance" in lowered or "shikayat" in lowered or "ombudsman" in lowered or "rti" in lowered or "nalsa" in lowered or "dlsa" in lowered or "complaint" in lowered:
        return "grievance"
    if "interest" in lowered or "emi" in lowered or "apy" in lowered or "pm-sym" in lowered or "financial" in lowered or "saving" in lowered or "insurance" in lowered or "pension" in lowered:
        return "financial"
    return "laws"


def clean_line(line):
    line = line.strip()
    line = re.sub(r"[ \t]+", " ", line)
    return line


def split_into_sentences(text):
    text = re.sub(r"\s+", " ", text)
    parts = re.split(r"(?<=[.!?;:])\s+", text)
    result = []
    for p in parts:
        p = p.strip()
        if p:
            result.append(p)
    return result


def build_chunks_by_char(text, max_chars=2000, overlap_chars=400):
    """Char-based chunking (~500 tokens for English ~= 2000 chars using ~4 chars/token)."""
    text = re.sub(r"\s+", " ", text).strip()
    chunks = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + max_chars, n)
        if end < n:
            cut = text.rfind(" ", start, end)
            if cut > start + max_chars // 2:
                end = cut
        chunk = text[start:end].strip()
        if len(chunk.split()) >= 20:
            chunks.append(chunk)
        if end >= n:
            break
        start = max(end - overlap_chars, start + max_chars // 2)
    return chunks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-chars", type=int, default=2000)
    parser.add_argument("--min-words", type=int, default=20)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--skip", action="append", default=[],
                        help="skip files whose name contains this substring (repeatable)")
    args = parser.parse_args()

    all_files = []
    for root, dirs, files in os.walk(CORPUS_DIR):
        for f in sorted(files):
            if f.lower().endswith((".pdf", ".txt", ".md", ".markdown")):
                if any(s in f for s in args.skip):
                    continue
                all_files.append(os.path.join(root, f))
    print(json.dumps({"type": "info", "files": len(all_files)}, ensure_ascii=False), flush=True)

    passages = []
    for file_path in all_files:
        tail = os.path.basename(file_path)
        rel = os.path.relpath(file_path, CORPUS_DIR)
        if tail.startswith("."):
            continue
        text = extract_text(file_path)
        if not text or len(text.strip()) < 100:
            print(json.dumps({"type": "skip", "file": rel, "chars": len(text)}, ensure_ascii=False), flush=True)
            continue

        chunks = build_chunks_by_char(text, max_chars=args.max_chars)
        source_doc = tail.replace(".pdf", "").replace(".txt", "").replace(".md", "").replace(".markdown", "").replace("-", " ").replace("_", " ").strip()
        for i, chunk in enumerate(chunks):
            if len(chunk.split()) < args.min_words:
                continue
            category = detect_category(source_doc, f"Chunk {i+1}", chunk)
            passages.append({
                "source_doc": source_doc,
                "section_ref": f"Chunk {i+1}",
                "page_number": i // 3 + 1,
                "passage_text": chunk,
                "category": category,
                "language": detect_language(chunk),
                "version": VERSION,
            })
        print(json.dumps({"type": "processed", "file": rel, "chunks": len(chunks)}, ensure_ascii=False), flush=True)

    if args.limit > 0:
        passages = passages[:args.limit]

    print(json.dumps({"type": "chunking_done", "total": len(passages)}, ensure_ascii=False), flush=True)

    print(json.dumps({"type": "info", "loading_model": "paraphrase-multilingual-MiniLM-L12-v2"}, ensure_ascii=False), flush=True)
    model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
    print(json.dumps({"type": "model_ready"}, ensure_ascii=False), flush=True)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    batch_size = 32
    written = 0
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        for start_idx in range(0, len(passages), batch_size):
            batch = passages[start_idx:start_idx + batch_size]
            texts = [p["passage_text"] for p in batch]
            embeddings = model.encode(texts, normalize_embeddings=True, batch_size=batch_size)
            for p, emb in zip(batch, embeddings):
                row = dict(p)
                row["embedding"] = [float(x) for x in emb]
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
                written += 1
            if written % 200 < batch_size:
                print(json.dumps({"type": "embedded", "written": written, "total": len(passages)}, ensure_ascii=False), flush=True)
        f.flush()

    print(json.dumps({"type": "done", "path": OUTPUT_PATH, "count": written}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()