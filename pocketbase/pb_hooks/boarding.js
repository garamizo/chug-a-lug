// Boarding (spec §2): how a stranger becomes crew. Guests file a request; any approved crew
// member decides (decide, Task 6). A decoy is a real row that can never verify, used whenever
// telling the truth would reveal that an email is a member or already waiting.
const nowIso = () => new Date().toISOString()
const ago = (minutes) => new Date(Date.now() - minutes * 60e3).toISOString().replace('T', ' ')

// What a decoy's address is told instead of a code: the truth, which only the mailbox sees.
function notice(app, member, email) {
  return member
    ? { to: [email], subject: 'You already have a seat', text: `Someone tried to board the Chug-a-Lug with this address. You already have a seat: sign in at ${app.settings().meta.appURL}/login` }
    : { to: [email], subject: 'Your boarding request is already waiting', text: 'Your boarding request is already waiting for the crew. Nothing else to do: you will get an email when you are aboard.' }
}
const codeMail = (email, code) => ({ to: [email], subject: 'Your Chug-a-Lug boarding code', text: `Your Chug-a-Lug boarding code: ${code}\n\nIt works for 15 minutes.` })

// 'ok', 'rejected' (the check said no) or 'unavailable' (siteverify could not answer): an outage
// is the server's problem, never the visitor's, so it is not logged as a failed check (spec §8).
exports.turnstile = function (secret, token, ip) {
  if (!token) return 'rejected'
  let res
  try {
    res = $http.send({
      url: $os.getenv('TURNSTILE_VERIFY_URL') || 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      method: 'POST', timeout: 10,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'secret=' + encodeURIComponent(secret) + '&response=' + encodeURIComponent(token) + '&remoteip=' + encodeURIComponent(ip)
    })
  } catch (_) { return 'unavailable' }
  if (res.statusCode !== 200) return 'unavailable'
  return res.json && res.json.success === true ? 'ok' : 'rejected'
}

exports.findRequest = function (body) {
  const crew = require(`${__hooks}/crew.js`)
  if (typeof body.request_id !== 'string' || typeof body.secret !== 'string') return null
  let r
  try { r = $app.findRecordById('boarding_requests', body.request_id) } catch (_) { return null }
  return $security.equal(r.getString('secret_hash'), crew.hash(body.secret)) ? r : null
}

