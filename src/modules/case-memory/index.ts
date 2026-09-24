import { getDb } from '../../db/client.js';
import { getEnv } from '../../config/env.js';
import { Fact, NewFact } from '../../types/index.js';
import { logger } from '../../config/logger.js';

export async function extractFacts(
  userMessage: string,
  assistantMessage: string,
  existingFacts: Fact[]
): Promise<NewFact[]> {
  const env = getEnv();
  const client = new (await import('openai')).default({
    apiKey: env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  const prompt = `Extract confirmed facts from this exchange. Only extract facts the user explicitly stated.
Return JSON array: [{"key":"name","value":"Ramesh"},...]
Valid keys: name, village, district, pacs, membership_no, loss_date, loss_type, crop, amount, application_date, receipt_no, issue_date, documents_available.

Exchange:
User: ${userMessage}
Assistant: ${assistantMessage}
Existing facts: ${JSON.stringify(existingFacts)}

Return only JSON, no explanation.`;

  try {
    const response = await client.chat.completions.create({
      model: env.GROQ_MODEL_FALLBACK,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    });

    const content = response.choices[0].message.content || '[]';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch (err) {
    logger.error({ err }, 'Fact extraction failed');
    return [];
  }
}

export async function saveFacts(caseId: string, facts: NewFact[]): Promise<void> {
  const db = getDb();

  for (const fact of facts) {
    const { error } = await db.from('facts').insert({
      case_id: caseId,
      fact_key: fact.key,
      fact_value: fact.value,
      confirmed: false,
    });

    if (error) {
      logger.error({ error, fact }, 'Failed to save fact');
    }
  }
}

export async function getCaseFacts(caseId: string): Promise<Fact[]> {
  const db = getDb();

  const { data, error } = await db
    .from('facts')
    .select('*')
    .eq('case_id', caseId);

  if (error) {
    logger.error({ error }, 'Failed to get case facts');
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    caseId: row.case_id,
    factKey: row.fact_key,
    factValue: row.fact_value,
    sourceTurn: row.source_turn,
    confirmed: row.confirmed,
  }));
}

export async function confirmFact(factId: string): Promise<void> {
  const db = getDb();

  const { error } = await db
    .from('facts')
    .update({ confirmed: true })
    .eq('id', factId);

  if (error) {
    logger.error({ error }, 'Failed to confirm fact');
  }
}
