import { afterEach, expect, it, vi } from 'vitest';
import { pb } from '../../src/lib/pb';
import { api } from '../../src/lib/api';
import { sending } from '../../src/lib/sends';

/** Every fetch waits for the test to answer it: nothing reaches the network. */
function holdFetch() {
  const pending: Array<() => void> = [];
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
    pending.push(() => resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
  })));
  return { answer: () => pending.shift()!(), count: () => pending.length };
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

afterEach(() => { vi.unstubAllGlobals(); });

it("a write through the shared PocketBase client counts until it settles; a read does not", async () => {
  const net = holdFetch();
  const read = pb.send('/api/collections/stops/records', {});
  await settle();
  expect(sending()).toBe(false);
  const write = pb.collection('stops').update('a', { order: 2 });
  await settle();
  expect(sending()).toBe(true);
  expect(net.count()).toBe(2);
  net.answer(); // the read
  await read;
  expect(sending()).toBe(true);
  net.answer(); // the write
  await write;
  expect(sending()).toBe(false);
});

it("a write through api() counts until it settles; a read does not", async () => {
  const net = holdFetch();
  const read = api('/api/day');
  await settle();
  expect(sending()).toBe(false);
  const write = api('/api/plan/commit', { method: 'POST', json: {} });
  await settle();
  expect(sending()).toBe(true);
  net.answer();
  await read;
  expect(sending()).toBe(true);
  net.answer();
  await write;
  expect(sending()).toBe(false);
});
