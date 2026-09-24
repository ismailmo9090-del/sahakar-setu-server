import { WebSocket } from 'ws';
import { getDb } from '../../db/client.js';
import { VoskSTT } from '../../modules/stt/vosk.js';
import { EdgeTTS } from '../../modules/tts/edge.js';
import { detectLanguage } from '../../modules/language/detector.js';
import { retrieve } from '../../modules/rag/retriever.js';
import { generateAnswer } from '../../modules/llm/groq.js';
import { extractFacts, saveFacts, getCaseFacts } from '../../modules/case-memory/index.js';
import { logger } from '../../config/logger.js';

let stt: VoskSTT | null = null;
let tts: EdgeTTS | null = null;

function getSTT(): VoskSTT | null {
  if (!stt || !stt.isAlive()) {
    try {
      stt = new VoskSTT();
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize Vosk STT');
    }
  }
  return stt;
}

function getTTS(): EdgeTTS | null {
  if (!tts || !tts.isAlive()) {
    try {
      tts = new EdgeTTS();
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize Edge TTS');
    }
  }
  return tts;
}

const SILENCE_TIMEOUT_MS = 5000;

export function handleWebConnection(ws: WebSocket) {
  let sessionId: string | null = null;
  let caseId: string | null = null;
  let language = 'hi';
  let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAudioTime = Date.now();

  const sttInstance = getSTT();

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    lastAudioTime = Date.now();
    silenceTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'silence_prompt',
          text: 'Aap bol rahe the? Kripya dohrayein.',
          language,
        }));
      }
    }, SILENCE_TIMEOUT_MS);
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'start': {
          sessionId = msg.sessionId || null;
          caseId = msg.caseId || null;
          language = msg.language || 'hi';
          history = [];

          if (!sessionId) {
            const db = getDb();
            const { data: session } = await db.from('sessions').insert({
              channel: 'web',
              language,
            }).select('id').single();
            sessionId = session?.id;
          }

          ws.send(JSON.stringify({ type: 'started', sessionId, caseId }));
          break;
        }

        case 'audio': {
          if (sttInstance && sttInstance.isReady()) {
            sttInstance.sendAudio(msg.data);
            resetSilenceTimer();
          }
          break;
        }

        case 'text': {
          if (silenceTimer) clearTimeout(silenceTimer);

          const detected = detectLanguage(msg.text);
          language = detected.language;

          const passages = await retrieve(msg.text, undefined, 5, 0.2);
          const caseFacts = caseId ? await getCaseFacts(caseId) : [];

          const result = await generateAnswer(msg.text, {
            language,
            passages,
            caseFacts: caseFacts.map(f => ({ key: f.factKey, value: f.factValue })),
            history,
          });

          history.push({ role: 'user', content: msg.text });
          history.push({ role: 'assistant', content: result.answer });

          ws.send(JSON.stringify({
            type: 'response',
            text: result.answer,
            citations: result.citations,
            language,
          }));

          const newFacts = await extractFacts(msg.text, result.answer, caseFacts);
          if (newFacts.length > 0 && caseId) {
            await saveFacts(caseId, newFacts);
          }
          break;
        }
      }
    } catch (err) {
      logger.error({ err }, 'WS message error');
      ws.send(JSON.stringify({ type: 'error', message: 'Internal error' }));
    }
  });

  if (sttInstance) {
    sttInstance.on('final', async (msg: any) => {
      if (!ws.readyState || ws.readyState !== WebSocket.OPEN) return;

      if (silenceTimer) clearTimeout(silenceTimer);

      const passages = await retrieve(msg.text, undefined, 5, 0.2);
      const caseFacts = caseId ? await getCaseFacts(caseId) : [];

      const result = await generateAnswer(msg.text, {
        language,
        passages,
        caseFacts: caseFacts.map(f => ({ key: f.factKey, value: f.factValue })),
        history,
      });

      history.push({ role: 'user', content: msg.text });
      history.push({ role: 'assistant', content: result.answer });

      ws.send(JSON.stringify({
        type: 'response',
        text: result.answer,
        citations: result.citations,
        language,
      }));

      try {
        const ttsInstance = getTTS();
        if (ttsInstance) {
          const audio = await ttsInstance.synthesize(result.answer, language);
          ws.send(JSON.stringify({ type: 'audio', data: audio.toString('base64') }));
        }
      } catch (err) {
        logger.error({ err }, 'TTS failed');
      }

      const newFacts = await extractFacts(msg.text, result.answer, caseFacts);
      if (newFacts.length > 0 && caseId) {
        await saveFacts(caseId, newFacts);
      }
    });

    sttInstance.on('partial', (msg: any) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'partial_transcript', text: msg.text }));
        resetSilenceTimer();
      }
    });
  }

  ws.on('close', () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    logger.info({ sessionId }, 'Web WS connection closed');
  });
}
