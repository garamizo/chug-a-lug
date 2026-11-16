import { describe, expect, it } from 'vitest';
import { formatInvite, formatInviteError } from '../../scripts/invite-format.mjs';

const expires_at = '2026-11-30T03:14:00.000Z';
const until = 'until Sun, Nov 29, 9:14 PM';

describe('formatInvite', () => {
  it('create prints the url and the seats', () => {
    expect(formatInvite('create', { url: 'https://x/join#abc', seats: 12, expires_at })).toBe(`https://x/join#abc\n12 seats, ${until}`);
  });
  it('status says what is left', () => {
    expect(formatInvite('status', { state: 'active', seats: 12, seats_left: 8, expires_at })).toBe(`8 of 12 seats left, ${until}`);
    expect(formatInvite('status', { state: 'expired', seats: 12, seats_left: 8, expires_at })).toBe('The join link expired.');
    expect(formatInvite('status', { state: 'full', seats: 12, seats_left: 0, expires_at })).toBe('The join link is full.');
    expect(formatInvite('status', { state: 'revoked', seats: 12, seats_left: 8, expires_at })).toBe('The join link was revoked.');
    expect(formatInvite('status', { state: 'none', seats: 0, seats_left: 0, expires_at: '' })).toBe('No join link yet. Run just invite <seats>.');
  });
  it('revoke says whether there was a link', () => {
    expect(formatInvite('revoke', { revoked: true })).toBe('Revoked.');
    expect(formatInvite('revoke', { revoked: false })).toBe('No link to revoke.');
  });
  it('a 404 points at the secret and the stack', () => {
    expect(formatInviteError(404, { message: 'Not found.' })).toBe('Not found. Check INTERNAL_SECRET in .env and that the stack is running (just up).');
    expect(formatInviteError(400, { message: 'Seats must be 1 to 100.' })).toBe('Seats must be 1 to 100.');
    expect(formatInviteError(500, {})).toBe('Request failed: 500');
  });
});
