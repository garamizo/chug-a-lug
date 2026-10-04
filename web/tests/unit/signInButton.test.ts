import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SignInButton from '../../src/lib/components/SignInButton.svelte';
import { ICONS } from '../../src/lib/icons';

const html = (props: Record<string, unknown>) => render(SignInButton, { props: props as never }).body;

describe('sign-in buttons', () => {
  it('Google carries the four-colour G mark beside its words', () => {
    const out = html({ provider: 'google', label: 'Continue with Google', testid: 'google' });
    for (const colour of ['#EA4335', '#4285F4', '#FBBC05', '#34A853']) expect(out).toContain(colour);
    expect(out).toContain('Continue with Google');
    expect(out).toContain('data-testid="google"');
    expect(out).toContain('type="button"');
  });
  it('email carries the envelope and can submit its form', () => {
    const out = html({ provider: 'email', label: 'Email me a code', type: 'submit', testid: 'send-code' });
    for (const d of ICONS.mail) expect(out).toContain(`d="${d}"`);
    expect(out).toContain('Email me a code');
    expect(out).toContain('type="submit"');
  });
  it('the marks are decoration: the words are the accessible name', () => {
    expect(html({ provider: 'google', label: 'x' })).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html({ provider: 'email', label: 'x' })).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});