// Shared by email sign-up (join) and Google sign-up (the OAuth2 hook). Returns [status, json].
// Every check and the write share one transaction: PocketBase serialises write transactions, so
// two concurrent joins cannot both pass a cap or both claim a name.
exports.fileRequest = function (e, x) {
  const crew = require(`${__hooks}/crew.js`)
  const { name, email, method, info, passwordHash } = x
  const ip = info.ip
  const secret = $security.randomString(43)
  const code = $security.randomStringWithAlphabet(6, '0123456789')
  let outcome = '', record = null, member = false, decoy = false
  $app.runInTransaction((tx) => {
    const n = (filter, params) => tx.findRecordsByFilter('boarding_requests', filter, '', 0, 0, params || {}).length
    // Each path is held to the caps of the state it files into: an email request starts
    // unverified (verify then checks the waiting caps), a Google request starts waiting. Decided
    // before the email is looked at, so a decoy meets exactly the caps a real request would.
    const full = method === 'email'
      ? n("status = 'unverified' && ip = {:ip}", { ip }) >= 2 || n("status = 'unverified'") >= 10
      : n("status = 'waiting' && ip = {:ip}", { ip }) >= 3 || n("status = 'waiting'") >= 20
    if (full) { outcome = 'full'; return }
    // A name is held by users and waiting requests only, and is checked by name alone. Unverified
    // requests hold nothing (verify re-checks), so no answer here depends on the email.
    let taken = false
    try { tx.findFirstRecordByData('users', 'name_key', name.key); taken = true } catch (_) {}
    if (!taken) taken = n("name_key = {:k} && decoy = false && status = 'waiting'", { k: name.key }) > 0
    if (taken) { outcome = 'taken'; return }
    try { tx.findAuthRecordByEmail('users', email); member = true } catch (_) {}
    decoy = member || n("email = {:e} && status = 'waiting' && decoy = false", { e: email }) > 0
    // A repeat sign-up updates the open unverified request for this email in place, decoy or not,
    // so every address answers a second sign-up with the same request id.
    const open = tx.findRecordsByFilter('boarding_requests', "email = {:e} && status = 'unverified' && decoy = " + (decoy ? 'true' : 'false'), '-created', 1, 0, { e: email })
    record = open.length ? open[0] : new Record(tx.findCollectionByNameOrId('boarding_requests'))
    record.set('name', name.display)
    record.set('name_key', name.key)
    record.set('email', email)
    record.set('method', method)
    record.set('password_hash', passwordHash || '') // decoys too: same cost, same answer; never applied
    record.set('decoy', decoy)
    record.set('status', decoy || method === 'email' ? 'unverified' : 'waiting')
    record.set('status_at', nowIso())
    record.set('secret_hash', crew.hash(secret))
    record.set('code_hash', decoy ? crew.hash($security.randomString(32)) : (method === 'email' ? crew.hash(code) : ''))
    record.set('code_attempts', 0)
    record.set('code_sent_at', nowIso())
    for (const k of ['ip', 'country', 'city', 'user_agent']) record.set(k, info[k])
    tx.save(record)
    outcome = 'ok'
  })
  if (outcome === 'full') {
    crew.logEvent($app, { event: 'rate_limited', detail: 'boarding caps', name: name.display }, info)
    return [429, { message: 'Too many people are waiting to board. Try again later.' }]
  }
  if (outcome === 'taken') return [409, { message: 'That name is taken. Add an initial?' }]
  try {
    if (decoy) crew.sendMail($app, notice($app, member, email))
    else if (method === 'email') crew.sendMail($app, codeMail(email, code))
  } catch (err) {
    // Expire only the version written above: a concurrent re-signup may already have replaced it.
    $app.runInTransaction((tx) => {
      const r = tx.findRecordById('boarding_requests', record.id)
      // Join mails only unverified rows, and only the sweep may expire a waiting one (spec §1).
      if (r.getString('secret_hash') === crew.hash(secret) && r.getString('status') === 'unverified') { r.set('status', 'expired'); r.set('status_at', nowIso()); r.set('password_hash', ''); tx.save(r) }
    })
    crew.logEvent($app, { event: 'mail_failed', email, request: record.id, detail: String(err).slice(0, 200) }, info)
    return [502, { message: "Couldn't send the email. Try Google or try later." }]
  }
  crew.logEvent($app, { event: 'boarding_requested', method, name: name.display, email, request: record.id }, info)
  if (!decoy && method === 'google') try { exports.notifyConductors($app) } catch (_) { /* the sweep retries */ }
  return [method === 'google' ? 202 : 200, method === 'google' ? { pending: true, request_id: record.id, secret } : { request_id: record.id, secret }]
}

exports.join = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const limits = require(`${__hooks}/limits.js`)
  const normalizeName = require(`${__hooks}/names.js`)
  const info = crew.clientInfo(e)
  const body = e.requestInfo().body
  if (!limits.consume('join:' + info.ip, 5, 3600)) {
    crew.logEvent($app, { event: 'rate_limited', detail: 'join' }, info)
    return e.json(429, { message: 'Too many attempts. Try again in an hour.' })
  }
  const secret = $os.getenv('TURNSTILE_SECRET')
  if (!secret) return e.json(503, { message: 'Boarding is not configured on the server.' })
  const human = exports.turnstile(secret, typeof body.turnstile === 'string' ? body.turnstile : '', info.ip)
  if (human === 'unavailable') return e.json(503, { message: "Couldn't reach the human check. Try Google or try again later." })
  if (human !== 'ok') {
    crew.logEvent($app, { event: 'turnstile_failed' }, info)
    return e.json(400, { message: "Couldn't confirm you're human. Try again." })
  }
  const name = normalizeName(body.name)
  if (!name) return e.json(400, { message: "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -" })
  const email = crew.normalizeEmail(body.email)
  if (!email) return e.json(400, { message: 'Enter a valid email address.' })
  const problem = crew.passwordProblem(body.password)
  if (problem) return e.json(400, { message: problem })
  const [status, json] = exports.fileRequest(e, { name, email, method: 'email', info, passwordHash: crew.hashPassword($app, body.password) })
  return e.json(status, json)
}

