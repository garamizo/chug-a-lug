// The live collections' rules against a live PocketBase: Bulletins are the Conductor's alone, acks
// and drinks belong to whoever wrote them, and everyone can read all of it.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, del, deleteUserByName, get, loginToken, patch, post, superuserToken, truncate, PB } from './setup';

let conductor = '', crew = '', conductorId = '', crewId = '', itineraryId = '', stopId = '';

beforeAll(async () => {
  for (const c of ['broadcast_acks', 'broadcasts', 'drink_entries', 'media']) await truncate(c);
  // An earlier test file may have left a Conductor selection in `crawl_settings`; this file's media
  // tagging assumes the fallback (the newest locked route), so clear any stale pick first.
  await patch('/api/collections/crawl_settings/records/crawlsettings', { current_itinerary: '' }, await superuserToken());
  ({ token: conductor, id: conductorId } = await loginToken('Live Conductor', ADMIN_LOGIN_PASSWORD));
  ({ token: crew, id: crewId } = await loginToken('Live Crew'));

  const itin = await (await post('/api/collections/itineraries/records', {
    title: 'Live rules', status: 'locked', event_date: '2026-12-26', start_time: '12:00', created_by: conductorId
  }, conductor)).json();
  itineraryId = itin.id;
  // Every itinerary is created as a draft (pb_hooks/planning.pb.js), regardless of what the
  // create body asked for; locking one is an update.
  await patch(`/api/collections/itineraries/records/${itineraryId}`, { status: 'locked' }, conductor);
  stopId = (await (await post('/api/collections/stops/records', {
    itinerary: itineraryId, order: 1, name: 'The Hop Haus', station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5
  }, conductor)).json()).id;
});

describe('broadcasts', () => {
  it('lets the Conductor post a Bulletin', async () => {
    const res = await post('/api/collections/broadcasts/records', {
      itinerary: itineraryId, kind: 'message', body: 'Meet under the clock.', created_by: conductorId
    }, conductor);
    expect(res.status).toBe(200);
  });

  it('refuses a Bulletin from the Crew', async () => {
    const res = await post('/api/collections/broadcasts/records', {
      itinerary: itineraryId, kind: 'message', body: 'Free round on the Conductor.', created_by: crewId
    }, crew);
    expect(res.status).toBe(400);
  });

  it('lets the Crew read Bulletins', async () => {
    const res = await get('/api/collections/broadcasts/records', crew);
    expect(res.status).toBe(200);
    expect((await res.json()).totalItems).toBeGreaterThan(0);
  });
});

describe('broadcast_acks', () => {
  let broadcastId = '';
  beforeAll(async () => {
    broadcastId = (await (await post('/api/collections/broadcasts/records', {
      itinerary: itineraryId, kind: 'hold', body: 'Holding here.', created_by: conductorId
    }, conductor)).json()).id;
  });

  it('records an ack once', async () => {
    const first = await post('/api/collections/broadcast_acks/records', { broadcast: broadcastId, user: crewId }, crew);
    expect(first.status).toBe(200);
    const again = await post('/api/collections/broadcast_acks/records', { broadcast: broadcastId, user: crewId }, crew);
    expect(again.status).toBe(400); // the unique index, not a hook
  });

  it('refuses an ack on someone else’s behalf', async () => {
    const res = await post('/api/collections/broadcast_acks/records', { broadcast: broadcastId, user: conductorId }, crew);
    expect(res.status).toBe(400);
  });
});

