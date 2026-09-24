import { CaseData, Verdict } from '../../types/index.js';
import { VERDICT_BANDS } from '../../config/constants.js';

export function computeVerdict(caseData: CaseData): Verdict {
  let score = 0;
  score += scoreFacts(caseData.facts);
  score += scoreDocuments(caseData.documents, caseData.category);
  score += scoreLegalBasis(caseData.retrievedPassages);
  score += scoreTimeline(caseData.facts, caseData.category);
  score += scorePriorAction(caseData.facts);

  score = Math.min(100, Math.max(0, score));

  const band = getBand(score);
  return { score, band, message: getVerdictMessage(band, caseData) };
}

function scoreFacts(facts: any[]): number {
  const requiredKeys = ['name', 'village', 'pacs'];
  const presentKeys = facts.map(f => f.factKey || f.fact_key);
  const present = requiredKeys.filter(k => presentKeys.includes(k));
  return (present.length / requiredKeys.length) * 25;
}

function scoreDocuments(documents: any[], category: string): number {
  const requiredDocs: Record<string, string[]> = {
    pmfby: ['land_record', 'sowing_cert'],
    grievance: ['notice'],
    laws: [],
    schemes: [],
    pacs: [],
    financial: [],
  };

  const required = requiredDocs[category] || [];
  if (required.length === 0) return 0;

  const uploaded = documents.map(d => d.doc_type);
  const present = required.filter(d => uploaded.includes(d));
  return (present.length / required.length) * 25;
}

function scoreLegalBasis(passages: any[]): number {
  if (passages.length === 0) return 0;
  if (passages.length >= 3) return 25;
  return (passages.length / 3) * 25;
}

function scoreTimeline(facts: any[], category: string): number {
  const hasDate = facts.some(f => (f.factKey || f.fact_key) === 'loss_date' || (f.factKey || f.fact_key) === 'application_date');
  if (hasDate) return 15;
  return 5;
}

function scorePriorAction(facts: any[]): number {
  const hasIssueDate = facts.some(f => (f.factKey || f.fact_key) === 'issue_date');
  if (hasIssueDate) return 10;
  return 0;
}

function getBand(score: number): string {
  if (score < VERDICT_BANDS.WEAK.max + 1) return 'weak';
  if (score < VERDICT_BANDS.NEEDS_EVIDENCE.max + 1) return 'needs_evidence';
  if (score < VERDICT_BANDS.STRONG_PRELIMINARY.max + 1) return 'strong_preliminary';
  return 'strong';
}

function getVerdictMessage(band: string, data: CaseData): string {
  const missing = getMissingItems(data);
  switch (band) {
    case 'weak':
      return `Aapka case abhi kamzor hai. Yeh cheezein chahiye: ${missing.join(', ')}`;
    case 'needs_evidence':
      return `Case promising hai, lekin pehle yeh collect karein: ${missing.join(', ')}`;
    case 'strong_preliminary':
      return `Aapka case reasonably strong hai. Escalation ka rasta main bata sakta hoon.`;
    case 'strong':
      return `Aapka case strong hai. Draft taiyar hai. Escalation recommend karta hoon.`;
    default:
      return `Case ka assessment jaari hai.`;
  }
}

function getMissingItems(data: CaseData): string[] {
  const missing: string[] = [];
  const factKeys = data.facts.map(f => f.factKey);

  if (!factKeys.includes('name')) missing.push('naam');
  if (!factKeys.includes('village')) missing.push('gaon');
  if (!factKeys.includes('pacs')) missing.push('PACS details');
  if (data.documents.length === 0) missing.push('documents');

  return missing;
}
