import { describe, expect, it } from 'vitest';
import { ICONS } from '../../src/lib/icons';

describe('icons', () => {
  it('has path data for every common action', () => {
    for (const name of ['back', 'edit', 'delete', 'add', 'up', 'down', 'send', 'attach', 'camera', 'emoji', 'keyboard', 'close', 'copy', 'mail'] as const) {
      expect(ICONS[name].length, name).toBeGreaterThan(0);
      for (const d of ICONS[name]) expect(d, name).toMatch(/^[Mm]/);
    }
  });
});
