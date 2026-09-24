import { describe, it, expect } from 'vitest';

describe('Chat Flow Integration', () => {
  it('should handle text chat end-to-end', async () => {
    const response = await fetch('http://localhost:3000/api/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Mera voting right hai kya?',
        channel: 'web',
        language: 'hi',
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.answer).toBeDefined();
    expect(data.sessionId).toBeDefined();

    const { getDb } = await import('../../src/db/client.js');
    const db = getDb();
    await db.from('sessions').delete().eq('id', data.sessionId);
  }, 30000);
});

describe('Grievance Flow Integration', () => {
  it('should generate grievance draft', async () => {
    const { getDb } = await import('../../src/db/client.js');
    const db = getDb();

    const { data: session } = await db.from('sessions').insert({ channel: 'web', language: 'hi' }).select('id').single();
    const { data: newCase } = await db
      .from('cases')
      .insert({ session_id: session.id, category: 'society_pacs', status: 'open', strength_score: 0, language: 'hi' })
      .select('id')
      .single();
    const caseId = newCase.id as string;

    await db.from('facts').insert([
      { case_id: caseId, fact_key: 'name', fact_value: 'Ramesh' },
      { case_id: caseId, fact_key: 'village', fact_value: 'Sitapur' },
      { case_id: caseId, fact_key: 'district', fact_value: 'Lucknow' },
    ]);

    try {
      const response = await fetch(`http://localhost:3000/api/v1/grievance/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId,
          category: 'society_pacs',
          language: 'hi',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.tracking_id).toBeDefined();
    } finally {
      await db.from('cases').delete().eq('id', caseId);
      await db.from('sessions').delete().eq('id', session.id);
    }
  }, 30000);
});

describe('Health Check', () => {
  it('should return health status', async () => {
    const response = await fetch('http://localhost:3000/health');
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.status).toBeDefined();
  });
});
