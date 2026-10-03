// Shared crew-access helpers. Everything is a function so this file loads outside PocketBase too
// (web/tests/unit/oauthDecision.test.ts); nothing touches $app or a global at load time.
const DENIALS = ['rate_limited', 'turnstile_failed', 'sign_in_refused']

exports.METHODS = { otp: 'email', oauth2: 'google', rehearsal: 'rehearsal' }

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

// Denials are throttled per IP and event, so a flood writes one row per 15 min, not one per hit.
// Never call this with a denial event inside a transaction: limits.consume opens its own.
exports.logEvent = function (app, fields, info) {
  info = info || {}
  if (DENIALS.indexOf(fields.event) >= 0) {
    const limits = require(`${__hooks}/limits.js`)
    if (!limits.consume('log:' + fields.event + ':' + (info.ip || ''), 1, 900)) return
  }
  const r = new Record(app.findCollectionByNameOrId('access_log'))
  for (const k of ['event', 'method', 'name', 'email', 'user', 'actor', 'request', 'detail']) if (fields[k]) r.set(k, String(fields[k]).slice(0, 300))
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
  if (c.getBool('is_admin') && c.verified() && !c.getBool('blocked') && c.id) return c
  c.setVerified(true)
  c.set('is_admin', true)
  c.set('blocked', false)
  app.save(c)
  return c
}

// Spec §2.5. Pure. PocketBase resolves `record` by existing link, then by the *authenticated
// caller*, then by email, so an existing record does not imply a matching email.
exports.oauthDecision = function (x) {
  if (!x.oauthEmailVerified) return 'refuse_unverified'
  if (x.isNewRecord) return x.hasName ? 'request' : 'refuse_new'
  if (x.blocked) return 'refuse_blocked'
  if (String(x.recordEmail || '').toLowerCase() !== String(x.oauthEmail || '').toLowerCase()) return 'refuse_mismatch'
  return 'continue'
}

// Every way a session is issued passes here (spec §2.8).
exports.signInGuard = function (app, record, method, info) {
  if (record.getBool('blocked')) {
    exports.logEvent(app, { event: 'sign_in_refused', method, user: record.id, email: record.email(), detail: 'blocked' }, info)
    return { status: 403, message: 'Your seat was taken away. Ask the Conductor.' }
  }
  // One column by SQL: saving the loaded record could write back a stale blocked flag or token key.
  app.db().newQuery('UPDATE users SET last_seen = {:t} WHERE id = {:id}').bind({ t: new Date().toISOString().replace('T', ' '), id: record.id }).execute()
  exports.logEvent(app, { event: 'signed_in', method, user: record.id, name: record.getString('name'), email: record.email() }, info)
  return null
}
