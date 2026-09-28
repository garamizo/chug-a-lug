import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../src/lib/labels';

const sent = vi.hoisted(() => ({ bodies: [] as { source: string; id: string; title: string }[], replies: [] as (string | null)[] }));
vi.mock('$lib/pb', () => ({
  pb: {
    send: vi.fn(async (_path: string, init: { body: { source: string; id: string; title: string } }) => {
      sent.bodies.push(init.body);
      const code = sent.replies.shift() ?? null;
      if (code) throw Object.assign(new Error(code), { status: 400, response: { message: code } });
      return { id: init.body.id, title: init.body.title };
    })
  }
}));
const { cloneRoute } = await import('$lib/cloneRoute');
const src = { id: 'sourceroute0001', title: 'Loop Crawl' };

beforeEach(() => { sent.bodies = []; sent.replies = []; });

describe('cloneRoute', () => {
  it('tries "Copy of X", then "(2)", when a name is taken', async () => {
    sent.replies = ['Title_taken.'];
    await cloneRoute(src);
    expect(sent.bodies.map((b) => b.title)).toEqual([`${copy.cloneTitlePrefix} Loop Crawl`, `${copy.cloneTitlePrefix} Loop Crawl (2)`]);
    expect(sent.bodies[0].id).toBe(sent.bodies[1].id);
  });
  it('retries a failed clone under the same id, then mints a fresh one', async () => {
    sent.replies = ['Bad_clone_request.'];
    await expect(cloneRoute(src)).rejects.toThrow();
    const first = await cloneRoute(src);
    expect(sent.bodies[1].id).toBe(sent.bodies[0].id);
    expect(first).toBe(sent.bodies[0].id);
    await cloneRoute(src);
    expect(sent.bodies[2].id).not.toBe(first);
  });
  it('keeps retry ids per source route', async () => {
    sent.replies = ['Bad_clone_request.'];
    await expect(cloneRoute({ id: 'sourceroute000a', title: 'A' })).rejects.toThrow();
    await cloneRoute({ id: 'sourceroute000b', title: 'B' });
    expect(sent.bodies[1].id).not.toBe(sent.bodies[0].id);
  });
  it('turns the server codes into copy', async () => {
    sent.replies = ['Route_gone.'];
    await expect(cloneRoute({ id: 'sourceroute000c', title: 'C' })).rejects.toThrow(copy.routeGone);
    sent.replies = ['Clone_conflict.'];
    await expect(cloneRoute({ id: 'sourceroute000d', title: 'D' })).rejects.toThrow(copy.genericError);
  });
});
