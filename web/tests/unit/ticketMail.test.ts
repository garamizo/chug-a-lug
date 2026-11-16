import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const { codeMail } = createRequire(import.meta.url)('../../../pocketbase/pb_hooks/ticketMail.js');

// Spec 2026-11-15-festive-ticket-mail-design.md: the boarding-code email is a gold ticket. A leading
// zero must survive as six characters everywhere the code appears.
describe('boarding-code ticket mail', () => {
  const m = codeMail('a@b.invalid', '012345');

  it('addresses the one recipient', () => { expect(m.to).toEqual(['a@b.invalid']); });

  it('leads the subject with the code', () => { expect(m.subject).toBe('012345 is your Chug-a-Lug boarding code'); });

  it('keeps the plain-text wording exactly', () => {
    expect(m.text).toBe('Your Chug-a-Lug boarding code: 012345\n\nIt works for 15 minutes.');
  });

  it('shows the code as one unbroken run in the visible code element', () => {
    expect(/data-code[^>]*>([^<]*)</.exec(m.html)?.[1]).toBe('012345');
  });

  it('puts the code in the hidden preheader', () => {
    expect(/<[^>]*display:none[^>]*>([^<]*)</.exec(m.html)?.[1]).toContain('012345');
  });

  it('looks like the ticket: copy, gold, both notches, phone width', () => {
    for (const s of ['BOARDING CODE · ADMIT ONE', 'VALID 15 MIN', 'CHUG-A-LUG CHOO-CHOO', '#ffb400',
      'border-radius:0 10px 10px 0', 'border-radius:10px 0 0 10px', 'max-width:360px', '2px dashed #8a6a1c']) {
      expect(m.html).toContain(s);
    }
  });

  it('loads nothing from outside', () => {
    expect(m.html).not.toContain('<img');
    expect(m.html).not.toContain('http');
  });
});
