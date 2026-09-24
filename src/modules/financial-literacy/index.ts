import { logger } from '../../config/logger.js';
import { retrieve } from '../rag/retriever.js';
import { generateAnswer } from '../llm/groq.js';
import { LLMContext } from '../../types/index.js';

interface Lesson {
  id: string;
  title: string;
  duration: string;
  description: string;
  audioPath?: string;
}

const LESSONS: Lesson[] = [
  { id: 'interest-emi', title: 'Interest aur EMI basics', duration: '3 min', description: 'Samajhdari se loan lein' },
  { id: 'savings', title: 'Savings: kyun aur kahan', duration: '3 min', description: 'Bachat kaise karein' },
  { id: 'insurance-farming', title: 'Insurance basics for farming household', duration: '4 min', description: 'Fasal aur jeevan bima' },
  { id: 'pension', title: 'Pension basics (APY / PM-SYM)', duration: '3 min', description: 'Budhapa suraksha' },
  { id: 'shg-cooperative', title: 'SHG vs Cooperative Bank vs Moneylender', duration: '5 min', description: 'Sahi jagah se loan lein' },
  { id: 'digital-banking', title: 'Digital banking safety', duration: '3 min', description: 'Online transaction suraksha' },
  { id: 'tax-basics', title: 'Tax basics for farmers', duration: '4 min', description: 'Kisan ke liye tax jaankari' },
  { id: 'land-records', title: 'Land records samajhna', duration: '3 min', description: 'Khata, Khesra, Dag kya hai' },
];

export function getAvailableLessons(): Lesson[] {
  return LESSONS;
}

export function getLessonById(id: string): Lesson | undefined {
  return LESSONS.find(l => l.id === id);
}

export function calculateEMI(principal: number, annualRate: number, tenureMonths: number): { emi: number; totalInterest: number; totalPayment: number } {
  const monthlyRate = annualRate / 12 / 100;
  if (monthlyRate === 0) {
    const emi = principal / tenureMonths;
    return { emi, totalInterest: 0, totalPayment: principal };
  }
  const emi = principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths) / (Math.pow(1 + monthlyRate, tenureMonths) - 1);
  const totalPayment = emi * tenureMonths;
  const totalInterest = totalPayment - principal;
  return { emi, totalInterest, totalPayment };
}

export function calculateCompoundInterest(principal: number, annualRate: number, years: number): { amount: number; interest: number } {
  const rate = annualRate / 100;
  const amount = principal * Math.pow(1 + rate, years);
  return { amount, interest: amount - principal };
}

export async function handleFinancialQuery(
  query: string,
  language: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  caseFacts: Array<{ key: string; value: string }> = []
): Promise<{ answer: string; citations: string[] }> {
  const passages = await retrieve(query, 'financial', 5, 0.2);

  const ctx: LLMContext = {
    language,
    passages,
    caseFacts,
    history,
  };

  const result = await generateAnswer(query, ctx);
  logger.info({ citations: result.citations.length, model: result.model }, 'Financial query answered');

  return { answer: result.answer, citations: result.citations };
}
