import { describe, it, expect } from 'vitest';
import { normalizeText, truncateToWords, maskPhone } from '../../src/utils/text.js';

describe('Text Utils', () => {
  it('should normalize text', () => {
    expect(normalizeText('  Hello   World  ')).toBe('Hello World');
  });

  it('should truncate to words', () => {
    const text = 'one two three four five';
    expect(truncateToWords(text, 3)).toBe('one two three...');
  });

  it('should not truncate if within limit', () => {
    const text = 'one two';
    expect(truncateToWords(text, 5)).toBe('one two');
  });

  it('should mask phone number', () => {
    expect(maskPhone('9876543210')).toBe('98****10');
  });
});
