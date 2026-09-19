import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../../src/lib/phone';

describe('normalizePhone', () => {
  it('accepts common US formats', () => {
    expect(normalizePhone('(312) 555-0142')).toBe('+13125550142');
    expect(normalizePhone('312.555.0142')).toBe('+13125550142');
    expect(normalizePhone('1 312 555 0142')).toBe('+13125550142');
    expect(normalizePhone('+13125550142')).toBe('+13125550142');
  });
  it('rejects anything else', () => {
    expect(normalizePhone('555-0142')).toBeNull();
    expect(normalizePhone('+44 20 7946 0958')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});
