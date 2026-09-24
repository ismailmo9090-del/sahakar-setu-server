export const CHANNELS = ['web', 'kiosk', 'whatsapp', 'sms', 'ivr'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CASE_STATUSES = ['open', 'pending', 'escalated', 'resolved', 'closed'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_CATEGORIES = ['laws', 'schemes', 'pacs', 'pmfby', 'grievance', 'financial'] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export const GRIEVANCE_STATUSES = ['drafted', 'submitted', 'acknowledged', 'escalated', 'resolved'] as const;

export const GRIEVANCE_CATEGORIES = [
  'society_pacs',
  'cooperative_bank',
  'insurance_pmfby',
  'registrar_level',
  'election',
] as const;

export const ESCALATION_STEPS = [
  { step: 1, authority: 'Society / PACS Management Committee', deadlineDays: 15 },
  { step: 2, authority: 'Registrar of Cooperative Societies', deadlineDays: 30 },
  { step: 3, authority: 'Insurance Ombudsman', deadlineDays: null },
  { step: 4, authority: 'Legal Aid (NALSA / DLSA)', deadlineDays: null },
] as const;

export const RAG_CONFIG = {
  TOP_K: 5,
  THRESHOLD: 0.75,
  EMBEDDING_DIM: 384,
} as const;

export const VERDICT_BANDS = {
  WEAK: { min: 0, max: 29, label: 'weak' },
  NEEDS_EVIDENCE: { min: 30, max: 59, label: 'needs_evidence' },
  STRONG_PRELIMINARY: { min: 60, max: 79, label: 'strong_preliminary' },
  STRONG: { min: 80, max: 100, label: 'strong' },
} as const;

export const SUPPORTED_LANGUAGES = ['hi', 'hi-Latn', 'en', 'mr', 'te', 'ta', 'bn', 'or', 'pa'] as const;

export const TTS_VOICE_MAP: Record<string, string> = {
  hi: 'hi-IN-MadhurNeural',
  en: 'en-IN-NeerjaNeural',
  mr: 'mr-IN-AarohiNeural',
  bn: 'bn-IN-TanishaaNeural',
  ta: 'ta-IN-PallaviNeural',
  te: 'te-IN-ShrutiNeural',
};
