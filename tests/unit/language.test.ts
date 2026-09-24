import { describe, it, expect } from 'vitest';
import { detectLanguage } from '../../src/modules/language/detector.js';

describe('Language Detector', () => {
  it('should detect Hindi (Devanagari)', () => {
    const result = detectLanguage('नमस्ते, मेरा नाम राम है');
    expect(result.language).toBe('hi');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('should detect English', () => {
    const result = detectLanguage('Hello, how are you?');
    expect(result.language).toBe('en');
  });

  it('should detect Hinglish', () => {
    const result = detectLanguage('kya hai ye, mujhe nahi pata');
    expect(result.language).toBe('hi-Latn');
    expect(result.isCodeMixed).toBe(true);
  });

  it('should handle empty text', () => {
    const result = detectLanguage('');
    expect(result.language).toBe('hi');
  });
});
