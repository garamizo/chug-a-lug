import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import PasswordInput from '../../src/lib/components/PasswordInput.svelte';
import { copy } from '../../src/lib/labels';

describe('PasswordInput', () => {
  it('starts hidden, with a Show toggle bound to the input', () => {
    const { body } = render(PasswordInput, { props: { id: 'pw', autocomplete: 'current-password', testid: 'password-input' } });
    expect(body).toContain('type="password"');
    expect(body).toContain('autocomplete="current-password"');
    expect(body).toContain('aria-pressed="false"');
    expect(body).toContain('aria-controls="pw"');
    expect(body).toContain('data-testid="password-input-show"');
    expect(body).toContain(`>${copy.showPassword}<`);
  });
});
