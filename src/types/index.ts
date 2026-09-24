import { z } from 'zod';

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  isCodeMixed: boolean;
}

export interface RetrievedPassage {
  id: string;
  sourceDoc: string;
  sectionRef: string;
  text: string;
  similarity: number;
}

export interface LLMContext {
  language: string;
  passages: RetrievedPassage[];
  caseFacts: Array<{ key: string; value: string }>;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  channel?: 'web' | 'kiosk' | 'whatsapp' | 'sms' | 'ivr' | 'voice' | string;
}

export interface LLMResult {
  answer: string;
  citations: string[];
  model: string;
}

export interface Fact {
  id: string;
  caseId: string;
  factKey: string;
  factValue: string;
  sourceTurn?: number;
  confirmed: boolean;
}

export interface NewFact {
  key: string;
  value: string;
}

export interface CaseData {
  id: string;
  sessionId: string;
  category: string;
  subcategory?: string;
  status: string;
  strengthScore: number;
  language: string;
  facts: Fact[];
  documents: DocumentData[];
  retrievedPassages: RetrievedPassage[];
  daysSinceSubmission: number;
}

export interface DocumentData {
  id: string;
  caseId: string;
  docType: string;
  originalFilename?: string;
  storagePath: string;
  ocrText?: string;
  analysisSummary?: string;
}

export interface Verdict {
  score: number;
  band: string;
  message: string;
}

export interface EscalationStep {
  step: number;
  authority: string;
  deadline: string;
  status: 'current' | 'completed' | 'pending';
  draftTemplate: string;
}

export interface DocumentAnalysis {
  ocrText: string;
  summary: string;
  extractedFacts: NewFact[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const ChatRequestSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().uuid().optional(),
  caseId: z.string().uuid().optional(),
  language: z.string().optional(),
  channel: z.enum(['web', 'kiosk', 'whatsapp', 'sms', 'ivr']).default('web'),
});

export const GrievanceDraftSchema = z.object({
  caseId: z.string().uuid(),
  category: z.string(),
  language: z.string().default('hi'),
});

export const TrackingIdSchema = z.object({
  trackingId: z.string().regex(/^SS-\d{4}-\d{6}$/),
});

export const DocumentUploadSchema = z.object({
  caseId: z.string().uuid(),
  docType: z.enum(['fir', 'sale_deed', 'notice', 'land_record', 'sowing_cert']),
  language: z.string().default('hi'),
});

export const SchemeEligibilitySchema = z.object({
  scheme: z.string(),
  answers: z.record(z.unknown()),
});

export const PremiumCalcSchema = z.object({
  crop: z.string(),
  season: z.enum(['kharif', 'rabi', 'commercial']),
  sumInsured: z.number().positive(),
});

export const EMICalcSchema = z.object({
  principal: z.number().positive(),
  annualRate: z.number().min(0).max(100),
  tenureMonths: z.number().positive().int(),
});
