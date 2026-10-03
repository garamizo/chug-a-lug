import { afterEach, expect, it, vi } from 'vitest';
import { pb, refreshSession } from '../../src/lib/pb';

const token = (expInDays: number) => 'h.' + btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expInDays * 86400 })) + '.s';
afterEach(() => { vi.restoreAllMocks(); pb.authStore.clear(); });

it('keeps the session with no signal, ends it on 401/403, and renews only in the last week', async () => {
  pb.authStore.save(token(30), { id: 'u' } as never);
  const send = vi.spyOn(pb, 'send');
  const refresh = vi.spyOn(pb.collection('users'), 'authRefresh').mockResolvedValue({} as never);
  send.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
  expect(await refreshSession()).toBe('offline');
  send.mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 403 }));
  expect(await refreshSession()).toBe('signed_out');
  send.mockResolvedValueOnce({ record: { id: 'u' } });
  expect(await refreshSession()).toBe('ok');
  expect(refresh).not.toHaveBeenCalled();
  pb.authStore.save(token(3), { id: 'u' } as never);
  send.mockResolvedValueOnce({ record: { id: 'u' } });
  expect(await refreshSession()).toBe('ok');
  expect(refresh).toHaveBeenCalledOnce();
});
