import Tesseract from 'tesseract.js';
import { retrieve } from '../rag/retriever.js';
import { DocumentAnalysis, NewFact } from '../../types/index.js';
import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export async function analyzeDocument(
  filePath: string,
  caseId: string,
  language: string
): Promise<DocumentAnalysis> {
  const { data: { text } } = await Tesseract.recognize(filePath, 'hin+eng');

  const passages = await retrieve(text.slice(0, 500), 'laws', 3, 0.6);

  const env = getEnv();
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  const prompt = `Analyze this document and provide:
1. Document type (FIR/sale deed/notice/land record)
2. Key dates
3. Key parties
4. Obligations or claims
5. Plain-language summary in ${language}
6. Relevant legal sections (from passages below)

DOCUMENT TEXT:
${text}

LEGAL PASSAGES:
${passages.map(p => `${p.sourceDoc} ${p.sectionRef}: ${p.text}`).join('\n')}`;

  const analysis = await client.chat.completions.create({
    model: env.GROQ_MODEL_PRIMARY,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
  });

  const summary = analysis.choices[0].message.content || '';

  const extractedFacts = extractFactsFromText(text);

  return {
    ocrText: text,
    summary,
    extractedFacts,
  };
}

function extractFactsFromText(text: string): NewFact[] {
  const facts: NewFact[] = [];

  const dateMatches = text.match(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/g) || [];
  dateMatches.forEach((date, i) => {
    facts.push({ key: `date_${i + 1}`, value: date });
  });

  const amountMatches = text.match(/₹\s*[\d,]+/g) || [];
  amountMatches.forEach((amount, i) => {
    facts.push({ key: `amount_${i + 1}`, value: amount });
  });

  return facts;
}