// The secret, the state, the code and the transition are judged on one transactional read, so a
// concurrent re-signup (new secret) or decision cannot slip between check and write. Promotion to
// waiting re-checks the waiting caps and the name, which unverified requests never held.
exports.verify = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const body = e.requestInfo().body
  if (typeof body.request_id !== 'string' || typeof body.secret !== 'string') return e.json(404, { message: 'Request not found.' })
  let outcome = 'missing', request = null
  $app.runInTransaction((tx) => {
    let r
    try { r = tx.findRecordById('boarding_requests', body.request_id) } catch (_) { return }
    if (!$security.equal(r.getString('secret_hash'), crew.hash(body.secret))) return
    request = r
    const age = Date.now() / 1000 - r.getDateTime('code_sent_at').unix()
    if (r.getString('status') !== 'unverified' || r.getInt('code_attempts') >= 5 || age > 900) { outcome = 'expired'; return }
    const good = !r.getBool('decoy') && r.getString('code_hash') !== '' && $security.equal(r.getString('code_hash'), crew.hash(String(body.code || '')))
    // Only a wrong code spends an attempt: a full queue or a lost name refuses a proven code,
    // which must still work once a slot frees.
    if (!good) { r.set('code_attempts', r.getInt('code_attempts') + 1); tx.save(r); outcome = 'wrong'; return }
    const n = (filter, params) => tx.findRecordsByFilter('boarding_requests', filter, '', 0, 0, params || {}).length
    if (n("status = 'waiting' && ip = {:ip}", { ip: r.getString('ip') }) >= 3 || n("status = 'waiting'") >= 20) outcome = 'full'
    else {
      let taken = false
      try { tx.findFirstRecordByData('users', 'name_key', r.getString('name_key')); taken = true } catch (_) {}
      if (!taken) taken = n("name_key = {:k} && decoy = false && status = 'waiting'", { k: r.getString('name_key') }) > 0
      if (taken) outcome = 'taken'
      else { r.set('code_hash', ''); r.set('status', 'waiting'); r.set('status_at', nowIso()); tx.save(r); outcome = 'ok' }
    }
  })
  if (outcome === 'missing') return e.json(404, { message: 'Request not found.' })
  if (outcome === 'expired') return e.json(410, { message: 'That code expired. Start again.' })
  if (outcome === 'wrong') return e.json(400, { message: "That code isn't right." })
  if (outcome === 'full') return e.json(429, { message: 'Too many people are waiting to board. Try again later.' })
  if (outcome === 'taken') return e.json(409, { message: 'That name was just taken. Board again with another.' })
  crew.logEvent($app, { event: 'boarding_verified', method: 'email', email: request.getString('email'), name: request.getString('name'), request: request.id }, crew.clientInfo(e))
  try { exports.notifyConductors($app) } catch (_) { /* the sweep retries */ }
  return e.json(200, { status: 'waiting' })
}

exports.status = function (e) {
  const r = exports.findRequest(e.requestInfo().body)
  if (!r) return e.json(404, { message: 'Request not found.' })
  return e.json(200, { status: r.getString('status') })
}

// Transactional for the same reason as verify. The once-a-minute rule lives in code_sent_at, so
// tests can backdate it.
exports.resend = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const body = e.requestInfo().body
  if (typeof body.request_id !== 'string' || typeof body.secret !== 'string') return e.json(404, { message: 'Request not found.' })
  const code = $security.randomStringWithAlphabet(6, '0123456789')
  let outcome = 'missing', email = '', decoy = false, member = false
  $app.runInTransaction((tx) => {
    let r
    try { r = tx.findRecordById('boarding_requests', body.request_id) } catch (_) { return }
    if (!$security.equal(r.getString('secret_hash'), crew.hash(body.secret))) return
    if (r.getString('status') !== 'unverified') { outcome = 'closed'; return }
    // At most three resends per request, decoys included: a request cannot be used to mail-bomb an
    // address. A repeat sign-up updates the same row and does not reset the count.
    if (r.getInt('resends') >= 3) { outcome = 'capped'; return }
    if (Date.now() / 1000 - r.getDateTime('code_sent_at').unix() < 60) { outcome = 'early'; return }
    decoy = r.getBool('decoy')
    email = r.getString('email')
    // A decoy repeats the notice that fits its address now: a seat, or a request already waiting.
    if (decoy) {
      try { tx.findAuthRecordByEmail('users', email); member = true } catch (_) {}
    } else {
      r.set('code_hash', crew.hash(code))
    }
    r.set('code_attempts', 0)
    r.set('code_sent_at', nowIso())
    r.set('resends', r.getInt('resends') + 1)
    tx.save(r)
    outcome = 'ok'
  })
  if (outcome === 'missing') return e.json(404, { message: 'Request not found.' })
  if (outcome === 'closed') return e.json(410, { message: 'That request is no longer open.' })
  if (outcome === 'capped') return e.json(429, { message: "That's enough codes for now. Start again later." })
  if (outcome === 'early') return e.json(429, { message: 'Wait a minute before asking again.' })
  try {
    crew.sendMail($app, decoy ? notice($app, member, email) : codeMail(email, code))
  } catch (_) { return e.json(502, { message: "Couldn't send the email. Try later." }) }
  return e.json(200, {})
}

