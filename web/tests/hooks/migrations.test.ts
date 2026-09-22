import { mkdtemp, readdir, copyFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('backfills historical timestamps and tied action order before accepting new writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-migration-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) {
      await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    }
    // Insert old-schema records between the existing clock migration and task 7's upgrades.
    await writeFile(join(migrations, '1758805000_legacy_fixture.js'), `migrate(app => {
      const u = new Record(app.findCollectionByNameOrId('users'));
      u.set('name', 'Legacy'); u.set('name_key', 'legacy'); u.setPassword('legacy-password-only'); app.save(u);
      const it = new Record(app.findCollectionByNameOrId('itineraries'));
      it.set('title', 'Legacy'); it.set('status', 'draft'); it.set('event_date', '2026-12-26');
      it.set('start_time', '11:00'); it.set('created_by', u.id); app.save(it);
      const stop = new Record(app.findCollectionByNameOrId('stops'));
      stop.set('itinerary', it.id); stop.set('name', 'Legacy'); stop.set('station_id', 'CUS'); app.save(stop);
      for (const id of ['bbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaa']) {
        const r = new Record(app.findCollectionByNameOrId('checkins'));
        r.set('id', id); r.set('user', u.id); r.set('stop', stop.id); r.set('kind', 'at_stop');
        r.set('at', '2026-12-26T18:00:00Z'); app.save(r);
      }
      const drink = new Record(app.findCollectionByNameOrId('drink_entries'));
      drink.set('id', 'ccccccccccccccc'); drink.set('user', u.id); drink.set('stop', stop.id);
      drink.set('kind', 'beer'); drink.set('at', '2026-12-26T18:00:00Z'); app.save(drink);
      app.db().newQuery("UPDATE checkins SET created = '2026-09-01 12:00:00.000Z'").execute();
      app.db().newQuery("UPDATE drink_entries SET created = '2026-09-01 12:00:00.000Z'").execute();
      const b = new Record(app.findCollectionByNameOrId('broadcasts'));
      b.set('id', 'ddddddddddddddd'); b.set('itinerary', it.id); b.set('kind', 'message');
      b.set('body', 'Legacy'); b.set('created_by', u.id); app.save(b);
    }, app => {})`);
    await writeFile(join(migrations, '1758830000_verify_upgrade.js'), `migrate(app => {
      for (const [collection, id, order] of [['checkins', 'aaaaaaaaaaaaaaa', 1], ['checkins', 'bbbbbbbbbbbbbbb', 2], ['drink_entries', 'ccccccccccccccc', 3]]) {
        if (app.findRecordById(collection, id).getInt('action_order') !== order) throw new Error('backfill order');
      }
      if (app.findRecordById('action_sequence', 'eventactions001').getInt('value') !== 3) throw new Error('counter backfill');
      const b = app.findRecordById('broadcasts', 'ddddddddddddddd');
      if (b.getString('at') !== b.getString('created')) throw new Error('broadcast backfill');
    }, app => {})`);
    const output = execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', 'up', '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000 });
    expect(output).toContain('1758830000_verify_upgrade');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
