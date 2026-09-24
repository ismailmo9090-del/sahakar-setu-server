import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../../db/client.js';
import { retrieve } from '../../modules/rag/retriever.js';
import { generateAnswer } from '../../modules/llm/groq.js';
import { extractFacts, saveFacts, getCaseFacts } from '../../modules/case-memory/index.js';
import { runSTT } from '../../modules/voice/routes.js';
import { detectLanguage } from '../../modules/language/detector.js';
import { ensureSessionByRef, storeTurn, endSession, countTurns, isUuid } from '../../modules/chat-log/index.js';
import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DECLINE = 'Mere paas iska verified jawab nahi hai.';

function extractCallId(body: any): string | null {
  const candidates = [
    body?.metadata?.call?.id,
    body?.metadata?.callId,
    body?.call?.id,
    body?.callId,
    body?.call_id,
    body?.user,
  ];
  for (const c of candidates) {
    if (isUuid(c)) return c;
  }
  const sys = Array.isArray(body?.messages)
    ? body.messages.find((m: any) => m?.role === 'system')
    : null;
  if (sys && typeof sys.content === 'string') {
    const m = sys.content.match(/callref["':=\s]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (m && isUuid(m[1])) return m[1];
  }
  return null;
}

function respondOpenAI(res: Response, content: string, stream: boolean, model: string) {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    res.write(chunk({ role: 'assistant', content }, null));
    res.write(chunk({}, 'stop'));
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  return res.json({
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

export async function handleVAPICustomLLM(req: Request, res: Response) {
  const start = Date.now();
  let stream = false;
  try {
    const env = getEnv();
    if (env.VAPI_LLM_SECRET) {
      const provided =
        (typeof req.params.secret === 'string' ? req.params.secret : '') ||
        (typeof req.query.key === 'string' ? req.query.key : '') ||
        (typeof req.headers.authorization === 'string' ? req.headers.authorization.replace(/^Bearer\s+/i, '') : '');
      if (provided !== env.VAPI_LLM_SECRET) {
        logger.warn({ ip: req.ip, path: req.path }, 'VAPI custom-LLM rejected: bad key');
        return res.status(401).json({ error: 'unauthorized' });
      }
    }
    const body = req.body || {};
    stream = body.stream === true;
    const messages: Array<{ role: string; content: unknown }> = Array.isArray(body.messages)
      ? body.messages
      : [];

    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const text = typeof lastUser?.content === 'string' ? lastUser.content.trim() : '';

    if (!text) {
      return respondOpenAI(res, 'Namaste! Main Sahakar Setu hoon.', stream, 'sahakar-setu');
    }

    const history = messages
      .slice(0, -1)
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-6)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));

    const detected = detectLanguage(text).language;
    const language = detected.startsWith('hi') ? 'hi' : detected;

    const callId = extractCallId(body);
    const sessionId = callId ? await ensureSessionByRef(`vapi:${callId}`, language) : null;
    await storeTurn(sessionId, 'user', text, { channel: 'ivr', language });

    const passages = await retrieve(text, undefined, 5, 0.2);
    const result = await generateAnswer(text, {
      language,
      passages,
      caseFacts: [],
      history,
      channel: 'ivr',
    });

    const answer = result.answer || DECLINE;
    await storeTurn(sessionId, 'assistant', answer, {
      channel: 'ivr',
      language,
      model: result.model,
      citations: result.citations,
      latencyMs: Date.now() - start,
    });

    logger.info({
      event: 'vapi_model_turn',
      language,
      callId,
      sessionId,
      bodyKeys: Object.keys(body),
      passages: passages.length,
      citations: result.citations.length,
      model: result.model,
      latencyMs: Date.now() - start,
    }, 'VAPI custom-LLM turn answered');

    return respondOpenAI(res, answer, stream, result.model);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'VAPI custom-LLM error');
    return respondOpenAI(res, DECLINE, stream, 'sahakar-setu');
  }
}

const callSessions = new Map<string, { sessionId: string; caseId: string; history: Array<{ role: 'user' | 'assistant'; content: string }>; language: string }>();

export async function handleVAPIWebhook(req: Request, res: Response) {
  try {
    const { event, call, transcript, message } = req.body;
    const msg = message && typeof message === 'object' ? message : null;

    // ---- Modern VAPI server-message format: { message: { type, call, ... } } ----
    if (msg && typeof msg.type === 'string') {
      const type = msg.type;
      const callId: string | null = isUuid(msg.call?.id) ? msg.call.id : null;

      if (type === 'assistant-request') {
        const env = getEnv();
        const serverUrl = env.VAPI_PUBLIC_BASE_URL || 'https://sahakar-setu-server.onrender.com';
        return res.status(200).json({
          assistant: {
            name: 'Sahakar Setu Male Assistant',
            firstMessage: 'नमस्ते भैया! मैं सहकार सेतु से बोल रहा हूँ। बताइए, आज आपकी क्या मदद करूँ?',
            transcriber: {
              provider: 'talkscriber',
              model: 'whisper',
              language: 'hi',
            },
            voice: {
              provider: 'vapi',
              voiceId: 'Naina',
              language: 'hi',
            },
            model: {
              provider: 'custom-llm',
              url: `${serverUrl}/webhook/vapi/chat/completions?key=${env.VAPI_LLM_SECRET || ''}`,
            },
          },
        });
      }

      if (type === 'end-of-call-report') {
        const sessionId = callId ? await ensureSessionByRef(`vapi:${callId}`, 'hi') : null;
        if (sessionId) {
          const existing = await countTurns(sessionId);
          const artifactMsgs: Array<{ role?: string; message?: string }> = Array.isArray(msg.artifact?.messages)
            ? msg.artifact.messages
            : [];
          if (existing === 0 && artifactMsgs.length > 0) {
            for (const am of artifactMsgs) {
              const rawRole = typeof am.role === 'string' ? am.role.toLowerCase() : '';
              const role = rawRole === 'user' || rawRole === 'assistant' || rawRole === 'bot'
                ? (rawRole === 'user' ? 'user' as const : 'assistant' as const)
                : null;
              if (role && typeof am.message === 'string' && am.message) {
                await storeTurn(sessionId, role, am.message, { channel: 'ivr', source: 'end-of-call-report' });
              }
            }
          }
          await endSession(sessionId);
        }
        logger.info({ callId, sessionId, endedReason: msg.endedReason }, 'VAPI end-of-call-report');
        return res.status(200).json({});
      }

      if (type === 'status-update' && msg.status === 'ended' && callId) {
        const sessionId = await ensureSessionByRef(`vapi:${callId}`, 'hi');
        if (sessionId) await endSession(sessionId);
        logger.info({ callId, sessionId }, 'VAPI call status ended');
        return res.status(200).json({});
      }

      // informational events (transcript, speech-update, conversation-update, hang, ...)
      return res.status(200).json({});
    }

    // ---- Legacy format: { event: 'call.started' | 'call.ended' | ... } ----
    if (event === 'call.started') {
      const db = getDb();
      const language = call?.language || call?.assistant?.language || 'hi';

      const { data: session } = await db.from('sessions').insert({
        channel: 'ivr',
        language,
      }).select('id').single();

      let caseId = null;
      if (session) {
        const { data: newCase } = await db.from('cases').insert({
          session_id: session.id,
          category: 'laws',
          language,
        }).select('id').single();
        caseId = newCase?.id;
      }

      if (session) {
        callSessions.set(call?.id || 'unknown', {
          sessionId: session.id,
          caseId: caseId || '',
          history: [],
          language,
        });
      }

      logger.info({ callId: call?.id, sessionId: session?.id }, 'VAPI call started');
      return res.status(200).json({ status: 'ok' });
    }

    if (event === 'call.ended') {
      const sessionData = callSessions.get(call?.id || 'unknown');
      callSessions.delete(call?.id || 'unknown');

      logger.info({
        callId: call?.id,
        duration: call?.duration,
        sessionId: sessionData?.sessionId,
      }, 'VAPI call ended');
      return res.status(200).json({ status: 'ok' });
    }

    if (event === 'transcript.ready' || event === 'function-call' || message) {
      const text = transcript?.text || message?.content || req.body.transcript || '';

      if (!text) {
        return res.status(200).json({ action: 'respond', response: '' });
      }

      const sessionData = callSessions.get(call?.id || 'unknown');
      const language = sessionData?.language || call?.language || 'hi';

      const caseFacts = sessionData?.caseId
        ? await getCaseFacts(sessionData.caseId)
        : [];

      const passages = await retrieve(text, undefined, 5, 0.2);

      const result = await generateAnswer(text, {
        language,
        passages,
        caseFacts: caseFacts.map(f => ({ key: f.factKey, value: f.factValue })),
        history: sessionData?.history.slice(-6) || [],
        channel: 'ivr',
      });

      const answerText = result.answer || 'Mujhe samajh nahi aaya. Kripya dohrayein.';

      if (sessionData) {
        sessionData.history.push({ role: 'user', content: text });
        sessionData.history.push({ role: 'assistant', content: answerText });

        try {
          const newFacts = await extractFacts(text, result.answer, caseFacts);
          if (newFacts.length > 0 && sessionData.caseId) {
            await saveFacts(sessionData.caseId, newFacts);
          }
        } catch (e) {
          logger.warn({ err: e }, 'VAPI fact extraction failed');
        }
      }

      return res.json({
        action: 'respond',
        response: answerText,
      });
    }

    res.status(200).json({ action: 'ignore' });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'VAPI webhook error');
    res.status(200).json({ action: 'respond', response: 'Mujhe samajh nahi aaya. Kripya dohrayein.' });
  }
}

export async function handleVAPITranscriber(req: Request, res: Response) {
  let tmpPath: string | null = null;
  try {
    const { audio, audio_format } = req.body;

    if (!audio) {
      return res.json({ transcript: '', is_final: false });
    }

    const tmpId = Date.now().toString();
    tmpPath = path.join(os.tmpdir(), `vapi_${tmpId}.wav`);

    const audioBuffer = Buffer.from(audio, 'base64');
    fs.writeFileSync(tmpPath, audioBuffer);

    const transcript = await runSTT(tmpPath, 'hi');

    return res.json({ transcript, is_final: true });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'VAPI transcriber error');
    return res.status(200).json({ transcript: '', is_final: false });
  } finally {
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch (e) {}
    }
  }
}