// Spec §2.5: called from onRecordAuthWithOAuth2Request. Returns true when it answered the request.
exports.googleRequest = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const limits = require(`${__hooks}/limits.js`)
  const normalizeName = require(`${__hooks}/names.js`)
  const info = crew.clientInfo(e)
  const u = e.oAuth2User
  const raw = (u && u.rawUser) || {}
  const decision = crew.oauthDecision({
    isNewRecord: e.isNewRecord, hasName: !!(e.createData && e.createData.name), blocked: !!(e.record && e.record.getBool('blocked')),
    recordEmail: e.record ? e.record.email() : '', oauthEmail: (u && u.email) || '', oauthEmailVerified: raw.email_verified === true || raw.verified_email === true
  })
  const refuse = (message, detail) => { crew.logEvent($app, { event: 'sign_in_refused', method: 'google', email: (u && u.email) || '', detail }, info); e.json(403, { message }); return true }
  if (decision === 'continue') return false
  if (decision === 'refuse_unverified') return refuse("Google hasn't verified this email.", 'unverified google email')
  if (decision === 'refuse_new') return refuse('No seat for this Google account yet. Board first.', 'no account')
  if (decision === 'refuse_blocked') return refuse('Your seat was taken away. Ask the Conductor.', 'blocked')
  if (decision === 'refuse_mismatch') return refuse("This Google account's email doesn't match your seat. Use an email code.", 'email mismatch')
  // decision === 'request'
  if (!limits.consume('join:' + info.ip, 5, 3600)) { crew.logEvent($app, { event: 'rate_limited', detail: 'join' }, info); e.json(429, { message: 'Too many attempts. Try again in an hour.' }); return true }
  const name = normalizeName(e.createData.name)
  if (!name) { e.json(400, { message: "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -" }); return true }
  const email = crew.normalizeEmail(u.email)
  if (!email) { e.json(400, { message: "Google didn't share an email address." }); return true }
  const [status, json] = exports.fileRequest(e, { name, email, method: 'google', info })
  e.json(status, json)
  return true
}

// Found and expired on one transactional read, so a decision or a verify cannot land between the
// two and be overwritten. The notification runs after the commit: it may consume a limit.
exports.sweep = function (app) {
  app.runInTransaction((tx) => {
    for (const r of tx.findRecordsByFilter('boarding_requests', "status = 'unverified' && status_at < {:t}", '', 0, 0, { t: ago(30) })
      .concat(tx.findRecordsByFilter('boarding_requests', "status = 'waiting' && status_at < {:t}", '', 0, 0, { t: ago(72 * 60) }))) {
      r.set('status', 'expired'); r.set('status_at', nowIso()); r.set('password_hash', ''); tx.save(r)
    }
  })
  exports.notifyConductors(app)
}

exports.daily = function (app) {
  app.db().newQuery('DELETE FROM access_log WHERE created < {:t}').bind({ t: ago(90 * 24 * 60) }).execute()
  app.db().newQuery('DELETE FROM access_log WHERE id NOT IN (SELECT id FROM access_log ORDER BY created DESC LIMIT 10000)').execute()
  app.db().newQuery("UPDATE boarding_requests SET password_hash = '' WHERE password_hash != '' AND status NOT IN ('unverified', 'waiting')").execute()
}

