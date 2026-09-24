import { describe, it, expect } from 'vitest';
import { calculatePremium } from '../../src/modules/pmfby/index.js';

describe('PMFBY Premium Calculator', () => {
  it('should calculate Kharif premium (2%)', () => {
    const result = calculatePremium('Rice', 'kharif', 100000);
    expect(result.rate).toBe(0.02);
    expect(result.farmerShare).toBe(2000);
    expect(result.govtShare).toBe(98000);
  });

  it('should calculate Rabi premium (1.5%)', () => {
    const result = calculatePremium('Wheat', 'rabi', 100000);
    expect(result.rate).toBe(0.015);
    expect(result.farmerShare).toBe(1500);
    expect(result.govtShare).toBe(98500);
  });

  it('should calculate Commercial premium (5%)', () => {
    const result = calculatePremium('Cotton', 'commercial', 100000);
    expect(result.rate).toBe(0.05);
    expect(result.farmerShare).toBe(5000);
    expect(result.govtShare).toBe(95000);
  });
});
