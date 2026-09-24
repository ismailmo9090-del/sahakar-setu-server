import { Router, Request, Response } from 'express';
import { getDb } from '../../db/client.js';
import { detectLanguage } from '../../modules/language/detector.js';
import { retrieve } from '../../modules/rag/retriever.js';
import { generateAnswer } from '../../modules/llm/groq.js';
import { extractFacts, saveFacts, getCaseFacts } from '../../modules/case-memory/index.js';
import { storeTurn, getRecentTurns } from '../../modules/chat-log/index.js';
import { VoskSTT } from '../../modules/stt/vosk.js';
import { EdgeTTS } from '../../modules/tts/edge.js';
import { getGttsTTS } from '../../modules/tts/gtts.js';
import { logger } from '../../config/logger.js';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const router = Router();

let sttInstance: VoskSTT | null = null;
let ttsInstance: EdgeTTS | null = null;

function getSTT(): VoskSTT {
  if (!sttInstance || !sttInstance.isAlive()) {
    sttInstance = new VoskSTT();
  }
  return sttInstance;
}

function getTTS(): EdgeTTS {
  if (!ttsInstance || !ttsInstance.isAlive()) {
    ttsInstance = new EdgeTTS();
  }
  return ttsInstance;
}

export function runSTT(wavPath: string, lang: string): Promise<string> {
  const stt = getSTT();
  return stt.transcribeWav(wavPath, lang, 20000);
}

export function runTTS(text: string, lang: string): Promise<Buffer> {
  const tts = getTTS();
  return tts.synthesize(text, lang);
}

// Pre-warm workers at boot: vosk model load (~5s) and edge-tts import happen
// once here instead of on the first user request.
getSTT();
getTTS();
getGttsTTS();

router.post('/voice', async (req: Request, res: Response) => {
  const start = Date.now();
  let tmpWavPath: string | null = null;

  try {
    const { audio, language: reqLang, sessionId, caseId } = req.body;

    if (!audio) {
      return res.status(400).json({ error: 'audio field required (base64 encoded WAV)' });
    }

    const tmpId = randomUUID();
    tmpWavPath = path.join(os.tmpdir(), `voice_${tmpId}.wav`);

    const audioBuffer = Buffer.from(audio, 'base64');
    fs.writeFileSync(tmpWavPath, audioBuffer);

    const sttStart = Date.now();
    const transcript = await runSTT(tmpWavPath, reqLang || 'hi');
    const sttLatency = Date.now() - sttStart;

    logger.info({ sttLatencyMs: sttLatency, size: audioBuffer.length }, 'STT completed');

    if (!transcript || transcript.trim().length === 0) {
      return res.status(200).json({
        transcript: '',
        answer: 'Mujhe aapki awaaz sunai nahi di. Kripya dohrayein.',
        audio: null,
        audioFormat: 'mp3',
        sessionId,
        caseId,
        language: reqLang || 'hi',
      });
    }

    const language = reqLang || detectLanguage(transcript).language;

    const db = getDb();

    let sid = sessionId;
    if (!sid) {
      const { data: session } = await db.from('sessions').insert({
        channel: 'voice',
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
    await storeTurn(sid ?? null, 'user', transcript, { channel: 'voice', language });
    const passages = await retrieve(transcript, undefined, 5, 0.2);

    const llmStart = Date.now();
    const result = await generateAnswer(transcript, {
      language,
      passages,
      caseFacts: caseFacts.map(f => ({ key: f.factKey, value: f.factValue })),
      history,
      channel: 'voice',
    });
    const llmLatency = Date.now() - llmStart;

    logger.info({ llmLatencyMs: llmLatency, model: result.model }, 'LLM answered');

    await storeTurn(sid ?? null, 'assistant', result.answer, {
      channel: 'voice',
      language,
      model: result.model,
      citations: result.citations,
    });

    if (cid) {
      extractFacts(transcript, result.answer, caseFacts)
        .then(async (newFacts) => {
          if (newFacts.length > 0) {
            await saveFacts(cid!, newFacts);
          }
        })
        .catch((e) => logger.warn({ err: e?.message }, 'Fact extraction skipped'));
    }

    let audioBase64: string | null = null;
    try {
      const ttsStart = Date.now();
      const ttsBuffer = await getTTS().synthesize(result.answer, language);
      const ttsLatency = Date.now() - ttsStart;
      audioBase64 = ttsBuffer.toString('base64');
      logger.info({ ttsLatencyMs: ttsLatency, audioSize: ttsBuffer.length }, 'TTS completed');
    } catch (ttsErr: any) {
      logger.warn({ err: ttsErr?.message }, 'TTS failed, returning text only');
    }

    const totalLatency = Date.now() - start;
    logger.info({ totalLatencyMs: totalLatency }, 'Voice request complete');

    res.json({
      transcript,
      answer: result.answer,
      citations: result.citations,
      audio: audioBase64,
      audioFormat: audioBase64 ? 'mp3' : null,
      sessionId: sid,
      caseId: cid,
      language,
    });
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack }, 'Voice endpoint error');
    res.status(500).json({ error: err?.message || 'Internal server error' });
  } finally {
    if (tmpWavPath && fs.existsSync(tmpWavPath)) {
      try { fs.unlinkSync(tmpWavPath); } catch (e) {}
    }
  }
});

router.post('/tts', async (req: Request, res: Response) => {
  try {
    const { text, language } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text field required' });
    }

    const start = Date.now();
    const audioBuffer = await getTTS().synthesize(text, language || 'hi');
    const latency = Date.now() - start;
    logger.info({ latencyMs: latency, size: audioBuffer.length }, 'TTS endpoint');

    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'TTS endpoint error');
    res.status(500).json({ error: err?.message || 'TTS failed' });
  }
});

router.post('/stt', async (req: Request, res: Response) => {
  let tmpPath: string | null = null;
  try {
    const { audio, language } = req.body;
    if (!audio) {
      return res.status(400).json({ error: 'audio field required (base64 WAV)' });
    }

    const tmpId = randomUUID();
    tmpPath = path.join(os.tmpdir(), `stt_${tmpId}.wav`);

    const audioBuffer = Buffer.from(audio, 'base64');
    fs.writeFileSync(tmpPath, audioBuffer);

    const transcript = await runSTT(tmpPath, language || 'hi');

    res.json({ transcript, language: language || 'hi' });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'STT endpoint error');
    res.status(500).json({ error: err?.message || 'STT failed' });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (e) {}
    }
  }
});

export default router;
