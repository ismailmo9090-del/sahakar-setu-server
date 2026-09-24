import { retrieve } from '../rag/retriever.js';
import { LLMContext } from '../../types/index.js';
import { generateAnswer } from '../llm/groq.js';
import { logger } from '../../config/logger.js';

interface Question {
  id: string;
  text: string;
  type: 'number' | 'boolean' | 'choice' | 'text';
  options?: string[];
}

interface SchemeRule {
  scheme: string;
  description: string;
  questions: Question[];
  evaluate: (answers: Record<string, any>) => { eligible: boolean; reason: string; docs: string[] };
}

const SCHEME_RULES: SchemeRule[] = [
  {
    scheme: 'Yuva Sahakar',
    description: 'NCDC scheme for young cooperative entrepreneurs',
    questions: [
      { id: 'age', text: 'Aapki umar kitni hai?', type: 'number' },
      { id: 'cooperative', text: 'Kya aap kisi cooperative ke member hain?', type: 'boolean' },
      { id: 'enterprise', text: 'Kya aap enterprise start karna chahte hain?', type: 'boolean' },
      { id: 'sector', text: 'Kis sector mein? (agri/dairy/fishery/other)', type: 'choice', options: ['agri', 'dairy', 'fishery', 'other'] },
    ],
    evaluate: (a) => {
      if (a.age < 18 || a.age > 45) return { eligible: false, reason: 'Age must be 18-45', docs: [] };
      if (!a.cooperative) return { eligible: false, reason: 'Must be cooperative member', docs: [] };
      return { eligible: true, reason: 'Eligible', docs: ['Aadhaar', 'Cooperative membership proof', 'Project proposal', 'Bank details'] };
    },
  },
  {
    scheme: 'Sahakar Mitra',
    description: 'NCDC internship support for cooperative sector',
    questions: [
      { id: 'age', text: 'Aapki umar kitni hai?', type: 'number' },
      { id: 'education', text: 'Aapki highest qualification kya hai?', type: 'choice', options: ['graduate', 'postgraduate', 'diploma'] },
      { id: 'cooperative', text: 'Kya aap kisi cooperative ke member hain?', type: 'boolean' },
    ],
    evaluate: (a) => {
      if (a.age < 18 || a.age > 30) return { eligible: false, reason: 'Age must be 18-30', docs: [] };
      if (!a.education || a.education === 'diploma') return { eligible: false, reason: 'Must be graduate or postgraduate', docs: [] };
      return { eligible: true, reason: 'Eligible', docs: ['Aadhaar', 'Education certificates', 'Cooperative membership proof'] };
    },
  },
];

export function getAvailableSchemes() {
  return SCHEME_RULES.map(s => ({
    scheme: s.scheme,
    description: s.description,
    questions: s.questions,
  }));
}

export function checkEligibility(scheme: string, answers: Record<string, any>) {
  const rule = SCHEME_RULES.find(s => s.scheme.toLowerCase() === scheme.toLowerCase());
  if (!rule) {
    return { eligible: false, reason: 'Scheme not found', docs: [] };
  }
  return rule.evaluate(answers);
}

export async function handleSchemesQuery(
  query: string,
  language: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  caseFacts: Array<{ key: string; value: string }> = []
): Promise<{ answer: string; citations: string[] }> {
  const passages = await retrieve(query, 'schemes', 5, 0.2);

  const ctx: LLMContext = {
    language,
    passages,
    caseFacts,
    history,
  };

  const result = await generateAnswer(query, ctx);
  logger.info({ citations: result.citations.length, model: result.model }, 'Schemes query answered');

  return { answer: result.answer, citations: result.citations };
}
