import { Request, Response } from 'express';
import { getDb } from '../../db/client.js';
import { detectLanguage } from '../../modules/language/detector.js';
import { retrieve } from '../../modules/rag/retriever.js';
import { generateAnswer } from '../../modules/llm/groq.js';
import { extractFacts, saveFacts, getCaseFacts } from '../../modules/case-memory/index.js';
import { logger } from '../../config/logger.js';

export async function handleWhatsAppWebhook(req: Request, res: Response) {
  try {
    const { From, Body, NumMedia, MediaUrl0, MediaContentType0 } = req.body;

    if (!From) {
      return res.status(400).json({ error: 'Missing From' });
    }

    const db = getDb();
    const phoneHash = Buffer.from(From).toString('base64');

    let { data: session } = await db
      .from('sessions')
      .select('id, language')
      .eq('phone_hash', phoneHash)
      .eq('channel', 'whatsapp')
      .is('ended_at', null)
      .single();

    if (!session) {
      const { data: newSession } = await db.from('sessions').insert({
        channel: 'whatsapp',
        language: 'hi',
        phone_hash: phoneHash,
      }).select('id, language').single();
      session = newSession;
    }

    if (!session) {
      return res.status(500).json({ error: 'Session creation failed' });
    }

    const detected = detectLanguage(Body || '');
    const language = detected.language;

    let query = Body || '';
    let responseText = '';

    if (NumMedia > 0 && MediaUrl0) {
      responseText = 'Document receive ho gaya hai. Main ise analyze kar raha hoon...';
    } else if (query) {
      const passages = await retrieve(query, undefined, 5, 0.75);
      const result = await generateAnswer(query, {
        language,
        passages,
        caseFacts: [],
        history: [],
      });
      responseText = result.answer;
    }

    res.json({
      response: responseText,
      sessionId: session.id,
    });
  } catch (err) {
    logger.error({ err }, 'WhatsApp webhook error');
    res.status(500).json({ error: 'Internal error' });
  }
}