exports.notifyConductors = function (app) {
  const crew = require(`${__hooks}/crew.js`)
  const limits = require(`${__hooks}/limits.js`)
  const pending = app.findRecordsByFilter('boarding_requests', "status = 'waiting' && decoy = false && notified_at = ''", 'created', 50, 0)
  if (!pending.length) return
  const to = app.findRecordsByFilter('users', 'is_admin = true && verified = true && blocked = false', '', 20, 0).map((u) => u.email()).filter(Boolean)
  const interval = parseInt($os.getenv('NOTIFY_INTERVAL_SECONDS'), 10)
  if (!to.length || !limits.consume('notify', 1, isNaN(interval) ? 600 : interval)) return
  const lines = pending.map((r) => `• ${r.getString('name')} <${r.getString('email')}> — ${r.getString('user_agent').slice(0, 60)} · ${r.getString('country') || '??'} · ${r.getString('created')}`)
  try {
    crew.sendMail(app, { to, subject: `${pending.length} waiting to board the Chug-a-Lug`, text: `${lines.join('\n')}\n\nOpen the Crew Board to let them aboard: ${app.settings().meta.appURL}/crew` })
  } catch (err) {
    crew.logEvent(app, { event: 'mail_failed', detail: 'conductor notice: ' + String(err).slice(0, 180) })
    app.db().newQuery("DELETE FROM _crawl_limits WHERE key = 'notify'").execute() // let the sweep retry now
    return
  }
  // One column, by SQL: a decision landing during the send is not overwritten by a stale save.
  const now = new Date().toISOString().replace('T', ' ')
  for (const r of pending) app.db().newQuery('UPDATE boarding_requests SET notified_at = {:t} WHERE id = {:id}').bind({ t: now, id: r.id }).execute()
}

exports.decide = function (e, verdict) {
  const crew = require(`${__hooks}/crew.js`)
  const auth = e.auth
  if (!auth || auth.collection().name !== 'users' || auth.getBool('blocked')) return e.json(401, { message: 'Sign in first.' })
  const id = e.request.pathValue('id')
  let result = null, user = null, request = null, installed = false, method = ''
  $app.runInTransaction((tx) => {
    try { request = tx.findRecordById('boarding_requests', id) } catch (_) { result = [404, 'Request not found.']; return }
    if (request.getBool('decoy') || request.getString('status') !== 'waiting') { result = [409, 'Someone already answered this one.']; return }
    method = request.getString('method')
    if (verdict === 'aboard') {
      let clash = false
      try { tx.findFirstRecordByData('users', 'name_key', request.getString('name_key')); clash = true } catch (_) {}
      try { tx.findAuthRecordByEmail('users', request.getString('email')); clash = true } catch (_) {}
      if (clash) { result = [409, 'That name or email now belongs to someone aboard. Turn this one away.']; return }
      user = new Record(tx.findCollectionByNameOrId('users'))
      user.set('name', request.getString('name'))
      user.set('name_key', request.getString('name_key'))
      user.setEmail(request.getString('email'))
      user.setVerified(true)
      user.setPassword($security.randomString(40))
      user.set('approved_by', auth.id)
      tx.save(user)
      // The hash /join stored becomes the password (spec §3.2). SQL, because setRaw rejects a hash.
      const hash = request.getString('password_hash')
      if (hash) {
        tx.db().newQuery('UPDATE users SET password = {:h} WHERE id = {:id}').bind({ h: hash, id: user.id }).execute()
        installed = true
      }
      request.set('user', user.id)
    }
    request.set('password_hash', '')
    request.set('status', verdict === 'aboard' ? 'aboard' : 'turned_away')
    request.set('status_at', new Date().toISOString())
    request.set('decided_by', auth.id)
    request.set('decided_at', new Date().toISOString())
    tx.save(request)
    crew.logEvent(tx, { event: verdict === 'aboard' ? 'let_aboard' : 'turned_away', actor: auth.id, user: user ? user.id : '', name: request.getString('name'), email: request.getString('email'), request: request.id }, crew.clientInfo(e))
  })
  if (result) return e.json(result[0], { message: result[1] })
  if (user) {
    const how = installed ? 'with your email and the password you chose' : method === 'google' ? 'with Google' : 'with this email address or Google'
    try { crew.sendMail($app, { to: [user.email()], subject: "You're aboard the Chug-a-Lug", text: `You're aboard! Sign in at ${$app.settings().meta.appURL}/login ${how}.` }) }
    catch (err) { crew.logEvent($app, { event: 'mail_failed', user: user.id, detail: 'aboard notice: ' + String(err).slice(0, 180) }) }
    return e.json(200, { user_id: user.id })
  }
  return e.json(200, {})
}
