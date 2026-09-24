import { retrieve } from '../rag/retriever.js';
import { LLMContext } from '../../types/index.js';
import { generateAnswer } from '../llm/groq.js';
import { logger } from '../../config/logger.js';

export function calculatePremium(
  crop: string,
  season: 'kharif' | 'rabi' | 'commercial',
  sumInsured: number
): { farmerShare: number; govtShare: number; rate: number } {
  const rates = { kharif: 0.02, rabi: 0.015, commercial: 0.05 };
  const rate = rates[season];
  const farmerShare = sumInsured * rate;
  return { farmerShare, govtShare: sumInsured - farmerShare, rate };
}

export async function handlePMFBYQuery(
  query: string,
  language: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  caseFacts: Array<{ key: string; value: string }> = []
): Promise<{ answer: string; citations: string[] }> {
  const passages = await retrieve(query, 'pmfby', 5, 0.2);

  const ctx: LLMContext = {
    language,
    passages,
    caseFacts,
    history,
  };

  const result = await generateAnswer(query, ctx);
  logger.info({ citations: result.citations.length, model: result.model }, 'PMFBY query answered');

  return { answer: result.answer, citations: result.citations };
}
