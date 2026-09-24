import { Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../../db/client.js';
import { detectLanguage } from '../../modules/language/detector.js';
import { retrieve } from '../../modules/rag/retriever.js';
import { generateAnswer } from '../../modules/llm/groq.js';
import { extractFacts, saveFacts, getCaseFacts } from '../../modules/case-memory/index.js';
import { logger } from '../../config/logger.js';

function verifyTwilioSignature(req: Request): boolean {
  const signature = req.headers['x-twilio-signature'] as string;
  if (!signature) return false;

  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const params = req.body;

  let data = url;
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const hmac = crypto
    .createHmac('sha1', process.env.TWILIO_AUTH_TOKEN || '')
    .update(data)
    .digest('base64');

  return hmac === signature;
}

export async function handleSMSWebhook(req: Request, res: Response) {
  try {
    const { From, Body } = req.body;

    if (!From || !Body) {
      return res.status(400).json({ error: 'Missing From or Body' });
    }

    const db = getDb();
    const phoneHash = crypto.createHash('sha256').update(From).digest('hex');

    let { data: session } = await db
      .from('sessions')
      .select('id, language')
      .eq('phone_hash', phoneHash)
      .eq('channel', 'sms')
      .is('ended_at', null)
      .single();

    if (!session) {
      const { data: newSession } = await db.from('sessions').insert({
        channel: 'sms',
        language: 'hi',
        phone_hash: phoneHash,
      }).select('id, language').single();
      session = newSession;
    }

    if (!session) {
      return res.status(500).json({ error: 'Session creation failed' });
    }

    const detected = detectLanguage(Body);
    const language = detected.language;

    const passages = await retrieve(Body, undefined, 3, 0.2);
    const result = await generateAnswer(Body, {
      language,
      passages,
      caseFacts: [],
      history: [],
    });

    let responseText = result.answer;
    if (responseText.length > 160) {
      const parts: string[] = [];
      let remaining = responseText;
      while (remaining.length > 0) {
        if (remaining.length <= 160) {
          parts.push(remaining);
          break;
        }
        let cutAt = remaining.lastIndexOf(' ', 157);
        if (cutAt <= 0) cutAt = 157;
        parts.push(remaining.slice(0, cutAt));
        remaining = remaining.slice(cutAt).trim();
      }
      responseText = parts.join('\n');
    }

    res.set('Content-Type', 'text/plain');
    res.send(responseText);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'SMS webhook error');
    res.status(500).json({ error: 'Internal error' });
  }
}

export async function handleWhatsAppWebhook(req: Request, res: Response) {
  try {
    const { From, Body, NumMedia, MediaUrl0, MediaContentType0 } = req.body;

    if (!From) {
      return res.status(400).json({ error: 'Missing From' });
    }

    const db = getDb();
    const phoneHash = crypto.createHash('sha256').update(From).digest('hex');

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

    let responseText = '';

    if (NumMedia > 0 && MediaUrl0) {
      responseText = 'Document receive ho gaya hai. Main ise analyze kar raha hoon. Kripya thoda intezar karein.';
    } else if (Body) {
      const passages = await retrieve(Body, undefined, 5, 0.2);
      const caseFacts: Array<{ key: string; value: string }> = [];

      const result = await generateAnswer(Body, {
        language,
        passages,
        caseFacts,
        history: [],
      });

      responseText = result.answer;

      try {
        const cid = null;
        if (cid) {
          const newFacts = await extractFacts(Body, result.answer, []);
          if (newFacts.length > 0) {
            await saveFacts(cid, newFacts);
          }
        }
      } catch (e) {}
    }

    res.json({
      response: responseText,
      sessionId: session.id,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'WhatsApp webhook error');
    res.status(500).json({ error: 'Internal error' });
  }
}
