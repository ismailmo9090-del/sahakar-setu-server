import { retrieve } from '../rag/retriever.js';
import { LLMContext, RetrievedPassage } from '../../types/index.js';
import { generateAnswer } from '../llm/groq.js';
import { logger } from '../../config/logger.js';

export async function handleLawsQuery(
  query: string,
  language: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  caseFacts: Array<{ key: string; value: string }> = []
): Promise<{ answer: string; citations: string[] }> {
  const passages = await retrieve(query, 'laws', 5, 0.2);

  const ctx: LLMContext = {
    language,
    passages,
    caseFacts,
    history,
  };

  const result = await generateAnswer(query, ctx);
  logger.info({ citations: result.citations.length, model: result.model }, 'Laws query answered');

  return { answer: result.answer, citations: result.citations };
}
