import { describe, it, expect } from 'vitest';
import { retrieve } from '../../src/modules/rag/retriever.js';
import { generateAnswer, BOUNDARY_MESSAGE } from '../../src/modules/llm/groq.js';

async function ask(query: string, language = 'hi') {
  const passages = await retrieve(query, undefined, 5, 0.2);
  return generateAnswer(query, { language, passages, caseFacts: [], history: [] });
}

describe('Domain boundary — out-of-domain refusals', () => {
  const outOfDomain = [
    'Who won the last cricket world cup?',
    'Delhi ka mausam aaj kaisa hai?',
    'Python programming kaise seekhein?',
    'Ek joke sunao yaar',
    'Aaj Bollywood mein kya chal raha hai?',
    'Cricket ke kitne over hote hain?',
    'Tumhari pasandida film kaun si hai?',
  ];

  for (const q of outOfDomain) {
    it(`refuses exactly: ${q}`, async () => {
      const r = await ask(q);
      expect(r.answer.trim()).toBe(BOUNDARY_MESSAGE);
    }, 30000);
  }
});

describe('Domain boundary — in-domain answers pass', () => {
  const inDomain = ['PMFBY kya hai?', 'Sahakari samiti mein shikayat kaise darj karein?'];

  for (const q of inDomain) {
    it(`answers with citation: ${q}`, async () => {
      const r = await ask(q);
      expect(r.answer.trim()).not.toBe(BOUNDARY_MESSAGE);
      expect(r.answer).not.toContain('Mere paas iska verified jawab nahi hai');
      expect(r.citations.length).toBeGreaterThan(0);
    }, 30000);
  }
});
