import fs from 'fs';
import path from 'path';
import { logger } from '../src/config/logger.js';
import { getDb } from '../src/db/client.js';

const CORPUS_DIR = path.join(process.cwd(), 'corpus');
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;

interface Passage {
  sourceDoc: string;
  sectionRef: string;
  pageNumber: number;
  text: string;
  category: string;
  language: string;
}

async function ingestCorpus() {
  logger.info('Starting corpus ingestion');

  const db = getDb();
  const passages: Passage[] = [];

  const allPdfFiles: string[] = [];

  function scanDir(dir: string) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scanDir(fullPath);
      } else if (item.endsWith('.pdf')) {
        allPdfFiles.push(fullPath);
      }
    }
  }
  scanDir(CORPUS_DIR);

  logger.info({ count: allPdfFiles.length }, 'Found PDF files');

  for (const filePath of allPdfFiles) {
    const fileName = path.basename(filePath);
    logger.info({ file: fileName }, 'Processing PDF');

    const text = await extractTextFromPDF(filePath);
    if (!text || text.length < 100) {
      logger.warn({ file: fileName }, 'PDF too short, skipping');
      continue;
    }

    const chunks = chunkText(text);
    const sourceDoc = fileName.replace('.pdf', '').replace(/-/g, ' ');
    const category = detectCategory(fileName);

    for (let i = 0; i < chunks.length; i++) {
      passages.push({
        sourceDoc,
        sectionRef: `Chunk ${i + 1}`,
        pageNumber: Math.floor(i / 3) + 1,
        text: chunks[i],
        category,
        language: detectLanguage(chunks[i]),
      });
    }

    logger.info({ file: fileName, chunks: chunks.length }, 'PDF processed');
  }

  logger.info({ totalPassages: passages.length }, 'Inserting passages into database');

  for (let i = 0; i < passages.length; i++) {
    const p = passages[i];

    const { error } = await db.from('corpus_passages').insert({
      source_doc: p.sourceDoc,
      section_ref: p.sectionRef,
      page_number: p.pageNumber,
      passage_text: p.text,
      language: p.language,
      category: p.category,
      version: '1.0',
    });

    if (error) {
      logger.error({ error, source: p.sourceDoc }, 'Failed to insert passage');
    }

    if ((i + 1) % 50 === 0) {
      logger.info({ processed: i + 1, total: passages.length }, 'Progress');
    }
  }

  logger.info({ totalPassages: passages.length }, 'Corpus ingestion complete');
  process.exit(0);
}

async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to extract PDF text');
    return '';
  }
}

function chunkText(text: string): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    chunks.push(words.slice(i, i + CHUNK_SIZE).join(' '));
  }

  return chunks.filter(c => c.trim().length > 50);
}

function detectCategory(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes('act') || lower.includes('law')) return 'laws';
  if (lower.includes('scheme') || lower.includes('yojana') || lower.includes('yuva') || lower.includes('sahakar')) return 'schemes';
  if (lower.includes('pmfby') || lower.includes('fasal')) return 'pmfby';
  if (lower.includes('pacs') || lower.includes('bylaw')) return 'pacs';
  return 'laws';
}

function detectLanguage(text: string): string {
  const devanagariRatio = (text.match(/[\u0900-\u097F]/g) || []).length / text.length;
  return devanagariRatio > 0.3 ? 'hi' : 'en';
}

ingestCorpus();
