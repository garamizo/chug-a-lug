import { error } from '@sveltejs/kit';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), readContext: vi.fn(), change: vi.fn() }));
vi.mock('$lib/server/pb', () => ({ requireUser: mocks.requireUser }));
vi.mock('$lib/server/sim/clock', () => ({ simulationClock: mocks }));
const { GET, POST } = await import('../../src/routes/api/sim/clock/+server');
const { ClockServiceError } = await import('$lib/server/sim/service');
const request = (body: unknown = {}) => ({ request: new Request('http://x/api/sim/clock', { method: 'POST', body: JSON.stringify(body) }) }) as never;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ is_admin: true });
  mocks.readContext.mockResolvedValue({ enabled: false, eventNow: '2026-09-21T12:00:00.000Z' });
  mocks.change.mockResolvedValue({ enabled: true, revision: 2 });
});
it('requires authentication to read or change the clock', async () => {
  mocks.requireUser.mockImplementation(async () => error(401, 'Log in first.'));
  const res = await GET(request());
  expect(res.status).toBe(401);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect((await POST(request())).status).toBe(401);
  expect(mocks.readContext).not.toHaveBeenCalled();
  expect(mocks.change).not.toHaveBeenCalled();
});
it('lets Crew read, but not control, the clock', async () => {
  mocks.requireUser.mockResolvedValue({ is_admin: false });
  expect((await GET(request())).status).toBe(200);
  expect((await POST(request())).status).toBe(403);
  expect(mocks.change).not.toHaveBeenCalled();
});
it('passes a Conductor revision and command to the authority', async () => {
  const res = await POST(request({ expectedRevision: 1, action: 'resume' }));
  expect(await res.json()).toMatchObject({ revision: 2 });
  expect(mocks.change).toHaveBeenCalledWith(1, { expectedRevision: 1, action: 'resume' });
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('vary')).toBe('Authorization');
});
it('returns conflicts with fresh state and never cacheable responses', async () => {
  mocks.change.mockRejectedValue(new ClockServiceError(409, 'simClockConflict', { enabled: true, revision: 2 } as never));
  const res = await POST(request({ expectedRevision: 1, action: 'pause' }));
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ clock: { revision: 2 } });
  expect(res.headers.get('cache-control')).toBe('no-store');
});
it('maps disabled and unavailable errors to their HTTP status', async () => {
  mocks.change.mockRejectedValue(new ClockServiceError(404, 'simDisabled'));
  expect((await POST(request({ action: 'resume' }))).status).toBe(404);
  mocks.readContext.mockRejectedValue(new ClockServiceError(503, 'simUnavailable'));
  expect((await GET(request())).status).toBe(503);
});
it('rejects malformed JSON and non-object bodies', async () => {
  const bad = { request: new Request('http://x/api/sim/clock', { method: 'POST', body: '{' }) } as never;
  expect((await POST(bad)).status).toBe(400);
  expect((await POST(request(null))).status).toBe(400);
  expect(mocks.change).not.toHaveBeenCalled();
});
