import { describe, expect, it, vi } from 'vitest';
import { MAX_BYTES, prepare, uploadBatch } from '../../src/lib/live/upload';
import { copy } from '../../src/lib/labels';

const file = (name: string, type: string, size = 10) =>
  Object.assign(new File([new Uint8Array(size)], name, { type, lastModified: Date.parse('2026-12-26T20:00:00.000Z') }));

describe('prepare', () => {
  it.each(['application/pdf', 'audio/mpeg', ''])('refuses unsupported MIME type %j before compression', async (type) => {
    const compress = vi.fn(async (original: File) => original);
    await expect(prepare(file('unsupported', type), compress)).rejects.toThrow(copy.uploadUnsupportedType);
    expect(compress).not.toHaveBeenCalled();
  });

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

describe('uploadBatch', () => {
  it.each(['server', 'oversized', 'unsupported'])('continues after a middle %s failure and refreshes the landed files', async (failure) => {
    const middle = file('middle', failure === 'unsupported' ? 'application/pdf' : 'video/mp4');
    if (failure === 'oversized') Object.defineProperty(middle, 'size', { value: MAX_BYTES + 1 });
    const files = [file('first.mp4', 'video/mp4'), middle, file('last.mp4', 'video/mp4')];
    const sent: File[] = [];
    const create = vi.fn(async (prepared: File) => {
      if (prepared === middle) throw new Error('private server details');
      sent.push(prepared);
    });
    const send = vi.fn(async (original: File) => {
      const prepared = await prepare(original, vi.fn());
      await create(prepared.file);
    });
    const refresh = vi.fn(async () => { expect(sent).toEqual([files[0], files[2]]); });

    const message = await uploadBatch(files, send, refresh);

    expect(send.mock.calls.map(([original]) => original)).toEqual(files);
    expect(create).toHaveBeenCalledTimes(failure === 'server' ? 3 : 2);
    expect(refresh).toHaveBeenCalledOnce();
    const reason = failure === 'server' ? copy.uploadFailed : failure === 'oversized' ? copy.uploadTooBig : copy.uploadUnsupportedType;
    expect(message).toBe(`2 ${copy.uploadSent} 1 ${copy.uploadNotSent} ${reason}`);
    expect(message).not.toContain('private server details');
  });

  it('reports zero sent when every upload fails, without repeating the same reason', async () => {
    const files = [file('one.mp4', 'video/mp4'), file('two.mp4', 'video/mp4')];
    const send = vi.fn(async () => { throw new Error('offline'); });
    const refresh = vi.fn(async () => {});
    expect(await uploadBatch(files, send, refresh)).toBe(`0 ${copy.uploadSent} 2 ${copy.uploadNotSent} ${copy.uploadFailed}`);
    expect(send).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('refreshes a successful batch without an error message', async () => {
    const files = [file('one.mp4', 'video/mp4'), file('two.mp4', 'video/mp4')];
    const send = vi.fn(async () => {});
    const refresh = vi.fn(async () => { expect(send).toHaveBeenCalledTimes(2); });
    expect(await uploadBatch(files, send, refresh)).toBe('');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
