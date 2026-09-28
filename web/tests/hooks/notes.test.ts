import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, del, get, loginToken, patch, post, superuserToken, truncate } from './setup';

let crew: { token: string; id: string };
let admin: { token: string; id: string };
let seq = 0;
const route = async (token: string, title = `Notes route ${++seq}`) =>
  (await post('/api/collections/itineraries/records', { title }, token)).json();
const notesOn = async (id: string, token: string) =>
  (await (await get(`/api/collections/comments/records?filter=${encodeURIComponent(`target_id="${id}" && kind!=""`)}`, token)).json()).items;

beforeAll(async () => {
  crew = await loginToken('Notes Crew');
  admin = await loginToken('Notes Boss', ADMIN_LOGIN_PASSWORD);
  for (const c of ['comments', 'stops', 'itineraries']) await truncate(c);
});

describe('rename notes', () => {
  it('a real rename writes one note by the renamer; a no-op writes none', async () => {
    const r = await route(crew.token, 'Before name');
    await patch(`/api/collections/itineraries/records/${r.id}`, { title: 'After name' }, crew.token);
    await patch(`/api/collections/itineraries/records/${r.id}`, { title: 'After name' }, crew.token);
    await patch(`/api/collections/itineraries/records/${r.id}`, { start_time: '12:00' }, crew.token);
    const notes = await notesOn(r.id, crew.token);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'renamed', user: crew.id, body: '', meta: { from: 'Before name', to: 'After name' } });
  });

  it('a refused rename of a locked route writes no note', async () => {
    const r = await route(crew.token);
    await patch(`/api/collections/itineraries/records/${r.id}`, { status: 'locked' }, admin.token);
    expect((await patch(`/api/collections/itineraries/records/${r.id}`, { title: 'Sneaky' }, crew.token)).status).toBe(403);
    expect(await notesOn(r.id, crew.token)).toHaveLength(0);
    expect((await patch(`/api/collections/itineraries/records/${r.id}`, { title: `Admin named ${seq}` }, admin.token)).status).toBe(200);
    expect(await notesOn(r.id, crew.token)).toHaveLength(1);
  });

  it('rolls the rename back when its note cannot be saved', async () => {
    const su = await superuserToken();
    const col = await (await get('/api/collections/comments', su)).json();
    const r = await route(crew.token, 'Atomic before');
    // Make every comment save fail: a required field nobody sets.
    await patch('/api/collections/comments', { fields: [...col.fields, { name: 'zz_required', type: 'text', required: true }] }, su);
    try {
      expect((await patch(`/api/collections/itineraries/records/${r.id}`, { title: 'Atomic after' }, crew.token)).status).toBe(400);
    } finally {
      await patch('/api/collections/comments', { fields: col.fields }, su);
    }
    expect((await (await get(`/api/collections/itineraries/records/${r.id}`, crew.token)).json()).title).toBe('Atomic before');
  });
});

describe('note rules', () => {
  it('a client cannot create a note, or PATCH one onto a plain comment', async () => {
    const r = await route(crew.token);
    const base = { user: crew.id, target_collection: 'itineraries', target_id: r.id };
    expect((await post('/api/collections/comments/records', { ...base, kind: 'renamed', meta: { from: 'a', to: 'b' } }, crew.token)).status).toBe(400);
    const plain = await (await post('/api/collections/comments/records', { ...base, body: 'hi' }, crew.token)).json();
    for (const kind of ['cloned_from', 'cloned_to', 'renamed']) {
      expect((await patch(`/api/collections/comments/records/${plain.id}`, { kind }, crew.token)).status).toBe(404);
    }
    expect((await patch(`/api/collections/comments/records/${plain.id}`, { meta: { route: r.id } }, crew.token)).status).toBe(404);
  });

  it('the author cannot edit or delete their note; the admin can delete it', async () => {
    const r = await route(crew.token, 'Del before');
    await patch(`/api/collections/itineraries/records/${r.id}`, { title: 'Del after' }, crew.token);
    const [note] = await notesOn(r.id, crew.token);
    expect((await patch(`/api/collections/comments/records/${note.id}`, { body: 'edited' }, crew.token)).status).toBe(404);
    expect((await del(`/api/collections/comments/records/${note.id}`, crew.token)).status).toBe(404);
    expect((await del(`/api/collections/comments/records/${note.id}`, admin.token)).status).toBe(204);
  });
});
