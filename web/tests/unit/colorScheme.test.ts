import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Spec 2026-11-15-festive-ticket-mail-design.md: the app is dark-only and says so, so phone browsers'
// automatic dark mode leaves it (and the header logo) alone. This proves only the declaration; the
// acceptance check is on the affected phone.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('dark color scheme', () => {
  it('app.html declares it', () => { expect(read('../../src/app.html')).toMatch(/<meta name="color-scheme" content="dark"/); });
  it('the root style sets it', () => { expect(read('../../src/routes/+layout.svelte')).toContain('color-scheme: dark'); });
});
