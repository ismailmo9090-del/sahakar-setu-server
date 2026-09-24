import { spawn } from 'child_process';
import { logger } from '../src/config/logger.js';
import { getDb } from '../src/db/client.js';

const BATCH = 32;

function decodeB64Float32(b64: string): number[] {
  const bin = Buffer.from(b64, 'base64');
  const out: number[] = [];
  for (let i = 0; i + 4 <= bin.length; i += 4) {
    out.push(bin.readFloatLE(i));
  }
  return out;
}

async function backfill() {
  const db = getDb();
  const { data: rows, error } = await db
    .from('corpus_passages')
    .select('id, passage_text')
    .is('embedding', null);

  if (error) throw error;
  logger.info({ count: (rows || []).length }, 'Rows with NULL embedding');
  if (!rows || rows.length === 0) {
    logger.info('Nothing to backfill');
    process.exit(0);
  }

  const taskList = (rows as { id: string; passage_text: string }[]).map(r => ({ id: r.id, text: r.passage_text }));

  const py = spawn('python', ['-u', 'scripts/embed_service.py'], { shell: false });
  let stderr = '';
  const queue: { resolve: (v: Map<string, number[]>) => void }[] = [];

  py.on('error', (e) => { logger.error({ err: e.message }, 'spawn error'); process.exit(1); });
  py.stderr.on('data', (d) => { stderr += d.toString(); });
  py.on('close', (code) => {
    if (code !== 0) logger.error({ code, stderr }, 'embed worker exited');
    if (queue.length > 0) {
      logger.error('Pending queue left unresolved — worker died early');
      process.exit(1);
    }
  });

  let buf = '';
  py.stdout.on('data', (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'error') {
          logger.error({ message: msg.message }, 'embed worker error');
          const p = queue.shift();
          if (p) p.resolve(new Map());
          continue;
        }
        if (msg.type === 'embeddings') {
          const result = new Map<string, number[]>();
          for (const r of msg.results) {
            result.set(r.id as string, decodeB64Float32(r.data as string));
          }
          const p = queue.shift();
          if (p) p.resolve(result);
        }
      } catch { /* ignore non-json noise */ }
    }
  });

  function embedBatch(batch: { id: string; text: string }[]) {
    return new Promise<Map<string, number[]>>((resolve) => {
      queue.push({ resolve });
      py.stdin.write(JSON.stringify({ type: 'embed_batch', texts: batch }) + '\n');
    });
  }

  let updated = 0;
  for (let i = 0; i < taskList.length; i += BATCH) {
    const batch = taskList.slice(i, i + BATCH);
    const results = await embedBatch(batch);
    for (const b of batch) {
      const emb = results.get(b.id);
      if (!emb || emb.length !== 384) {
        logger.warn({ id: b.id, len: emb?.length }, 'Bad embedding returned');
        continue;
      }
      const { error: upErr } = await db.from('corpus_passages').update({ embedding: emb }).eq('id', b.id);
      if (upErr) logger.error({ upErr, id: b.id }, 'Update failed');
      else updated++;
    }
    if ((i + BATCH) % 128 === 0 || i + BATCH >= taskList.length) {
      logger.info({ updated, total: taskList.length }, 'Backfill progress');
    }
  }

  py.stdin.end();
  logger.info({ updated, total: rows.length }, 'Backfill complete');
  process.exit(updated === taskList.length ? 0 : 1);
}

backfill();