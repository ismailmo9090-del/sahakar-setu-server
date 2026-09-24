import { Router, Request, Response } from 'express';
import { getDb } from '../../db/client.js';
import { detectLanguage } from '../../modules/language/detector.js';
import { retrieve } from '../../modules/rag/retriever.js';
import { generateAnswer } from '../../modules/llm/groq.js';
import { extractFacts, saveFacts, getCaseFacts } from '../../modules/case-memory/index.js';
import { ChatRequestSchema } from '../../types/index.js';
import { storeTurn, getRecentTurns } from '../../modules/chat-log/index.js';
import { logger } from '../../config/logger.js';
import { queriesTotal, latencyHistogram } from '../../services/metrics.js';

const router = Router();

router.post('/chat', async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { message, sessionId, caseId, language: reqLang, channel } = parsed.data;
    const language = reqLang || detectLanguage(message).language;

    const db = getDb();

    let sid = sessionId;
    if (!sid) {
      const { data: session } = await db.from('sessions').insert({
        channel,
        language,
      }).select('id').single();
      sid = session?.id;
    }

    let cid = caseId;
    if (!cid) {
      const { data: newCase } = await db.from('cases').insert({
        session_id: sid,
        category: 'laws',
        language,
      }).select('id').single();
      cid = newCase?.id;
    }

    const caseFacts = cid ? await getCaseFacts(cid) : [];
    const history = sessionId && sid ? await getRecentTurns(sid, 6) : [];
    await storeTurn(sid ?? null, 'user', message, { channel, language });

    const passages = await retrieve(message, undefined, 5, 0.2);

    const result = await generateAnswer(message, {
      language,
      passages,
      caseFacts: caseFacts.map(f => ({ key: f.factKey, value: f.factValue })),
      history,
      channel,
    });

    await storeTurn(sid ?? null, 'assistant', result.answer, {
      channel,
      language,
      model: result.model,
      citations: result.citations,
      latencyMs: Date.now() - start,
    });

    const latencyMs = Date.now() - start;
    queriesTotal.inc({ channel, language, category: 'laws' });
    latencyHistogram.observe({ stage: 'total' }, latencyMs / 1000);

    logger.info({
      event: 'query_answered',
      sessionId: sid,
      caseId: cid,
      channel,
      language,
      latencyMs,
      model: result.model,
      citations: result.citations.length,
    }, 'Chat query answered');

    if (cid) {
      try {
        const newFacts = await extractFacts(message, result.answer, caseFacts);
        if (newFacts.length > 0) {
          await saveFacts(cid, newFacts);
        }
      } catch (factErr: any) {
        logger.warn({ err: factErr?.message }, 'Fact extraction failed (non-critical)');
      }
    }

    res.json({
      answer: result.answer,
      citations: result.citations,
      sessionId: sid,
      caseId: cid,
      language,
    });
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack }, 'Chat endpoint error');
    res.status(500).json({ error: err?.message || 'Internal server error' });
  }
});

router.post('/chat/stream', async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { message, sessionId, caseId, language: reqLang, channel } = parsed.data;
    const language = reqLang || detectLanguage(message).language;

    const db = getDb();

    let sid = sessionId;
    if (!sid) {
      const { data: session } = await db.from('sessions').insert({
        channel,
        language,
      }).select('id').single();
      sid = session?.id;
    }

    let cid = caseId;
    if (!cid) {
      const { data: newCase } = await db.from('cases').insert({
        session_id: sid,
        category: 'laws',
        language,
      }).select('id').single();
      cid = newCase?.id;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'start', sessionId: sid, caseId: cid })}\n\n`);

    const caseFacts = cid ? await getCaseFacts(cid) : [];
    const history = sessionId && sid ? await getRecentTurns(sid, 6) : [];
    await storeTurn(sid ?? null, 'user', message, { channel, language });

    const passages = await retrieve(message, undefined, 5, 0.2);

    res.write(`data: ${JSON.stringify({ type: 'retrieving', passagesFound: passages.length })}\n\n`);

    const result = await generateAnswer(message, {
      language,
      passages,
      caseFacts: caseFacts.map(f => ({ key: f.factKey, value: f.factValue })),
      history,
      channel,
    });

    await storeTurn(sid ?? null, 'assistant', result.answer, {
      channel,
      language,
      model: result.model,
      citations: result.citations,
      latencyMs: Date.now() - start,
    });

    res.write(`data: ${JSON.stringify({ type: 'answer', answer: result.answer, citations: result.citations, model: result.model })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();

    logger.info({
      event: 'stream_answered',
      sessionId: sid,
      caseId: cid,
      channel,
      language,
      latencyMs: Date.now() - start,
    }, 'Chat stream answered');
  } catch (err) {
    logger.error({ err }, 'Chat stream error');
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Internal server error' })}\n\n`);
    res.end();
  }
});

export default router;
