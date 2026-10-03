// Crew access (spec 2026-10-03): email identity, boarding requests, access log, tunnel-aware
// settings, and the one-time wipe. Ordered so every save validates: fields first, then the
// Conductor, then the wipe, and only then is email made required. Self-contained on purpose:
// migration tests run with an empty hooks directory. pb_hooks/crew.js ensureConductor mirrors step 3.
migrate((app) => {
  const email = ($os.getenv('CONDUCTOR_EMAIL') || '').trim().toLowerCase()
  if (!email) throw new Error('Set CONDUCTOR_EMAIL before starting PocketBase: the crew-access migration mints the Conductor from it.')
  const ADMIN = '@request.auth.is_admin = true'

  // 1. Schema, email still optional.
  const users = app.findCollectionByNameOrId('users')
  users.fields.add(new BoolField({ name: 'blocked' }))
  users.fields.add(new RelationField({ name: 'approved_by', collectionId: users.id, maxSelect: 1, cascadeDelete: false }))
  users.fields.add(new DateField({ name: 'last_seen' }))
  app.save(users)

  const requests = new Collection({
    type: 'base', name: 'boarding_requests',
    listRule: `@request.auth.id != '' && decoy = false && (status = 'waiting' || ((status = 'aboard' || status = 'turned_away') && decided_at > @yesterday) || ${ADMIN})`,
    viewRule: `@request.auth.id != '' && decoy = false && (status = 'waiting' || ((status = 'aboard' || status = 'turned_away') && decided_at > @yesterday) || ${ADMIN})`,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'name', type: 'text', required: true, min: 2, max: 32 },
      { name: 'name_key', type: 'text', required: true, min: 2, max: 32 },
      { name: 'email', type: 'email', required: true },
      { name: 'method', type: 'select', values: ['email', 'google'], maxSelect: 1, required: true },
      { name: 'status', type: 'select', values: ['unverified', 'waiting', 'aboard', 'turned_away', 'expired'], maxSelect: 1, required: true },
      { name: 'decoy', type: 'bool', hidden: true },
      { name: 'secret_hash', type: 'text', hidden: true },
      { name: 'code_hash', type: 'text', hidden: true },
      { name: 'code_attempts', type: 'number', onlyInt: true },
      { name: 'resends', type: 'number', onlyInt: true, hidden: true },
      { name: 'code_sent_at', type: 'date' },
      { name: 'status_at', type: 'date' },
      { name: 'ip', type: 'text', max: 64 },
      { name: 'country', type: 'text', max: 8 },
      { name: 'city', type: 'text', max: 80 },
      { name: 'user_agent', type: 'text', max: 300 },
      { name: 'decided_by', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'decided_at', type: 'date' },
      { name: 'notified_at', type: 'date' },
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE INDEX idx_boarding_status ON boarding_requests (status, ip)', 'CREATE INDEX idx_boarding_email ON boarding_requests (email)']
  })
  app.save(requests)

  const log = new Collection({
    type: 'base', name: 'access_log', listRule: ADMIN, viewRule: ADMIN, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'event', type: 'select', maxSelect: 1, required: true, values: ['boarding_requested', 'boarding_verified', 'let_aboard', 'turned_away',
        'signed_in', 'sign_in_refused', 'code_sent', 'mail_failed', 'rate_limited', 'turnstile_failed', 'put_off', 'let_back_on', 'name_changed'] },
      { name: 'method', type: 'select', maxSelect: 1, values: ['email', 'google', 'rehearsal'] },
      { name: 'name', type: 'text', max: 64 },
      { name: 'email', type: 'text', max: 254 },
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'actor', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'request', type: 'relation', collectionId: requests.id, maxSelect: 1, cascadeDelete: false },
      { name: 'ip', type: 'text', max: 64 },
      { name: 'country', type: 'text', max: 8 },
      { name: 'city', type: 'text', max: 80 },
      { name: 'user_agent', type: 'text', max: 300 },
      { name: 'detail', type: 'text', max: 300 },
      { name: 'created', type: 'autodate', onCreate: true }
    ],
    indexes: ['CREATE INDEX idx_access_log_created ON access_log (created)']
  })
  app.save(log)

  // 2–3. The Conductor: reuse the account with that email, else mint one under the first free name.
  let conductor = null
  try { conductor = app.findAuthRecordByEmail('users', email) } catch (_) {}
  if (!conductor) {
    let name = 'Conductor'
    for (let n = 2; ; n++) {
      try { app.findFirstRecordByData('users', 'name_key', name.toLowerCase()) } catch (_) { break }
      name = 'Conductor ' + n
    }
    conductor = new Record(users)
    conductor.set('name', name)
    conductor.set('name_key', name.toLowerCase())
    conductor.setEmail(email)
    conductor.setPassword($security.randomString(40))
  }
  conductor.setVerified(true)
  conductor.set('is_admin', true)
  conductor.set('blocked', false)
  app.save(conductor)

  // 4. Routes belong to the Conductor. Raw SQL: no planner hooks, no recompute.
  app.db().newQuery('UPDATE itineraries SET created_by = {:id}').bind({ id: conductor.id }).execute()

  // 5. Every personal row goes, the Conductor's included (an email-matched legacy account keeps
  // nothing but its routes). app.delete removes Freight and comment files with their rows; none of
  // these collections has a delete hook. Bulletins go too: they block user deletion and the Train
  // Sheet copies their bodies. Then everyone else, and the Conductor's old sessions die.
  for (const name of ['reactions', 'chat_messages', 'media', 'drink_entries', 'checkins', 'broadcast_acks', 'broadcasts',
    'event_log', 'approval_votes', 'votes', 'comments']) {
    for (const r of app.findAllRecords(name)) app.delete(r)
  }
  for (const u of app.findAllRecords('users')) if (u.id !== conductor.id) app.delete(u)
  const kept = app.findRecordById('users', conductor.id)
  kept.refreshTokenKey()
  app.save(kept)

  // 6. Email becomes the identity; options and rules for the new sign-in paths.
  const fresh = app.findCollectionByNameOrId('users')
  fresh.fields.getByName('email').required = true
  fresh.otp.enabled = true
  fresh.otp.duration = 600
  fresh.otp.length = 6
  fresh.otp.emailTemplate.subject = 'Your Chug-a-Lug code'
  fresh.otp.emailTemplate.body = '<p>Your Chug-a-Lug sign-in code is <strong>{OTP}</strong>.</p><p>It works for 10 minutes. If you did not ask for it, ignore this email.</p>'
  // 90 days: someone who boards in October and next opens the app on the event day is still aboard.
  // The app renews a session older than a day whenever it opens online (web/src/lib/pb.ts).
  fresh.authToken.duration = 7776000
  // No "new login" emails: every email code or Google sign-in from a new network would send one.
  fresh.authAlert.enabled = false
  // Google sign-in from the environment, so a first deploy has it without a restart.
  // config.pb.js's onBootstrap re-applies the same on every start.
  const googleId = $os.getenv('GOOGLE_CLIENT_ID'), googleSecret = $os.getenv('GOOGLE_CLIENT_SECRET')
  if (googleId && googleSecret) {
    fresh.oauth2.providers = [{ name: 'google', clientId: googleId, clientSecret: googleSecret }]
    fresh.oauth2.enabled = true
  }
  const locked = ['email', 'is_admin', 'blocked', 'approved_by', 'name_key', 'verified', 'password', 'last_seen']
  fresh.updateRule = 'id = @request.auth.id && ' + locked.map((f) => `@request.body.${f}:isset = false`).join(' && ')
  app.save(fresh)
  // Only a minted account that had to take a suffix ("Conductor 2") is renamed; a reused one keeps its name.
  if (/^Conductor \d+$/.test(conductor.getString('name'))) {
    let taken = false
    try { app.findFirstRecordByData('users', 'name_key', 'conductor'); taken = true } catch (_) {}
    if (!taken) { const c = app.findRecordById('users', conductor.id); c.set('name', 'Conductor'); c.set('name_key', 'conductor'); app.save(c) }
  }

  // PB_RATE_LIMITS=off exists for the test harnesses only, which drive everything from one IP;
  // config.pb.js applies the same switch on every start. Rules are added idempotently.
  const s = app.settings()
  s.trustedProxy.headers = ['CF-Connecting-IP']
  s.trustedProxy.useLeftmostIP = false
  s.rateLimits.enabled = $os.getenv('PB_RATE_LIMITS') !== 'off'
  const ours = [
    { label: 'users:requestOTP', maxRequests: 5, duration: 600, audience: '' },
    { label: 'users:authWithOTP', maxRequests: 10, duration: 600, audience: '' },
    { label: 'users:authWithOAuth2', maxRequests: 10, duration: 600, audience: '' }
  ]
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => !ours.some((o) => o.label === r.label)).concat(ours)
  app.save(s)
}, (app) => {
  const s = app.settings()
  s.trustedProxy.headers = []
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => ['users:requestOTP', 'users:authWithOTP', 'users:authWithOAuth2'].indexOf(r.label) < 0)
  app.save(s)
  // Schema only: the wiped data is gone. Restore a backup (OPERATIONS.md) to get it back.
  for (const name of ['access_log', 'boarding_requests']) app.delete(app.findCollectionByNameOrId(name))
  const users = app.findCollectionByNameOrId('users')
  for (const f of ['blocked', 'approved_by', 'last_seen']) users.fields.removeByName(f)
  users.fields.getByName('email').required = false
  users.otp.enabled = false
  users.oauth2.enabled = false
  users.oauth2.providers = []
  users.authToken.duration = 31536000
  users.authAlert.enabled = true
  users.updateRule = "id = @request.auth.id && @request.body.is_admin:isset = false && @request.body.name:isset = false && @request.body.name_key:isset = false && @request.body.password:isset = false"
  app.save(users)
})