describe('drink_entries', () => {
  it('logs and removes your own drink', async () => {
    const created = await post('/api/collections/drink_entries/records', {
      user: crewId, stop: stopId, kind: 'beer', at: '2026-12-26T20:00:00.000Z'
    }, crew);
    expect(created.status).toBe(200);
    const id = (await created.json()).id;
    expect((await del(`/api/collections/drink_entries/records/${id}`, conductor)).status).toBe(404);
    expect((await del(`/api/collections/drink_entries/records/${id}`, crew)).status).toBe(204);
  });

  it('refuses a drink logged for someone else', async () => {
    const res = await post('/api/collections/drink_entries/records', {
      user: conductorId, stop: stopId, kind: 'shot', at: '2026-12-26T20:05:00.000Z'
    }, crew);
    expect(res.status).toBe(400);
  });

  it('stamps a drink with server time, whatever time the phone sent', async () => {
    const before = Date.now();
    const res = await post('/api/collections/drink_entries/records', {
      user: crewId, stop: stopId, kind: 'beer', at: '2020-01-01T00:00:00.000Z'
    }, crew);
    expect(res.status).toBe(200);
    const at = Date.parse((await res.json()).at);
    expect(at).toBeGreaterThanOrEqual(before - 5000);
    expect(at).toBeLessThanOrEqual(Date.now() + 5000);
  });
});

describe('anonymous access', () => {
  it('refuses an anonymous create on broadcasts, broadcast_acks, drink_entries and media', async () => {
    const broadcast = await post('/api/collections/broadcasts/records', {
      itinerary: itineraryId, kind: 'message', body: 'Nobody is signed in.', created_by: conductorId
    });
    expect(broadcast.status).toBe(400);

    const ack = await post('/api/collections/broadcast_acks/records', { broadcast: itineraryId, user: crewId });
    expect(ack.status).toBe(400);

    const drink = await post('/api/collections/drink_entries/records', {
      user: crewId, stop: stopId, kind: 'beer', at: '2026-12-26T20:00:00.000Z'
    });
    expect(drink.status).toBe(400);

    const form = new FormData();
    form.set('user', crewId);
    form.set('kind', 'image');
    form.set('file', new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'shot.jpg');
    const media = await fetch(`${PB}/api/collections/media/records`, { method: 'POST', body: form });
    expect(media.status).toBe(400);
  });

  it('shows an anonymous reader nothing on broadcasts', async () => {
    // PocketBase list rules filter rather than reject, so the giveaway is an empty page, not a 403.
    const res = await get('/api/collections/broadcasts/records');
    expect(res.status).toBe(200);
    expect((await res.json()).totalItems).toBe(0);
  });
});

describe('media tagging', () => {
  const upload = async (token: string, userId: string, stop: string | null) => {
    const form = new FormData();
    form.set('user', userId);
    form.set('kind', 'image');
    form.set('taken_at', '2026-12-26T20:00:00.000Z');
    if (stop !== null) form.set('stop', stop);
    form.set('file', new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'shot.jpg');
    const res = await fetch(`${PB}/api/collections/media/records`, { method: 'POST', headers: { Authorization: token }, body: form });
    return { status: res.status, body: await res.json() };
  };

  it('tags an upload at a stop of the locked route with the clock', async () => {
    const { status, body } = await upload(crew, crewId, stopId);
    expect(status).toBe(200);
    expect(body).toMatchObject({ stop: stopId, tagged_by: 'clock' });
  });

  it('clears a stop that belongs to no locked route rather than rejecting the photo', async () => {
    const draft = await (await post('/api/collections/itineraries/records', {
      title: 'Not the route', event_date: '2026-12-26', start_time: '12:00', created_by: conductorId
    }, conductor)).json();
    const strayStop = (await (await post('/api/collections/stops/records', {
      itinerary: draft.id, order: 1, name: 'Elsewhere', station_id: 'CUS', dwell_min: 60, walk_min: 5
    }, conductor)).json()).id;

    const { status, body } = await upload(crew, crewId, strayStop);
    expect(status).toBe(200);
    expect(body).toMatchObject({ stop: '', tagged_by: 'none' });
  });

  it('accepts a photo with no stop at all', async () => {
    const { status, body } = await upload(crew, crewId, null);
    expect(status).toBe(200);
    expect(body).toMatchObject({ stop: '', tagged_by: 'none' });
  });

  it('files every photo under the current route, stop or no stop, whatever the body says', async () => {
    const tagged = await upload(crew, crewId, stopId);
    expect(tagged.body.itinerary).toBe(itineraryId);
    const form = new FormData();
    form.set('user', crewId);
    form.set('kind', 'image');
    form.set('taken_at', '2026-12-26T20:00:00.000Z');
    form.set('itinerary', 'notarealroute00');
    form.set('file', new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'shot.jpg');
    const res = await fetch(`${PB}/api/collections/media/records`, { method: 'POST', headers: { Authorization: crew }, body: form });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stop: '', itinerary: itineraryId });
  });
});

