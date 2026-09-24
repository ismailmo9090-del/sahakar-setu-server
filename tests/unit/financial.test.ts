import { describe, it, expect } from 'vitest';
import { calculateEMI, calculateCompoundInterest } from '../../src/modules/financial-literacy/index.js';

describe('Financial Calculators', () => {
  it('should calculate EMI correctly', () => {
    const result = calculateEMI(100000, 10, 12);
    expect(result.emi).toBeGreaterThan(0);
    expect(result.totalPayment).toBeGreaterThan(100000);
    expect(result.totalInterest).toBeGreaterThan(0);
  });

  it('should handle zero interest', () => {
    const result = calculateEMI(120000, 0, 12);
    expect(result.emi).toBe(10000);
    expect(result.totalInterest).toBe(0);
  });

  it('should calculate compound interest', () => {
    const result = calculateCompoundInterest(10000, 10, 2);
    expect(result.amount).toBeGreaterThan(10000);
    expect(result.interest).toBeGreaterThan(0);
  });
});
