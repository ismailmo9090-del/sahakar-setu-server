import { describe, it, expect } from 'vitest';
import { extractCitations, hasCitations } from '../../src/utils/citation.js';

describe('Citation Utils', () => {
  it('should extract citations', () => {
    const text = 'This is stated in [Source: MSCS Act, Section 32(2)] and also in [Source: PMFBY, Rule 5]';
    const citations = extractCitations(text);
    expect(citations).toHaveLength(2);
    expect(citations[0]).toBe('MSCS Act, Section 32(2)');
  });

  it('should return empty for no citations', () => {
    const text = 'No citations here';
    const citations = extractCitations(text);
    expect(citations).toHaveLength(0);
  });

  it('should detect presence of citations', () => {
    expect(hasCitations('[Source: Test, Section 1]')).toBe(true);
    expect(hasCitations('No citations')).toBe(false);
  });
});