describe('bulletin bookkeeping', () => {
  it('stamps the author and writes the Train Sheet entry', async () => {
    const res = await post('/api/collections/broadcasts/records', {
      itinerary: itineraryId, kind: 'annul', body: 'LaGrange is annulled.', created_by: crewId
    }, conductor);
    expect(res.status).toBe(200);
    expect((await res.json()).created_by).toBe(conductorId); // the body said crew; the hook overrules it

    const log = await get(`/api/collections/event_log/records?filter=${encodeURIComponent(`itinerary="${itineraryId}" && kind="bulletin"`)}`, conductor);
    expect((await log.json()).totalItems).toBeGreaterThan(0);
  });
});

// Photo Tab: a media upload carrying `drink_kind` is a proof, and the server writes its drink in the
// same transaction under the same id. Hook errors arrive sentence-cased ("Proof_needs_image.").
describe('proof uploads', () => {
  const JPEG = readFile(new URL('../fixtures/proof.jpg', import.meta.url)).then((bytes) => new Uint8Array(bytes));
  const MP4 = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d]);
  let n = 0;
  const newId = () => `proof${Date.now().toString(36).slice(-6)}${String(++n).padStart(4, '0')}`;
  let strayStop = '';

  type Proof = { id?: string; user?: string; stop?: string | null; kind?: string; drinkKind?: string;
    bytes?: Uint8Array<ArrayBuffer> | string; type?: string; name?: string; noFile?: boolean };
  const send = async (token: string, p: Proof = {}) => {
    const form = new FormData();
    if (p.id) form.set('id', p.id);
    form.set('user', p.user ?? crewId);
    form.set('kind', p.kind ?? 'image');
    form.set('taken_at', '2026-12-26T20:00:00.000Z');
    const stop = p.stop === undefined ? stopId : p.stop;
    if (stop !== null) form.set('stop', stop);
    if (p.drinkKind !== '') form.set('drink_kind', p.drinkKind ?? 'beer');
    if (!p.noFile) form.set('file', new Blob([p.bytes ?? await JPEG], { type: p.type ?? 'image/jpeg' }), p.name ?? 'proof.jpg');
    const res = await fetch(`${PB}/api/collections/media/records`, { method: 'POST', headers: { Authorization: token }, body: form });
    return { status: res.status, body: await res.json() };
  };
  const record = async (collection: string, id: string) =>
    get(`/api/collections/${collection}/records/${id}`, await superuserToken());
  const exists = async (collection: string, id: string) => (await record(collection, id)).status === 200;
  const counter = async () =>
    (await (await get('/api/collections/action_sequence/records/eventactions001', await superuserToken())).json()).value as number;
  const drinkCount = async () =>
    (await (await get('/api/collections/drink_entries/records?perPage=1', await superuserToken())).json()).totalItems as number;

  beforeAll(async () => {
    const draft = await (await post('/api/collections/itineraries/records', {
      title: 'Not the proof route', event_date: '2026-12-26', start_time: '12:00', created_by: conductorId
    }, conductor)).json();
    strayStop = (await (await post('/api/collections/stops/records', {
      itinerary: draft.id, order: 1, name: 'Somewhere else', station_id: 'CUS', dwell_min: 60, walk_min: 5
    }, conductor)).json()).id;
  });

  it('a proof creates its drink under the same id, stamped and numbered', async () => {
    const before = await counter();
    const id = newId();
    const sent = await send(crew, { id, drinkKind: 'cocktail' });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ id, user: crewId, stop: stopId, itinerary: itineraryId, kind: 'image', drink_kind: 'cocktail', tagged_by: 'clock' });
    const drink = await (await get(`/api/collections/drink_entries/records/${id}`, crew)).json();
    expect(drink).toMatchObject({ id, user: crewId, stop: stopId, kind: 'cocktail', media: id });
    expect(Date.parse(drink.at)).toBe(Date.parse(sent.body.at));
    expect(drink.action_order).toBe(before + 1);
    expect(await counter()).toBe(before + 1);
  });

  it('accepts PNG, WebP, HEIC and GIF photos as proof', async () => {
    const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
    const photos: Array<[string, number[]]> = [
      ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]],
      ['image/webp', [...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 ')]],
      ['image/heic', [0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')]],
      ['image/gif', ascii('GIF89a\x01\x00\x01\x00')]
    ];
    for (const [type, bytes] of photos) {
      const id = newId();
      const sent = await send(crew, { id, type, name: 'proof', bytes: Uint8Array.from(bytes) });
      expect(sent.status, type).toBe(200);
      expect(await exists('drink_entries', id), type).toBe(true);
    }
  });

  it('a video, non-image bytes, or kind=video is refused with proof_needs_image', async () => {
    const drinks = await drinkCount();
    const attempts: Proof[] = [
      { bytes: MP4, type: 'image/jpeg', name: 'proof.jpg' },          // a video dressed as a photo
      { bytes: 'not a photo at all', type: 'image/jpeg', name: 'proof.jpg' },
      { kind: 'video' }                                                 // real JPEG bytes, but declared a video
    ];
    for (const attempt of attempts) {
      const id = newId();
      const sent = await send(crew, { id, ...attempt });
      expect(sent.status).toBe(400);
      expect(sent.body.message).toBe('Proof_needs_image.');
      expect(await exists('media', id)).toBe(false);
    }
    expect(await drinkCount()).toBe(drinks);
  });

  it('a proof with no file is refused', async () => {
    const drinks = await drinkCount();
    const id = newId();
    const sent = await send(crew, { id, noFile: true });
    expect(sent.status).toBe(400);
    expect(sent.body.data.file.code).toBe('validation_required');
    expect(await exists('media', id)).toBe(false);
    expect(await drinkCount()).toBe(drinks);
  });

  it('a proof at a stop off the current route is refused with proof_needs_stop', async () => {
    const drinks = await drinkCount();
    for (const stop of [strayStop, null]) {
      const id = newId();
      const sent = await send(crew, { id, stop });
      expect(sent.status).toBe(400);
      expect(sent.body.message).toBe('Proof_needs_stop.');
      expect(await exists('media', id)).toBe(false);
    }
    expect(await drinkCount()).toBe(drinks);
  });

  it('a proof for someone else is refused by the media rule', async () => {
    const id = newId();
    const sent = await send(crew, { id, user: conductorId });
    expect(sent.status).toBe(400);
    expect(await exists('media', id)).toBe(false);
    expect(await exists('drink_entries', id)).toBe(false);
  });

  it('a failed drink save rolls back the photo and the action counter', async () => {
    // A drink already holding the id makes the hook's drink save fail after the photo was saved.
    const id = newId();
    const su = await superuserToken();
    expect((await post('/api/collections/drink_entries/records', {
      id, user: crewId, stop: stopId, kind: 'water', at: '2026-12-26T20:00:00.000Z'
    }, su)).status).toBe(200);
    const before = await counter();
    const drinks = await drinkCount();
    const sent = await send(crew, { id });
    expect(sent.status).toBe(400);
    expect(await exists('media', id)).toBe(false);
    expect(await counter()).toBe(before);
    expect(await drinkCount()).toBe(drinks);
    const kept = await (await record('drink_entries', id)).json();
    expect(kept).toMatchObject({ kind: 'water', media: '' });
    await del(`/api/collections/drink_entries/records/${id}`, su);
  });

  it('a repeated id is refused without a second drink', async () => {
    // The lost-response retry: the first send landed, the phone sends the same id again.
    const id = newId();
    expect((await send(crew, { id })).status).toBe(200);
    const before = await counter();
    const drinks = await drinkCount();
    const again = await send(crew, { id, drinkKind: 'shot' });
    expect(again.status).toBe(400);
    expect(again.body.data.id.code).toBe('validation_not_unique');
    expect(await drinkCount()).toBe(drinks);
    expect(await counter()).toBe(before);
    expect((await (await record('drink_entries', id)).json()).kind).toBe('beer');
  });

  it('Undo removes the photo', async () => {
    const id = newId();
    expect((await send(crew, { id })).status).toBe(200);
    expect((await del(`/api/collections/drink_entries/records/${id}`, crew)).status).toBe(204);
    expect(await exists('drink_entries', id)).toBe(false);
    expect(await exists('media', id)).toBe(false);
  });

  it('a failed photo delete keeps the drink', async () => {
    const id = newId();
    expect((await send(crew, { id })).status).toBe(200);
    const su = await superuserToken();
    // A throwaway collection with a required, non-cascading relation makes PocketBase refuse the photo delete.
    const mediaCol = await (await get('/api/collections/media', su)).json();
    try {
      const hold = await post('/api/collections', { name: 'zz_proof_hold', type: 'base', fields: [
        { name: 'photo', type: 'relation', collectionId: mediaCol.id, maxSelect: 1, required: true, cascadeDelete: false }
      ] }, su);
      expect(hold.status).toBe(200);
      expect((await post('/api/collections/zz_proof_hold/records', { photo: id }, su)).status).toBe(200);
      expect((await del(`/api/collections/drink_entries/records/${id}`, crew)).status).toBe(400);
      expect(await exists('drink_entries', id)).toBe(true);
      expect(await exists('media', id)).toBe(true);
    } finally {
      await del('/api/collections/zz_proof_hold', su);
    }
    expect((await del(`/api/collections/drink_entries/records/${id}`, crew)).status).toBe(204);
    expect(await exists('media', id)).toBe(false);
  });

  it('a crew drink pointing at someone else’s photo is refused', async () => {
    const su = await superuserToken();
    const form = new FormData();
    form.set('user', conductorId); form.set('kind', 'image'); form.set('stop', stopId);
    form.set('file', new Blob([await JPEG], { type: 'image/jpeg' }), 'conductor.jpg');
    const photo = await (await fetch(`${PB}/api/collections/media/records`, { method: 'POST', headers: { Authorization: conductor }, body: form })).json();
    const drinks = await drinkCount();
    const res = await post('/api/collections/drink_entries/records', {
      user: crewId, stop: stopId, kind: 'beer', at: '2026-12-26T20:00:00.000Z', media: photo.id
    }, crew);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Proof_locked.');
    expect(await drinkCount()).toBe(drinks);
    expect(await exists('media', photo.id)).toBe(true);
    await del(`/api/collections/media/records/${photo.id}`, su);
  });

  it('deleting a drink leaves a photo that is not its own proof', async () => {
    const su = await superuserToken();
    const plain = await send(crew, { drinkKind: '' });
    expect(plain.status).toBe(200);
    const drink = await post('/api/collections/drink_entries/records', {
      user: crewId, stop: stopId, kind: 'beer', at: '2026-12-26T20:00:00.000Z', media: plain.body.id
    }, su);
    expect(drink.status).toBe(200);
    const drinkId = (await drink.json()).id;
    expect((await del(`/api/collections/drink_entries/records/${drinkId}`, crew)).status).toBe(204);
    expect(await exists('drink_entries', drinkId)).toBe(false);
    expect(await exists('media', plain.body.id)).toBe(true);
  });

  it('the Conductor deleting the photo removes the drink', async () => {
    const id = newId();
    expect((await send(crew, { id })).status).toBe(200);
    expect((await del(`/api/collections/media/records/${id}`, conductor)).status).toBe(204);
    expect(await exists('media', id)).toBe(false);
    expect(await exists('drink_entries', id)).toBe(false);
  });

  it('deleting the stop or the user removes both', async () => {
    const su = await superuserToken();
    const stop = (await (await post('/api/collections/stops/records', {
      itinerary: itineraryId, order: 9, name: 'Last call', station_id: 'LAGRANGE', dwell_min: 30, walk_min: 5
    }, su)).json()).id;
    const atStop = newId();
    expect((await send(crew, { id: atStop, stop })).status).toBe(200);
    expect((await del(`/api/collections/stops/records/${stop}`, su)).status).toBe(204);
    expect(await exists('drink_entries', atStop)).toBe(false);
    expect(await exists('media', atStop)).toBe(false);

    const leaver = await loginToken('Live Proof Leaver');
    const byUser = newId();
    expect((await send(leaver.token, { id: byUser, user: leaver.id })).status).toBe(200);
    await deleteUserByName('Live Proof Leaver');
    expect(await exists('drink_entries', byUser)).toBe(false);
    expect(await exists('media', byUser)).toBe(false);
  });

  it('a proof cannot be edited', async () => {
    const id = newId();
    expect((await send(crew, { id })).status).toBe(200);
    const path = `/api/collections/media/records/${id}`;
    for (const change of [{ drink_kind: 'shot' }, { drink_kind: '' }, { kind: 'video' }, { user: conductorId },
      { stop: '' }, { itinerary: '' }, { file: null }]) {
      const res = await patch(path, change, conductor);
      expect(res.status, JSON.stringify(change)).toBe(400);
      expect((await res.json()).message, JSON.stringify(change)).toBe('Proof_locked.');
    }
    const form = new FormData();
    form.set('file', new Blob([await JPEG], { type: 'image/jpeg' }), 'other.jpg');
    const replaced = await fetch(`${PB}${path}`, { method: 'PATCH', headers: { Authorization: conductor }, body: form });
    expect(replaced.status).toBe(400);
    expect((await replaced.json()).message).toBe('Proof_locked.');
    // Fields outside the pairing stay the Conductor's to fix.
    expect((await patch(path, { tagged_by: 'manual' }, conductor)).status).toBe(200);

    const plain = await send(crew, { id: newId(), drinkKind: '' });
    expect(plain.status).toBe(200);
    const promoted = await patch(`/api/collections/media/records/${plain.body.id}`, { drink_kind: 'beer' }, conductor);
    expect(promoted.status).toBe(400);
    expect((await promoted.json()).message).toBe('Proof_locked.');
  });

  it('plain Freight is unchanged', async () => {
    const drinks = await drinkCount();
    const photo = await send(crew, { drinkKind: '', stop: strayStop });
    expect(photo.status).toBe(200);
    expect(photo.body).toMatchObject({ drink_kind: '', stop: '', tagged_by: 'none' });
    const video = await send(crew, { drinkKind: '', kind: 'video', bytes: MP4, type: 'video/mp4', name: 'clip.mp4' });
    expect(video.status).toBe(200);
    expect(video.body).toMatchObject({ kind: 'video', stop: stopId });
    expect(await exists('drink_entries', photo.body.id)).toBe(false);
    expect(await drinkCount()).toBe(drinks);
    expect((await patch(`/api/collections/media/records/${photo.body.id}`, { stop: stopId, tagged_by: 'manual' }, conductor)).status).toBe(200);
  });
});
