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

it('the route-titles backfill trims a legacy title, so it does not look renamed on the next unrelated update', async () => {
  // Every create/update since planning.pb.js's title hook shipped trims on the way in, so an
  // untrimmed title can only exist in data written before that hook — i.e. before the
  // 1758890000_route_titles.js migration ran. Reproduce that by inserting one directly, ahead of
  // it, the same way the migration test above reproduces pre-upgrade rows.
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-titles-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) {
      await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    }
    await writeFile(join(migrations, '1758885000_legacy_title_fixture.js'), `migrate(app => {
      const u = new Record(app.findCollectionByNameOrId('users'));
      u.set('name', 'Legacy Titler'); u.set('name_key', 'legacy titler'); u.setPassword('legacy-password-only'); app.save(u);
      const it = new Record(app.findCollectionByNameOrId('itineraries'));
      it.set('title', '  Loop  '); it.set('status', 'draft'); it.set('event_date', '2026-12-26');
      it.set('start_time', '11:00'); it.set('created_by', u.id); app.save(it);
    }, app => {})`);
    await writeFile(join(migrations, '1758890500_verify_title_trim.js'), `migrate(app => {
      const rows = app.findRecordsByFilter('itineraries', "title_key = 'loop'", '', 1, 0);
      if (rows.length !== 1) throw new Error('legacy row not found by its recomputed key');
      const it = rows[0];
      if (it.getString('title') !== 'Loop') throw new Error('legacy title not trimmed: ' + JSON.stringify(it.getString('title')));
      if (it.getString('title_key') !== 'loop') throw new Error('title_key not recomputed from the trimmed title');
    }, app => {})`);
    const output = execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', 'up', '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000 });
    expect(output).toContain('1758890500_verify_title_trim');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('crew access keeps routes for the Conductor and wipes every other user and their traces', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-crew-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    await writeFile(join(migrations, '1758895000_crew_fixture.js'), `migrate(app => {
      const mk = (name, admin) => { const u = new Record(app.findCollectionByNameOrId('users'));
        u.set('name', name); u.set('name_key', name.toLowerCase()); u.set('is_admin', admin); u.setPassword('legacy-password-only'); app.save(u); return u };
      const boss = mk('Conductor', true), rider = mk('Rider', false);
      const it = new Record(app.findCollectionByNameOrId('itineraries'));
      it.set('id', 'routeroute00001'); it.set('title', 'Keep me'); it.set('status', 'draft'); it.set('event_date', '2026-12-26');
      it.set('start_time', '11:00'); it.set('created_by', rider.id); app.save(it);
      const stop = new Record(app.findCollectionByNameOrId('stops'));
      stop.set('id', 'stopstopstop001'); stop.set('itinerary', it.id); stop.set('name', 'Keep'); stop.set('station_id', 'CUS'); app.save(stop);
      const c = new Record(app.findCollectionByNameOrId('comments'));
      c.set('user', rider.id); c.set('target_collection', 'itineraries'); c.set('target_id', it.id); c.set('body', 'bye'); app.save(c);
      const d = new Record(app.findCollectionByNameOrId('drink_entries'));
      d.set('user', rider.id); d.set('stop', stop.id); d.set('kind', 'beer'); d.set('at', '2026-12-26T18:00:00Z'); app.save(d);
      const b = new Record(app.findCollectionByNameOrId('broadcasts'));
      b.set('itinerary', it.id); b.set('kind', 'message'); b.set('body', 'secret plan'); b.set('created_by', boss.id); app.save(b);
      const log = new Record(app.findCollectionByNameOrId('event_log'));
      log.set('itinerary', it.id); log.set('kind', 'bulletin'); log.set('payload', { body: 'secret plan' }); log.set('at', '2026-12-26T18:00:00Z'); app.save(log);
      const ack = new Record(app.findCollectionByNameOrId('broadcast_acks'));
      ack.set('broadcast', b.id); ack.set('user', rider.id); app.save(ack);
      const ci = new Record(app.findCollectionByNameOrId('checkins'));
      ci.set('user', rider.id); ci.set('stop', stop.id); ci.set('kind', 'at_stop'); ci.set('at', '2026-12-26T18:00:00Z'); app.save(ci);
      const msg = new Record(app.findCollectionByNameOrId('chat_messages'));
      msg.set('itinerary', it.id); msg.set('user', rider.id); msg.set('body', 'see you there'); app.save(msg);
      const re = new Record(app.findCollectionByNameOrId('reactions'));
      re.set('user', boss.id); re.set('target_kind', 'message'); re.set('target_id', msg.id); re.set('itinerary', it.id); app.save(re);
      const m = new Record(app.findCollectionByNameOrId('media'));
      m.set('user', rider.id); m.set('kind', 'image'); m.set('stop', stop.id);
      m.set('file', $filesystem.fileFromBytes([137, 80, 78, 71, 13, 10, 26, 10], 'freightfixture.png')); app.save(m);
      if (!m.getString('file')) throw new Error('media file not stored');
      // The precondition the wipe is judged against: every seeded collection holds a row.
      for (const name of ['comments', 'drink_entries', 'broadcasts', 'event_log', 'checkins', 'chat_messages', 'reactions', 'media', 'broadcast_acks']) {
        if (app.countRecords(name) === 0) throw new Error(name + ' not seeded');
      }
    }, app => {})`);
    await writeFile(join(migrations, '1758905000_verify_crew.js'), `migrate(app => {
      const users = app.findAllRecords('users');
      if (users.length !== 1) throw new Error('users left: ' + users.length);
      const c = users[0];
      if (c.email() !== 'conductor@test.invalid' || !c.getBool('is_admin') || !c.verified()) throw new Error('conductor fields');
      if (c.getString('name') !== 'Conductor') throw new Error('conductor name: ' + c.getString('name'));
      if (app.findRecordById('itineraries', 'routeroute00001').getString('created_by') !== c.id) throw new Error('route owner');
      app.findRecordById('stops', 'stopstopstop001');
      app.findRecordById('crawl_settings', 'crawlsettings');
      for (const name of ['comments', 'drink_entries', 'broadcasts', 'event_log', 'votes', 'checkins', 'chat_messages', 'reactions', 'media', 'broadcast_acks', 'approval_votes']) {
        if (app.countRecords(name) !== 0) throw new Error(name + ' not wiped');
      }
      const s = app.settings();
      if (s.trustedProxy.headers.join() !== 'CF-Connecting-IP') throw new Error('trusted proxy');
      if (!s.rateLimits.rules.some(r => r.label === 'users:requestOTP')) throw new Error('rate limits');
      const u = app.findCollectionByNameOrId('users');
      if (!u.otp.enabled || !u.fields.getByName('email').required) throw new Error('users options');
      if (u.authToken.duration !== 7776000) throw new Error('token duration: ' + u.authToken.duration);
      if (u.authAlert.enabled) throw new Error('new-login alert emails are on');
      for (const f of ['email', 'is_admin', 'blocked', 'approved_by', 'name_key', 'verified', 'password', 'last_seen']) {
        if (u.updateRule.indexOf('@request.body.' + f + ':isset = false') < 0) throw new Error('updateRule leaves ' + f + ' open');
      }
      if (u.updateRule.indexOf('id = @request.auth.id') !== 0) throw new Error('updateRule owner: ' + u.updateRule);
      const resends = app.findCollectionByNameOrId('boarding_requests').fields.getByName('resends');
      if (!resends || !resends.hidden) throw new Error('boarding_requests.resends');
      app.findCollectionByNameOrId('access_log');
    }, app => {})`);
    const output = execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', 'up', '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, env: { ...process.env, CONDUCTOR_EMAIL: 'conductor@test.invalid' } });
    expect(output).toContain('1758905000_verify_crew');
    // Freight files go with their rows: nothing of the fixture's upload is left in storage.
    const files = (await readdir(join(dir, 'data', 'storage'), { recursive: true }).catch(() => [] as string[])).map(String);
    expect(files.filter((f) => f.includes('freightfixture'))).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('crew access reuses an account that already has the Conductor email, but kills its sessions and activity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-crew-reuse-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    await writeFile(join(migrations, '1758895000_reuse_fixture.js'), `migrate(app => {
      const u = new Record(app.findCollectionByNameOrId('users'));
      u.set('id', 'legacyconductr1'); u.set('name', 'Gui'); u.set('name_key', 'gui'); u.setEmail('conductor@test.invalid');
      u.setPassword('legacy-password-only'); u.set('tokenKey', 'legacy-token-key-legacy-token-key'); app.save(u);
      const it = new Record(app.findCollectionByNameOrId('itineraries'));
      it.set('title', 'Mine'); it.set('status', 'draft'); it.set('event_date', '2026-12-26'); it.set('start_time', '11:00'); it.set('created_by', u.id); app.save(it);
      const stop = new Record(app.findCollectionByNameOrId('stops'));
      stop.set('itinerary', it.id); stop.set('name', 'S'); stop.set('station_id', 'CUS'); app.save(stop);
      const d = new Record(app.findCollectionByNameOrId('drink_entries'));
      d.set('user', u.id); d.set('stop', stop.id); d.set('kind', 'beer'); d.set('at', '2026-12-26T18:00:00Z'); app.save(d);
    }, app => {})`);
    await writeFile(join(migrations, '1758905000_verify_reuse.js'), `migrate(app => {
      const c = app.findRecordById('users', 'legacyconductr1');
      if (!c.getBool('is_admin') || !c.verified()) throw new Error('not promoted');
      if (c.getString('name') !== 'Gui' || c.getString('name_key') !== 'gui') throw new Error('reused account renamed: ' + c.getString('name'));
      if (c.tokenKey() === 'legacy-token-key-legacy-token-key') throw new Error('legacy sessions survive');
      if (app.countRecords('drink_entries') !== 0) throw new Error('conductor activity survived');
    }, app => {})`);
    const output = execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', 'up', '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, env: { ...process.env, CONDUCTOR_EMAIL: 'conductor@test.invalid' } });
    expect(output).toContain('1758905000_verify_reuse');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('crew access can be rolled back and applied again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-crew-redo-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    // `migrate down` asks for confirmation on stdin (and prompts on stderr); answer it quietly.
    const run = (...args: string[]) => execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', ...args, '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, input: 'y\n', stdio: 'pipe', env: { ...process.env, CONDUCTOR_EMAIL: 'conductor@test.invalid' } });
    run('up');
    const down = run('down', '2');
    expect(down).toContain('Reverted 1759000000_password_sign_in');
    expect(down).toContain('Reverted 1758900000_crew_access');
    expect(run('up')).toContain('1758900000_crew_access');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('password sign-in applies its settings, rolls back keeping history, and applies again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-password-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    // Runs after the migration under test: checks the up state and leaves one history row behind.
    await writeFile(join(migrations, '1759000001_check_up.js'), `migrate(app => {
      const u = app.findCollectionByNameOrId('users');
      if (!u.passwordAuth.enabled || JSON.stringify(u.passwordAuth.identityFields) !== '["email"]') throw new Error('password auth');
      const f = u.fields.getByName('password');
      if (f.min !== 8 || f.max !== 64) throw new Error('password limits ' + f.min + '/' + f.max);
      if (u.resetPasswordTemplate.body.indexOf('{APP_URL}/reset-password#{TOKEN}') < 0) throw new Error('reset link');
      if (u.passwordResetToken.duration !== 1800) throw new Error('reset duration');
      const h = app.findCollectionByNameOrId('boarding_requests').fields.getByName('password_hash');
      if (!h || !h.hidden) throw new Error('password_hash');
      const labels = app.settings().rateLimits.rules.map((r) => r.label + '=' + r.maxRequests + '/' + r.duration);
      for (const want of ['users:authWithPassword=20/600', 'users:requestPasswordReset=5/600', 'users:confirmPasswordReset=10/600'])
        if (labels.indexOf(want) < 0) throw new Error('rule ' + want);
      const r = new Record(app.findCollectionByNameOrId('access_log'));
      r.set('event', 'password_set'); r.set('method', 'password'); app.save(r);
    }, app => {})`);
    const run = (...args: string[]) => execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', ...args, '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, input: 'y\n', stdio: 'pipe', env: { ...process.env, CONDUCTOR_EMAIL: 'conductor@test.invalid' } });
    expect(run('up')).toContain('1759000001_check_up');
    expect(run('down', '2')).toContain('Reverted 1759000000_password_sign_in');
    // An older, unapplied file runs first on the next `up`, so it sees the rolled-back state.
    await writeFile(join(migrations, '1758999999_check_down.js'), `migrate(app => {
      const u = app.findCollectionByNameOrId('users');
      if (u.passwordAuth.enabled) throw new Error('password auth still on');
      if (u.resetPasswordTemplate.body.indexOf('/reset-password#') >= 0) throw new Error('template kept');
      if (app.findCollectionByNameOrId('boarding_requests').fields.getByName('password_hash')) throw new Error('password_hash kept');
      if (app.settings().rateLimits.rules.some((r) => r.label === 'users:authWithPassword')) throw new Error('rule kept');
      if (app.findRecordsByFilter('access_log', "method = 'password'", '', 0, 0).length !== 1) throw new Error('history lost');
    }, app => {})`);
    const again = run('up');
    expect(again).toContain('1758999999_check_down');
    expect(again).toContain('1759000000_password_sign_in');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('crew access refuses to run without CONDUCTOR_EMAIL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-crew-noenv-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    const env = { ...process.env }; delete env.CONDUCTOR_EMAIL;
    expect(() => execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', 'up', '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, env, stdio: 'pipe' })).toThrow(/CONDUCTOR_EMAIL/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
