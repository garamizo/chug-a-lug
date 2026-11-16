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
    const down = run('down', '5');
    expect(down).toContain('Reverted 1759100001_retire_boarding');
    expect(down).toContain('Reverted 1759100000_join_link');
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
    expect(run('down', '5')).toContain('Reverted 1759000000_password_sign_in');
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

it('join link adds its collections and rolls back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-joinlink-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    // Sorts after 1759100000_join_link.js, so it runs after the migration under test.
    await writeFile(join(migrations, '1759100000_zcheck_up.js'), `migrate(app => {
      const links = app.findCollectionByNameOrId('join_links');
      const hash = links.fields.getByName('token_hash');
      if (!hash || !hash.hidden || !hash.required) throw new Error('token_hash');
      for (const f of ['seats', 'seats_left', 'expires_at', 'revoked_at', 'created', 'updated']) if (!links.fields.getByName(f)) throw new Error('join_links.' + f);
      const su = app.findCollectionByNameOrId('signups');
      for (const f of ['email', 'name', 'name_key', 'password_hash', 'code_hash', 'secret_hash']) {
        if (!su.fields.getByName(f)) throw new Error('signups.' + f);
      }
      for (const f of ['password_hash', 'code_hash', 'secret_hash']) if (!su.fields.getByName(f).hidden) throw new Error(f + ' not hidden');
      for (const f of ['link', 'user', 'expires_at', 'created', 'updated']) if (!su.fields.getByName(f)) throw new Error('signups.' + f);
      for (const c of [links, su]) if (c.listRule !== null || c.viewRule !== null || c.createRule !== null || c.updateRule !== null || c.deleteRule !== null) throw new Error('rule open on ' + c.name);
      for (const v of ['link_created', 'link_revoked', 'joined']) {
        const r = new Record(app.findCollectionByNameOrId('access_log'));
        r.set('event', v); app.save(r);
      }
    }, app => {})`);
    const run = (...args: string[]) => execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', ...args, '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, input: 'y\n', stdio: 'pipe', env: { ...process.env, CONDUCTOR_EMAIL: 'conductor@test.invalid' } });
    expect(run('up')).toContain('1759100000_zcheck_up');
    const down = run('down', '4');
    expect(down).toContain('Reverted 1759100001_retire_boarding');
    expect(down).toContain('Reverted 1759100000_zcheck_up');
    expect(down).toContain('Reverted 1759100000_join_link');
    await writeFile(join(migrations, '1759099999_check_down.js'), `migrate(app => {
      for (const n of ['join_links', 'signups']) { let found = true; try { app.findCollectionByNameOrId(n) } catch (_) { found = false } if (found) throw new Error(n + ' kept') }
    }, app => {})`);
    const again = run('up');
    expect(again).toContain('1759099999_check_down');
    expect(again).toContain('1759100000_join_link');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('retire boarding leaves a superuser-only users update rule closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-retire-null-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    await writeFile(join(migrations, '1759100000_znull_rule.js'), `migrate(app => {
      const users = app.findCollectionByNameOrId('users');
      users.updateRule = null;
      app.save(users);
    }, app => {})`);
    // '' would let anyone edit any user; null keeps updates superuser-only.
    await writeFile(join(migrations, '1759100001_zcheck_null_rule.js'), `migrate(app => {
      const rule = app.findCollectionByNameOrId('users').updateRule;
      if (rule !== null && rule !== undefined) throw new Error('updateRule opened: ' + JSON.stringify(rule));
    }, app => {})`);
    const out = execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', 'up', '--dir', join(dir, 'data'), '--migrationsDir', migrations, '--hooksDir', hooks],
      { encoding: 'utf8', timeout: 15000, stdio: 'pipe', env: { ...process.env, CONDUCTOR_EMAIL: 'conductor@test.invalid' } });
    expect(out).toContain('1759100001_zcheck_null_rule');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('retire boarding drops the queue and survives a log row pointing at a request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-retire-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    // Sorts between 1759100000_join_link.js and 1759100001_retire_boarding.js: the schema retire meets in production.
    await writeFile(join(migrations, '1759100000_zretire_fixture.js'), `migrate(app => {
      const users = app.findCollectionByNameOrId('users');
      users.oauth2.providers = [{ name: 'google', clientId: 'fixture-id', clientSecret: 'fixture-secret' }];
      users.oauth2.enabled = true;
      app.save(users);
      if (!users.otp.enabled) throw new Error('fixture expects OTP on');
      const u = new Record(users);
      u.set('name', 'Boarded'); u.set('name_key', 'boarded'); u.setEmail('boarded@test.invalid'); u.setPassword('legacy-password-only'); app.save(u);
      const ext = new Record(app.findCollectionByNameOrId('_externalAuths'));
      ext.set('collectionRef', users.id); ext.set('recordRef', u.id); ext.set('provider', 'google'); ext.set('providerId', 'fixture-sub'); app.save(ext);
      const r = new Record(app.findCollectionByNameOrId('boarding_requests'));
      r.set('name', 'Boarded'); r.set('name_key', 'boarded'); r.set('email', 'boarded@test.invalid'); r.set('method', 'email'); r.set('status', 'aboard'); app.save(r);
      const log = new Record(app.findCollectionByNameOrId('access_log'));
      log.set('id', 'retirefixture01'); log.set('event', 'let_aboard'); log.set('request', r.id); log.set('user', u.id); app.save(log);
    }, app => {})`);
    await writeFile(join(migrations, '1759100001_zcheck_retire.js'), `migrate(app => {
      let found = true; try { app.findCollectionByNameOrId('boarding_requests') } catch (_) { found = false }
      if (found) throw new Error('boarding_requests kept');
      const log = app.findCollectionByNameOrId('access_log');
      if (log.fields.getByName('request')) throw new Error('access_log.request kept');
      if (app.findRecordById('access_log', 'retirefixture01').getString('event') !== 'let_aboard') throw new Error('history lost');
      const u = app.findCollectionByNameOrId('users');
      if (u.otp.enabled) throw new Error('otp on');
      if (u.oauth2.enabled || u.oauth2.providers.length !== 0) throw new Error('oauth2 on');
      if (u.fields.getByName('approved_by')) throw new Error('approved_by kept');
      if (u.updateRule.indexOf('approved_by') >= 0) throw new Error('updateRule mentions approved_by: ' + u.updateRule);
      for (const f of ['email', 'is_admin', 'blocked', 'name_key', 'verified', 'password', 'last_seen']) {
        if (u.updateRule.indexOf('@request.body.' + f + ':isset = false') < 0) throw new Error('updateRule leaves ' + f + ' open');
      }
      if (app.findRecordsByFilter('_externalAuths', "collectionRef = {:c}", '', 0, 0, { c: u.id }).length) throw new Error('external auths kept');
      const labels = app.settings().rateLimits.rules.map((r) => r.label);
      for (const l of ['users:requestOTP', 'users:authWithOTP', 'users:authWithOAuth2']) if (labels.indexOf(l) >= 0) throw new Error('rule kept ' + l);
      if (labels.indexOf('users:authWithPassword') < 0) throw new Error('password rule lost');
    }, app => {})`);
    const run = (...args: string[]) => execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', ...args, '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, input: 'y\n', stdio: 'pipe', env: { ...process.env, CONDUCTOR_EMAIL: 'conductor@test.invalid' } });
    expect(run('up')).toContain('1759100001_zcheck_retire');
    const down = run('down', '3');
    expect(down).toContain('Reverted 1759100001_zcheck_retire');
    expect(down).toContain('Reverted 1759100001_retire_boarding');
    // Unapplied and older than retire, so the next `up` runs it first, on the rolled-back schema.
    await writeFile(join(migrations, '1759100000_zzcheck_down.js'), `migrate(app => {
      const requests = app.findCollectionByNameOrId('boarding_requests');
      for (const f of ['name', 'email', 'method', 'status', 'decoy', 'password_hash', 'decided_by', 'user', 'notified_at']) if (!requests.fields.getByName(f)) throw new Error('boarding_requests.' + f);
      const rel = app.findCollectionByNameOrId('access_log').fields.getByName('request');
      if (!rel || rel.collectionId !== requests.id) throw new Error('access_log.request');
      const u = app.findCollectionByNameOrId('users');
      if (!u.otp.enabled) throw new Error('otp off');
      if (!u.fields.getByName('approved_by')) throw new Error('approved_by');
      if (u.updateRule.indexOf('@request.body.approved_by:isset = false') < 0) throw new Error('updateRule: ' + u.updateRule);
      const labels = app.settings().rateLimits.rules.map((r) => r.label);
      for (const l of ['users:requestOTP', 'users:authWithOTP', 'users:authWithOAuth2']) if (labels.indexOf(l) < 0) throw new Error('rule missing ' + l);
      if (app.findRecordById('access_log', 'retirefixture01').getString('request') !== '') throw new Error('request link came back');
    }, app => {})`);
    const again = run('up');
    expect(again).toContain('1759100000_zzcheck_down');
    expect(again).toContain('1759100001_retire_boarding');
    expect(again).toContain('1759100001_zcheck_retire');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('the run-home migration backfills Aurora where there was no Board at station and lets a leg end there', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-runhome-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) {
      await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    }
    await writeFile(join(migrations, '1759199000_run_home_fixture.js'), `migrate(app => {
      const u = new Record(app.findCollectionByNameOrId('users'));
      u.set('name', 'Home Runner'); u.set('name_key', 'home runner'); u.set('email', 'home@test.invalid'); u.setPassword('legacy-password-only'); app.save(u);
      for (const [id, title, station] of [['homeemptyroute1', 'Empty', ''], ['homenaperroute1', 'Naper', 'NAPERVILLE']]) {
        const it = new Record(app.findCollectionByNameOrId('itineraries'));
        it.set('id', id); it.set('title', title); it.set('title_key', title.toLowerCase()); it.set('status', 'draft');
        it.set('event_date', '2026-12-26'); it.set('start_time', '11:00'); it.set('created_by', u.id);
        it.set('start_station', station); it.set('start_station_name', station ? 'Naperville' : '');
        app.save(it);
      }
    }, app => {})`);
    await writeFile(join(migrations, '1759200500_verify_run_home.js'), `migrate(app => {
      const empty = app.findRecordById('itineraries', 'homeemptyroute1');
      if (empty.getString('start_station') !== 'AURORA' || empty.getString('start_station_name') !== 'Aurora') throw new Error('Aurora backfill');
      const naper = app.findRecordById('itineraries', 'homenaperroute1');
      if (naper.getString('start_station') !== 'NAPERVILLE') throw new Error('Naperville kept');
      const stop = new Record(app.findCollectionByNameOrId('stops'));
      stop.set('itinerary', 'homeemptyroute1'); stop.set('name', 'Last'); stop.set('station_id', 'CUS'); app.save(stop);
      const leg = new Record(app.findCollectionByNameOrId('legs'));
      leg.set('itinerary', 'homeemptyroute1'); leg.set('from_stop', stop.id); leg.set('to_stop', ''); leg.set('kind', 'impossible');
      leg.set('reason', 'after_midnight'); app.save(leg);
      if (app.findRecordById('legs', leg.id).getString('reason') !== 'after_midnight') throw new Error('reason not stored');
    }, app => {})`);
    const output = execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', 'up', '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000 });
    expect(output).toContain('1759200500_verify_run_home');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
