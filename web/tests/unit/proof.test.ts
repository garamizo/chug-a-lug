import { describe, expect, it, vi } from 'vitest';
import { clockFailure, proofForm, sameScope, sendProof, type ProofScope, type ProofSend } from '../../src/lib/live/proof';
import { copy } from '../../src/lib/labels';
import type { DrinkEntry, Media } from '../../src/lib/types';

const scope: ProofScope = { user: 'u', itinerary: 'i', day: '2026-12-26', runId: null };
const send: ProofSend = { id: 'abc123abc123abc', kind: 'beer', stop: 's1', scope, file: new File(['x'], 'p.jpg', { type: 'image/jpeg' }), takenAt: '2026-12-26T17:00:00.000Z' };
const media = { id: send.id } as Media, drink = { id: send.id, kind: 'beer' } as DrinkEntry;
const deps = (o: Partial<Parameters<typeof sendProof>[1]> = {}) => ({
  createMedia: vi.fn(async () => media), getDrink: vi.fn(async () => drink), getMedia: vi.fn(async () => media),
  currentScope: () => scope, ...o
});
const dup = Object.assign(new Error('x'), { status: 400, response: { data: { id: { code: 'validation_not_unique' } } } });

describe('proofForm', () => {
  it('carries exactly the fields the hook expects', () => {
    const f = proofForm(send);
    expect(Object.fromEntries([...f.entries()].filter(([k]) => k !== 'file'))).toEqual({
      id: send.id, user: 'u', stop: 's1', kind: 'image', taken_at: send.takenAt, drink_kind: 'beer' });
    expect((f.get('file') as File).name).toBe('p.jpg');
  });
});
describe('sameScope', () => {
  it('compares every part and rejects null', () => {
    expect(sameScope(scope, { ...scope })).toBe(true);
    expect(sameScope(scope, null)).toBe(false);
    for (const k of ['user', 'itinerary', 'day', 'runId'] as const) expect(sameScope(scope, { ...scope, [k]: 'z' })).toBe(false);
  });
});
describe('sendProof', () => {
  it('saves and reads the rows back', async () => {
    expect(await sendProof(send, deps())).toEqual({ status: 'saved', drink, media });
  });
  it('is still saved when the read-back fails', async () => {
    const d = deps({ getDrink: vi.fn(async () => { throw new Error('x'); }) });
    expect(await sendProof(send, d)).toEqual({ status: 'saved', drink: null, media: null });
  });
  it('treats a duplicate id with an existing drink as saved', async () => {
    const d = deps({ createMedia: vi.fn(async () => { throw dup; }) });
    expect(await sendProof(send, d)).toEqual({ status: 'saved', drink, media });
  });
  it('keeps a duplicate saved when only the media read fails', async () => {
    const d = deps({ createMedia: vi.fn(async () => { throw dup; }), getMedia: vi.fn(async () => { throw new Error('x'); }) });
    expect(await sendProof(send, d)).toEqual({ status: 'saved', drink, media: null });
  });
  it('fails a duplicate id with no drink, or with a failing recovery read', async () => {
    const d = deps({ createMedia: vi.fn(async () => { throw dup; }), getDrink: vi.fn(async () => { throw Object.assign(new Error('x'), { status: 404 }); }) });
    expect((await sendProof(send, d)).status).toBe('failed');
  });
  it('is stale, without creating, when scope changed before submit', async () => {
    const d = deps({ currentScope: () => ({ ...scope, day: 'other' }) });
    expect(await sendProof(send, d)).toEqual({ status: 'stale' });
    expect(d.createMedia).not.toHaveBeenCalled();
  });
  it('is stale when scope changed during a successful send', async () => {
    let cur: ProofScope = scope;
    const d = deps({ currentScope: () => cur, createMedia: vi.fn(async () => { cur = { ...scope, runId: 'r2' }; return media; }) });
    expect(await sendProof(send, d)).toEqual({ status: 'stale' });
  });
  it('is stale, not failed, when scope changed during a failing send', async () => {
    let cur: ProofScope | null = scope;
    const d = deps({ currentScope: () => cur, createMedia: vi.fn(async () => { cur = null; throw new Error('x'); }) });
    expect(await sendProof(send, d)).toEqual({ status: 'stale' });
  });
  it('does not treat a stop change alone as stale', async () => {
    expect((await sendProof({ ...send, stop: 's2' }, deps())).status).toBe('saved');
  });
  it('maps errors to messages', async () => {
    const fail = (e: unknown) => sendProof(send, deps({ createMedia: vi.fn(async () => { throw e; }) }));
    expect(await fail({ status: 0 })).toEqual({ status: 'failed', message: copy.noSignal });
    expect(await fail({ status: 400, response: { message: 'Proof_needs_image.' } })).toEqual({ status: 'failed', message: copy.proofNeedsImage });
    expect(await fail({ status: 400, response: { message: 'Proof_needs_stop.' } })).toEqual({ status: 'failed', message: copy.proofNeedsStop });
    expect(await fail({ status: 500 })).toEqual({ status: 'failed', message: copy.uploadFailed });
  });
});

describe('clockFailure', () => {
  it('keeps our own words and turns a raw browser error into No signal', () => {
    expect(clockFailure(new Error(copy.simUnavailable))).toBe(copy.simUnavailable);
    expect(clockFailure(new Error(copy.noSignal))).toBe(copy.noSignal);
    expect(clockFailure(new TypeError('Failed to fetch'))).toBe(copy.noSignal);
    expect(clockFailure(new DOMException('The operation timed out.', 'TimeoutError'))).toBe(copy.noSignal);
    expect(clockFailure('nope')).toBe(copy.noSignal);
  });
});
