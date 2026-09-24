import { logger } from '../src/config/logger.js';
import { getDb } from '../src/db/client.js';

async function main() {
  const db = getDb();
  const { data: rows, error } = await db
    .from('corpus_passages')
    .select('id, passage_text, source_doc, section_ref')
    .is('embedding', null);
  if (error) throw error;
  const list = rows || [];
  logger.info({ count: list.length }, 'NULL-embedding rows');
  let nullText = 0;
  let emptyText = 0;
  let nonString = 0;
  let shortText = 0;
  const bad: { id: string; source_doc: string; section_ref: string; type: string; preview: unknown }[] = [];
  for (const r of list as { id: string; passage_text: unknown; source_doc: string; section_ref: string }[]) {
    const t = r.passage_text;
    if (t === null || t === undefined) {
      nullText++;
      bad.push({ id: r.id, source_doc: r.source_doc, section_ref: r.section_ref, type: 'null', preview: t });
    } else if (typeof t !== 'string') {
      nonString++;
      bad.push({ id: r.id, source_doc: r.source_doc, section_ref: r.section_ref, type: typeof t, preview: String(t).slice(0, 80) });
    } else if (t.length === 0) {
      emptyText++;
      bad.push({ id: r.id, source_doc: r.source_doc, section_ref: r.section_ref, type: 'empty', preview: t });
    } else if (t.trim().length < 10) {
      shortText++;
      bad.push({ id: r.id, source_doc: r.source_doc, section_ref: r.section_ref, type: 'short', preview: t });
    }
  }
  logger.info({ nullText, emptyText, nonString, shortText, totalBad: bad.length }, 'Bad passage_text counts');
  if (bad.length) logger.info({ bad: bad.slice(0, 30) }, 'Bad rows sample');
  const byDoc = new Map<string, number>();
  for (const r of list as { source_doc: string }[]) {
    byDoc.set(r.source_doc, (byDoc.get(r.source_doc) || 0) + 1);
  }
  logger.info({ byDoc: Object.fromEntries(byDoc) }, 'NULL-embedding rows by source_doc');
  process.exit(0);
}

main().catch(e => { logger.error({ err: e.message }, 'diag failed'); process.exit(1); });
