import fs from 'fs';
import path from 'path';
import { logger } from '../src/config/logger.js';
import { getDb } from '../src/db/client.js';

async function insertPassages() {
  const db = getDb();
  const filePath = path.join(process.cwd(), 'corpus-processed', 'passages.jsonl');

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
  logger.info({ count: lines.length }, 'Loading passages');

  let inserted = 0;
  let failed = 0;

  for (const line of lines) {
    const p = JSON.parse(line);

    const { error } = await db.from('corpus_passages').insert({
      source_doc: p.source_doc,
      section_ref: p.section_ref,
      page_number: p.page_number,
      passage_text: p.passage_text,
      language: p.language,
      category: p.category,
      version: p.version,
    });

    if (error) {
      failed++;
      if (failed <= 3) logger.error({ error, source: p.source_doc }, 'Insert failed');
    } else {
      inserted++;
    }

    if (inserted % 50 === 0 && inserted > 0) {
      logger.info({ inserted, failed }, 'Progress');
    }
  }

  logger.info({ inserted, failed, total: lines.length }, 'Done');
  process.exit(0);
}

insertPassages();
