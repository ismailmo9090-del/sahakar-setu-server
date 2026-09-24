import { retrieve } from '../rag/retriever.js';
import { LLMContext } from '../../types/index.js';
import { generateAnswer } from '../llm/groq.js';
import { logger } from '../../config/logger.js';

interface PACSService {
  name: string;
  description: string;
  dataNeeded: string[];
}

const PACS_SERVICES: PACSService[] = [
  { name: 'KCC (Kisan Credit Card)', description: 'Short-term crop loan', dataNeeded: ['Amount', 'Interest rate', 'Security', 'Repayment schedule'] },
  { name: 'Long-term Loan', description: 'Purpose, tenure, documents', dataNeeded: ['Purpose', 'Tenure', 'Documents required'] },
  { name: 'Savings Account', description: 'Rates, withdrawal, nomination', dataNeeded: ['Interest rates', 'Withdrawal rules', 'Nomination'] },
  { name: 'Fixed Deposit', description: 'Rates, tenure, premature withdrawal', dataNeeded: ['Interest rates', 'Tenure options', 'Premature withdrawal rules'] },
  { name: 'Khaad Booking', description: 'Season, quantity, price', dataNeeded: ['Season', 'Quantity', 'Price'] },
  { name: 'Beej Booking', description: 'Crop, variety, quantity', dataNeeded: ['Crop', 'Variety', 'Quantity'] },
  { name: 'Pesticide Guidance', description: 'Crop, pest, dosage', dataNeeded: ['Crop', 'Pest', 'Dosage'] },
  { name: 'Scheme Disbursement', description: 'Scheme name, eligibility, status', dataNeeded: ['Scheme name', 'Eligibility', 'Status'] },
];

export function getAvailableServices() {
  return PACS_SERVICES;
}

export async function handlePACSQuery(
  query: string,
  language: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  caseFacts: Array<{ key: string; value: string }> = []
): Promise<{ answer: string; citations: string[] }> {
  const passages = await retrieve(query, 'pacs', 5, 0.2);

  const ctx: LLMContext = {
    language,
    passages,
    caseFacts,
    history,
  };

  const result = await generateAnswer(query, ctx);
  logger.info({ citations: result.citations.length, model: result.model }, 'PACS query answered');

  return { answer: result.answer, citations: result.citations };
}
