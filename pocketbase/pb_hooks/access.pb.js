// Sign-in guards (spec §2.8). A refresh also fires onRecordAuthRequest with an empty authMethod,
// so only real sign-ins are guarded and logged here; refreshes have their own hook. Every non-empty
// method is guarded, including one this app does not offer (password auth switched on in the admin
// UI, say): it is logged with the method left empty, because access_log only knows ours.
onRecordAuthRequest((e) => {
  if (e.authMethod) {
    const crew = require(`${__hooks}/crew.js`)
    const refused = crew.signInGuard($app, e.record, crew.METHODS[e.authMethod] || '', crew.clientInfo(e))
    if (refused) return e.json(refused.status, { message: refused.message })
  }
  e.next()
}, 'users')

onRecordAuthRefreshRequest((e) => {
  if (e.record.getBool('blocked')) return e.json(403, { message: 'Your seat was taken away. Ask the Conductor.' })
  const seen = e.record.getDateTime('last_seen')
  if (seen.isZero() || Date.now() / 1000 - seen.unix() > 600) {
    $app.db().newQuery('UPDATE users SET last_seen = {:t} WHERE id = {:id}').bind({ t: new Date().toISOString().replace('T', ' '), id: e.record.id }).execute()
  }
  e.next()
}, 'users')

// PocketBase sends OTP mail after replying, so success is logged only once the send returns.
// A put-off seat gets no code: skipping e.next() skips only the send. The request was already
// answered with an otpId, exactly as for an address that has no seat, so nothing is revealed.
onMailerRecordOTPSend((e) => {
  if (e.record.getBool('blocked')) return
  e.next()
  require(`${__hooks}/crew.js`).logEvent($app, { event: 'code_sent', method: 'email', user: e.record.id, email: e.record.email() })
}, 'users')

routerAdd('POST', '/api/crawl/users/{id}/put-off', (e) => require(`${__hooks}/access.js`).setBlocked(e, true))
routerAdd('POST', '/api/crawl/users/{id}/let-back-on', (e) => require(`${__hooks}/access.js`).setBlocked(e, false))
routerAdd('GET', '/api/crawl/manifest', (e) => require(`${__hooks}/access.js`).manifest(e))

// Names (spec §2.11): normalised and kept unique for every editor, the admin UI included.
// PocketBase loads the record before this hook runs, so the save happens in a transaction against a
// fresh read: every field the request does not name is taken from that read. A put-off (blocked,
// token key) or a rename committed meanwhile is therefore never written back stale (Codex C1).
onRecordUpdateRequest((e) => {
  const body = e.requestInfo().body
  const named = (k) => Object.prototype.hasOwnProperty.call(body, k)
  const byCrew = !!e.auth && e.auth.collection().name === 'users' // a superuser id is not a users relation
  const wanted = e.record.getString('name')
  let refusal = null, renamed = null
  const app = e.app
  try {
    app.runInTransaction((tx) => {
      e.app = tx
      const fresh = tx.findRecordById('users', e.record.id)
      if (byCrew && fresh.getBool('blocked')) { refusal = [403, 'Your seat was taken away. Ask the Conductor.']; return }
      for (const k of ['blocked', 'is_admin', 'email', 'emailVisibility', 'verified', 'approved_by', 'last_seen']) if (!named(k)) e.record.set(k, fresh.get(k))
      // A key this request rotated itself (a password change) stands; otherwise the fresh one does.
      if (e.record.tokenKey() === e.record.original().tokenKey()) e.record.setTokenKey(fresh.tokenKey())
      const before = fresh.getString('name')
      if (!named('name') || wanted === before) {
        e.record.set('name', before)
        e.record.set('name_key', fresh.getString('name_key'))
      } else {
        const n = require(`${__hooks}/names.js`)(wanted)
        if (!n) { refusal = [400, "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -"]; return }
        try { if (tx.findFirstRecordByData('users', 'name_key', n.key).id !== e.record.id) { refusal = [409, 'That name is taken.']; return } } catch (_) {}
        e.record.set('name', n.display)
        e.record.set('name_key', n.key)
        // Whitespace or case only: saved normalised, nothing to report.
        if (n.key !== fresh.getString('name_key')) renamed = { before, display: n.display }
      }
      e.next()
    })
  } finally { e.app = app }
  if (refusal) return e.json(refusal[0], { message: refusal[1] })
  if (!renamed) return
  const crew = require(`${__hooks}/crew.js`) // after the commit: logEvent writes with $app
  crew.logEvent($app, { event: 'name_changed', user: e.record.id, actor: byCrew ? e.auth.id : '', name: renamed.display, detail: 'was ' + renamed.before + (byCrew ? '' : '; by superuser') }, crew.clientInfo(e))
}, 'users')

// Email is the identity: crew cannot move their seat to another address themselves (a superuser can,
// in the admin UI). Both halves of PocketBase's built-in email-change flow are refused.
onRecordRequestEmailChangeRequest((e) => e.json(403, { message: 'Ask the Conductor to change your email.' }), 'users')
onRecordConfirmEmailChangeRequest((e) => e.json(403, { message: 'Ask the Conductor to change your email.' }), 'users')

// Blocking by any route (the admin UI included) ends every session.
onRecordUpdate((e) => {
  if (e.record.getBool('blocked') && !e.record.original().getBool('blocked')) e.record.refreshTokenKey()
  e.next()
}, 'users')
