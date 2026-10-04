import { afterEach, describe, expect, it, vi } from 'vitest';

describe('hooks test helpers', () => {
  const saved = process.env.PB_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.PB_URL; else process.env.PB_URL = saved;
    vi.resetModules();
  });

  it('refuse to run without PB_URL, rather than fall back to the live stack on 8090', async () => {
    delete process.env.PB_URL;
    vi.resetModules();
    await expect(import('../hooks/setup')).rejects.toThrow(/PB_URL/);
  });
});
