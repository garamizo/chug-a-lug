import { describe, expect, it, vi } from 'vitest';
import { MAX_BYTES, prepare } from '../../src/lib/live/upload';
import { copy } from '../../src/lib/labels';

const file = (name: string, type: string, size = 10) =>
  Object.assign(new File([new Uint8Array(size)], name, { type, lastModified: Date.parse('2026-12-26T20:00:00.000Z') }));

describe('prepare', () => {
  it('compresses an image and keeps when it was taken', async () => {
    const compress = vi.fn(async () => file('small.jpg', 'image/jpeg', 2));
    const out = await prepare(file('big.jpg', 'image/jpeg', 5_000_000), compress);
    expect(compress).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ kind: 'image', takenAt: '2026-12-26T20:00:00.000Z' });
    expect(out.file.size).toBe(2);
  });

  it('passes a video through untouched', async () => {
    const compress = vi.fn();
    const out = await prepare(file('clip.mp4', 'video/mp4', 1_000), compress);
    expect(compress).not.toHaveBeenCalled();
    expect(out.kind).toBe('video');
  });

  it('refuses anything over the ceiling before it is uploaded', async () => {
    await expect(prepare(file('huge.mp4', 'video/mp4', MAX_BYTES + 1), vi.fn())).rejects.toThrow(copy.uploadTooBig);
  });

  it('uploads the original when compression fails', async () => {
    const original = file('big.jpg', 'image/jpeg', 5_000);
    const out = await prepare(original, vi.fn(async () => { throw new Error('canvas blocked'); }));
    expect(out.file).toBe(original);
  });
});
