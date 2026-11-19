// Shared crew-access helpers. Everything is a function, so nothing touches $app or a global at load time.
const DENIALS = ['rate_limited', 'sign_in_refused']

// PocketBase auth method → access_log.method. Old rows may still say email or google; they render as logged.
exports.METHODS = { password: 'password', rehearsal: 'rehearsal' }

// Works for a plain request event and for the auth events, which wrap theirs in `requestEvent`.
exports.clientInfo = function (e) {
  const req = (e.requestEvent || e).request
  const h = (k) => String(req.header.get(k) || '')
  return { ip: e.realIP(), country: h('CF-IPCountry').slice(0, 8), city: h('CF-IPCity').slice(0, 80), user_agent: h('User-Agent').slice(0, 300) }
}

exports.hash = function (s) { return $security.sha256(String(s)) }

exports.normalizeEmail = function (x) {
  if (typeof x !== 'string') return null
  const v = x.trim().toLowerCase()
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null
}

// Password spec §3.2. Counted in code points, as PocketBase's password field counts min and max, and
// capped at bcrypt's 72 bytes: the join link's verify installs its hash by SQL, skipping field validation, so it must
// accept exactly what a reset would. web/src/lib/password.ts mirrors this.
exports.passwordProblem = function (p) {
  const refusal = 'Pick a password of 8 to 64 characters.'
  if (typeof p !== 'string') return refusal
  let points = 0, bytes = 0
  for (const ch of p) {
    const c = ch.codePointAt(0)
    points++
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return points < 8 || points > 64 || bytes > 72 ? refusal : null
}

// The bcrypt hash PocketBase would store for `p`, from a throwaway, unsaved users record. Verified on
// 0.40.4 (2026-10-03): written to users.password by SQL, it validates; setRaw of the string does not.
exports.hashPassword = function (app, p) {
  const r = new Record(app.findCollectionByNameOrId('users'))
  r.setPassword(p)
  return r.getRaw('password').hash
}

// Denials are throttled per IP and event, so a flood writes one row per 15 min, not one per hit.
// Never call this with a denial event inside a transaction: limits.consume opens its own.
exports.logEvent = function (app, fields, info) {
  info = info || {}
  if (DENIALS.indexOf(fields.event) >= 0) {
    const limits = require(`${__hooks}/limits.js`)
    if (!limits.consume('log:' + fields.event + ':' + (info.ip || ''), 1, 900)) return
  }
  const r = new Record(app.findCollectionByNameOrId('access_log'))
  for (const k of ['event', 'method', 'name', 'email', 'user', 'actor', 'detail']) if (fields[k]) r.set(k, String(fields[k]).slice(0, 300))
  for (const k of ['ip', 'country', 'city', 'user_agent']) if (info[k]) r.set(k, info[k])
  app.save(r)
}

exports.sendMail = function (app, m) {
  const meta = app.settings().meta
  const message = new MailerMessage({
    from: { address: meta.senderAddress, name: meta.senderName || 'Chug-a-Lug' },
    to: m.to.map((address) => ({ address })),
    subject: m.subject, text: m.text, html: m.html || ''
  })
  app.newMailClient().send(message)
}

// A user's role (spec 2026-11-19 "Data"): empty reads as crew, so sign-ups and fixtures need not set it.
exports.roleOf = function (record) {
  const r = record.getString('role')
  return r === 'trainspotter' || r === 'put_off' ? r : 'crew'
}

exports.isPutOff = function (record) { return exports.roleOf(record) === 'put_off' }

// The single Conductor path at serve time; the migration carries an identical copy (it must run
// with an empty hooks directory). Idempotent: reuse by email, else mint under the first free name.
exports.ensureConductor = function (app, raw) {
  const email = exports.normalizeEmail(raw)
  if (!email) return null
  let c = null
  try { c = app.findAuthRecordByEmail('users', email) } catch (_) {}
  if (!c) {
    let name = 'Conductor'
    for (let n = 2; ; n++) {
      try { app.findFirstRecordByData('users', 'name_key', name.toLowerCase()) } catch (_) { break }
      name = 'Conductor ' + n
    }
    c = new Record(app.findCollectionByNameOrId('users'))
    c.set('name', name)
    c.set('name_key', name.toLowerCase())
    c.setEmail(email)
    c.setPassword($security.randomString(40))
  }
  if (c.getBool('is_admin') && c.verified() && !exports.isPutOff(c) && c.id) return c
  c.setVerified(true)
  c.set('is_admin', true)
  c.set('role', 'crew')
  app.save(c)
  return c
}

// Every way a session is issued passes here (spec §2.8).
exports.signInGuard = function (app, record, method, info) {
  if (exports.isPutOff(record)) {
    exports.logEvent(app, { event: 'sign_in_refused', method, user: record.id, email: record.email(), detail: 'put_off' }, info)
    return { status: 403, message: 'Your seat was taken away. Ask the Conductor.' }
  }
  // One column by SQL: saving the loaded record could write back a stale role or token key.
  app.db().newQuery('UPDATE users SET last_seen = {:t} WHERE id = {:id}').bind({ t: new Date().toISOString().replace('T', ' '), id: record.id }).execute()
  exports.logEvent(app, { event: 'signed_in', method, user: record.id, name: record.getString('name'), email: record.email() }, info)
  return null
}
