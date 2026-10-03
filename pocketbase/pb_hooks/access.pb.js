// Sign-in guards (spec §2.8). A refresh also fires onRecordAuthRequest with an empty authMethod,
// so only real sign-ins are guarded and logged here; refreshes have their own hook.
onRecordAuthRequest((e) => {
  const crew = require(`${__hooks}/crew.js`)
  const method = crew.METHODS[e.authMethod]
  if (method) {
    const refused = crew.signInGuard($app, e.record, method, crew.clientInfo(e))
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
onMailerRecordOTPSend((e) => {
  e.next()
  require(`${__hooks}/crew.js`).logEvent($app, { event: 'code_sent', method: 'email', user: e.record.id, email: e.record.email() })
}, 'users')

routerAdd('POST', '/api/crawl/users/{id}/put-off', (e) => require(`${__hooks}/access.js`).setBlocked(e, true))
routerAdd('POST', '/api/crawl/users/{id}/let-back-on', (e) => require(`${__hooks}/access.js`).setBlocked(e, false))
routerAdd('GET', '/api/crawl/manifest', (e) => require(`${__hooks}/access.js`).manifest(e))

// Names (spec §2.11): normalised and kept unique for every editor, the admin UI included.
onRecordUpdateRequest((e) => {
  const before = e.record.original().getString('name')
  if (e.record.getString('name') === before) return e.next()
  const n = require(`${__hooks}/names.js`)(e.record.getString('name'))
  if (!n) return e.json(400, { message: "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -" })
  try { if ($app.findFirstRecordByData('users', 'name_key', n.key).id !== e.record.id) return e.json(409, { message: 'That name is taken.' }) } catch (_) {}
  e.record.set('name', n.display)
  e.record.set('name_key', n.key)
  e.next()
  if (n.key === e.record.original().getString('name_key')) return // whitespace or case only: saved normalised, nothing to report
  const crew = require(`${__hooks}/crew.js`)
  const byCrew = !!e.auth && e.auth.collection().name === 'users' // a superuser id is not a users relation
  crew.logEvent($app, { event: 'name_changed', user: e.record.id, actor: byCrew ? e.auth.id : '', name: n.display, detail: 'was ' + before + (byCrew ? '' : '; by superuser') }, crew.clientInfo(e))
}, 'users')

// Blocking by any route (the admin UI included) ends every session.
onRecordUpdate((e) => {
  if (e.record.getBool('blocked') && !e.record.original().getBool('blocked')) e.record.refreshTokenKey()
  e.next()
}, 'users')
