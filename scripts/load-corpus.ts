import fs from 'fs';
import path from 'path';
import { logger } from '../src/config/logger.js';
import { getDb } from '../src/db/client.js';

interface Passage {
  source_doc: string;
  section_ref: string;
  page_number: number;
  passage_text: string;
  category: string;
  language: string;
  version: string;
  embedding: number[];
}

async function loadPassages() {
  const db = getDb();
  const filePath = path.join(process.cwd(), 'corpus-processed', 'passages.jsonl');
  const version = process.env.CORPUS_VERSION || '2.0';

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
  logger.info({ count: lines.length, version }, 'Loading passages');

  const sourceDocs = new Set<string>();
  for (const line of lines) {
    const p = JSON.parse(line) as Passage;
    sourceDocs.add(p.source_doc);
  }

  logger.info({ sourceDocs: sourceDocs.size, names: [...sourceDocs] }, 'Deleting previous rows for same source_doc + version');
  for (const doc of sourceDocs) {
    const { error } = await db
      .from('corpus_passages')
      .delete()
      .eq('source_doc', doc)
      .eq('version', version);
    if (error) {
      logger.error({ error, doc }, 'Failed to delete previous rows');
    }
  }

  let inserted = 0;
  let failed = 0;
  const BATCH = 100;

  for (let i = 0; i < lines.length; i += BATCH) {
    const batch = lines.slice(i, i + BATCH).map(l => {
      const p = JSON.parse(l) as Passage;
      return {
        source_doc: p.source_doc,
        section_ref: p.section_ref,
        page_number: p.page_number,
        passage_text: p.passage_text,
        category: p.category,
        language: p.language,
        version: p.version || version,
        embedding: p.embedding,
      };
    });

    const { error } = await db.from('corpus_passages').insert(batch);
    if (error) {
      failed++;
      if (failed <= 3) logger.error({ error }, 'Batch insert failed');
    } else {
      inserted += batch.length;
      logger.info({ inserted, failed }, 'Progress');
    }
  }

  logger.info({ inserted, failed, total: lines.length }, 'Done');
  process.exit(failed > 0 ? 1 : 0);
}

loadPassages();