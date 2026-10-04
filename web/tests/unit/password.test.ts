import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { passwordProblem, resetTokenEmail } from '../../src/lib/password';
import { copy } from '../../src/lib/labels';
const server = createRequire(import.meta.url)('../../../pocketbase/pb_hooks/crew.js');

// Spec §3.2: code points (as PocketBase's password field counts) and bcrypt's 72 bytes. The server
// and the browser must agree, because /join installs the hash by SQL, skipping field validation.
const cases: Array<[string, unknown, boolean]> = [
  ['7 letters', 'a'.repeat(7), false],
  ['8 letters', 'a'.repeat(8), true],
  ['64 letters', 'a'.repeat(64), true],
  ['65 letters', 'a'.repeat(65), false],
  ['4 emoji: 8 UTF-16 units but 4 code points', '😀'.repeat(4), false],
  ['8 emoji: 32 bytes', '😀'.repeat(8), true],
  ['36 é: 72 bytes', 'é'.repeat(36), true],
  ['36 é and a letter: 73 bytes', 'é'.repeat(36) + 'a', false],
  ['24 €: 72 bytes', '€'.repeat(24), true],
  ['not a string', 12345678, false]
];

describe('passwordProblem (spec §3.2)', () => {
  for (const [what, p, ok] of cases) {
    it(`${what} → ${ok ? 'accepted' : 'refused'} by browser and server alike`, () => {
      expect(passwordProblem(p)).toBe(ok ? null : copy.passwordRule);
      expect(server.passwordProblem(p)).toBe(ok ? null : 'Pick a password of 8 to 64 characters.');
    });
  }
  it('the browser shows the server\'s words', () => expect(copy.passwordRule).toBe('Pick a password of 8 to 64 characters.'));
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
describe('resetTokenEmail (spec §2.3)', () => {
  it('reads the email claim', () => expect(resetTokenEmail(`${b64({ alg: 'HS256' })}.${b64({ email: 'rider@example.com', type: 'passwordReset' })}.sig`)).toBe('rider@example.com'));
  it('garbage is null', () => expect(resetTokenEmail('not-a-token')).toBeNull());
  it('no claim is null', () => expect(resetTokenEmail(`${b64({})}.${b64({ id: 'x' })}.sig`)).toBeNull());
});
