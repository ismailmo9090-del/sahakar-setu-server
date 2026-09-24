import { LanguageDetectionResult } from '../../types/index.js';

const LANG_MAP: Record<string, string> = {
  hin: 'hi',
  eng: 'en',
  mar: 'mr',
  tel: 'te',
  tam: 'ta',
  ben: 'bn',
  ori: 'or',
  pan: 'pa',
};

const HINGLISH_WORDS = [
  'kya', 'hai', 'kaise', 'kahan', 'mera', 'aap', 'nahi', 'haan', 'karo', 'batao',
  'yeh', 'woh', 'kuch', 'sab', 'apna', 'unka', 'hamara', 'tumhara', 'kaun', 'kab',
  'kyun', 'bahut', 'accha', 'bura', 'chota', 'bada', 'lamba', 'ghar', 'kaam', 'paise',
];

export function detectLanguage(text: string): LanguageDetectionResult {
  if (!text || text.trim().length === 0) {
    return { language: 'hi', confidence: 0.5, isCodeMixed: false };
  }

  const devanagariRatio = (text.match(/[\u0900-\u097F]/g) || []).length / text.length;

  if (devanagariRatio > 0.3) {
    return { language: 'hi', confidence: 0.95, isCodeMixed: false };
  }

  const words = text.toLowerCase().split(/\s+/);
  const hinglishMatches = words.filter(w => HINGLISH_WORDS.includes(w)).length;
  const hinglishRatio = hinglishMatches / words.length;

  if (hinglishRatio > 0.3) {
    return { language: 'hi-Latn', confidence: 0.85, isCodeMixed: true };
  }

  const latinChars = (text.match(/[a-zA-Z]/g) || []).length / text.length;
  if (latinChars > 0.7) {
    return { language: 'en', confidence: 0.8, isCodeMixed: false };
  }

  return { language: 'hi', confidence: 0.6, isCodeMixed: false };
}

export function getLanguageName(code: string): string {
  const names: Record<string, string> = {
    hi: 'Hindi',
    'hi-Latn': 'Hinglish',
    en: 'English',
    mr: 'Marathi',
    te: 'Telugu',
    ta: 'Tamil',
    bn: 'Bengali',
    or: 'Odia',
    pa: 'Punjabi',
  };
  return names[code] || code;
}
