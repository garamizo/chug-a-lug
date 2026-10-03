import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const { oauthDecision } = createRequire(import.meta.url)('../../../pocketbase/pb_hooks/crew.js');
const base = { isNewRecord: false, hasName: false, blocked: false, recordEmail: 'bob@example.com', oauthEmail: 'Bob@Example.com', oauthEmailVerified: true };

describe('oauthDecision (spec §2.5)', () => {
  it('refuses an unverified Google email first', () => expect(oauthDecision({ ...base, oauthEmailVerified: false })).toBe('refuse_unverified'));
  it('files a request for a new identity from the join page', () => expect(oauthDecision({ ...base, isNewRecord: true, hasName: true, recordEmail: '' })).toBe('request'));
  it('refuses a new identity from the login page', () => expect(oauthDecision({ ...base, isNewRecord: true, recordEmail: '' })).toBe('refuse_new'));
  it('refuses a blocked account', () => expect(oauthDecision({ ...base, blocked: true })).toBe('refuse_blocked'));
  it('refuses linking a different email (crew token + other Google account)', () =>
    expect(oauthDecision({ ...base, recordEmail: 'alice@example.com' })).toBe('refuse_mismatch'));
  it('continues for the matching email, ignoring case', () => expect(oauthDecision(base)).toBe('continue'));
});
