#!/usr/bin/env python3
import os, sys, json, glob
from PyPDF2 import PdfReader

CORPUS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'corpus')
CHUNK_SIZE = 500
CHUNK_OVERLAP = 100

def extract_text(pdf_path):
    try:
        reader = PdfReader(pdf_path)
        text = ""
        for page in reader.pages:
            t = page.extract_text()
            if t:
                text += t + "\n"
        return text
    except Exception as e:
        print(json.dumps({"type": "error", "file": pdf_path, "message": str(e)}), flush=True)
        return ""

def chunk_text(text):
    words = text.split()
    chunks = []
    for i in range(0, len(words), CHUNK_SIZE - CHUNK_OVERLAP):
        chunk = " ".join(words[i:i+CHUNK_SIZE])
        if len(chunk.strip()) > 50:
            chunks.append(chunk)
    return chunks

def detect_category(filename):
    lower = filename.lower()
    if 'act' in lower or 'law' in lower:
        return 'laws'
    if 'scheme' in lower or 'yojana' in lower or 'yuva' in lower or 'sahakar' in lower:
        return 'schemes'
    if 'pmfby' in lower or 'fasal' in lower:
        return 'pmfby'
    if 'pacs' in lower or 'bylaw' in lower:
        return 'pacs'
    return 'laws'

def detect_language(text):
    devanagari = sum(1 for c in text if '\u0900' <= c <= '\u097F')
    ratio = devanagari / max(len(text), 1)
    return 'hi' if ratio > 0.3 else 'en'

all_pdfs = []
for root, dirs, files in os.walk(CORPUS_DIR):
    for f in files:
        if f.endswith('.pdf'):
            all_pdfs.append(os.path.join(root, f))

print(json.dumps({"type": "info", "pdfs_found": len(all_pdfs)}), flush=True)

passages = []
for pdf_path in all_pdfs:
    filename = os.path.basename(pdf_path)
    text = extract_text(pdf_path)
    if len(text) < 100:
        print(json.dumps({"type": "warn", "file": filename, "reason": "too short"}), flush=True)
        continue

    chunks = chunk_text(text)
    source_doc = filename.replace('.pdf', '').replace('-', ' ')
    category = detect_category(filename)

    for i, chunk in enumerate(chunks):
        passages.append({
            "source_doc": source_doc,
            "section_ref": f"Chunk {i+1}",
            "page_number": i // 3 + 1,
            "passage_text": chunk,
            "category": category,
            "language": detect_language(chunk),
            "version": "1.0"
        })

    print(json.dumps({"type": "processed", "file": filename, "chunks": len(chunks)}), flush=True)

print(json.dumps({"type": "done", "total_passages": len(passages)}), flush=True)

output_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'corpus-processed', 'passages.jsonl')
os.makedirs(os.path.dirname(output_path), exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    for p in passages:
        f.write(json.dumps(p, ensure_ascii=False) + '\n')

print(json.dumps({"type": "saved", "path": output_path, "count": len(passages)}), flush=True)
