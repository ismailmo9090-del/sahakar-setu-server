import { describe, it, expect } from 'vitest';
import { computeVerdict } from '../../src/modules/verdict/index.js';
import { CaseData } from '../../src/types/index.js';

describe('Verdict Engine', () => {
  it('should compute weak verdict for empty case', () => {
    const caseData: CaseData = {
      id: '1',
      sessionId: '1',
      category: 'laws',
      status: 'open',
      strengthScore: 0,
      language: 'hi',
      facts: [],
      documents: [],
      retrievedPassages: [],
      daysSinceSubmission: 0,
    };

    const verdict = computeVerdict(caseData);
    expect(verdict.band).toBe('weak');
    expect(verdict.score).toBeLessThan(30);
  });

  it('should compute strong verdict for complete case', () => {
    const caseData: CaseData = {
      id: '1',
      sessionId: '1',
      category: 'pmfby',
      status: 'open',
      strengthScore: 0,
      language: 'hi',
      facts: [
        { id: '1', caseId: '1', factKey: 'name', factValue: 'Ramesh', confirmed: true },
        { id: '2', caseId: '1', factKey: 'village', factValue: 'Sitapur', confirmed: true },
        { id: '3', caseId: '1', factKey: 'pacs', factValue: 'PACS Sadar', confirmed: true },
        { id: '4', caseId: '1', factKey: 'loss_date', factValue: '2026-01-15', confirmed: true },
      ],
      documents: [
        { id: '1', caseId: '1', docType: 'land_record', storagePath: '/tmp/test' },
        { id: '2', caseId: '1', docType: 'sowing_cert', storagePath: '/tmp/test2' },
      ],
      retrievedPassages: [
        { id: '1', sourceDoc: 'PMFBY', sectionRef: 'Section 1', text: 'Test', similarity: 0.9 },
        { id: '2', sourceDoc: 'PMFBY', sectionRef: 'Section 2', text: 'Test2', similarity: 0.85 },
        { id: '3', sourceDoc: 'PMFBY', sectionRef: 'Section 3', text: 'Test3', similarity: 0.8 },
      ],
      daysSinceSubmission: 20,
    };

    const verdict = computeVerdict(caseData);
    expect(verdict.score).toBeGreaterThan(60);
  });
});
