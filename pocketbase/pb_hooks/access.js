// Conductor-only access controls (spec §2.9–2.10).
const isConductor = (e) => !!e.auth && e.auth.collection().name === 'users' && e.auth.getBool('is_admin') &&
  !require(`${__hooks}/crew.js`).isPutOff(e.auth)

exports.setBlocked = function (e, blocked) {
  const crew = require(`${__hooks}/crew.js`)
  if (!isConductor(e)) return e.json(403, { message: 'Only the Conductor can do that.' })
  const id = e.request.pathValue('id')
  if (blocked && id === e.auth.id) return e.json(400, { message: "You can't put yourself off." })
  // Refetched inside the transaction: a concurrent sign-in or put-off cannot be written back stale.
  let u = null
  $app.runInTransaction((tx) => {
    try { u = tx.findRecordById('users', id) } catch (_) { return }
    u.set('role', blocked ? 'put_off' : 'crew')
    if (blocked) u.refreshTokenKey() // every token dies once saved; realtime auth drops too
    tx.save(u)
  })
  if (!u) return e.json(404, { message: 'Not found.' })
  crew.logEvent($app, { event: blocked ? 'put_off' : 'let_back_on', actor: e.auth.id, user: u.id, name: u.getString('name'), email: u.email() }, crew.clientInfo(e))
  return e.json(200, {})
}

exports.manifest = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  if (!isConductor(e)) return e.json(403, { message: 'Only the Conductor can do that.' })
  const users = $app.findRecordsByFilter('users', "id != ''", 'name', 0, 0)
  const names = {}
  for (const u of users) names[u.id] = u.getString('name')
  const s = (r, k) => r.getString(k)
  return e.json(200, {
    people: users.map((u) => ({ id: u.id, name: s(u, 'name'), email: u.email(), is_admin: u.getBool('is_admin'), blocked: crew.isPutOff(u),
      last_seen: s(u, 'last_seen'), created: s(u, 'created') })),
    log: $app.findRecordsByFilter('access_log', "id != ''", '-created', 200, 0).map((r) => ({ id: r.id, created: s(r, 'created'), event: s(r, 'event'),
      method: s(r, 'method'), name: s(r, 'name'), email: s(r, 'email'), user: names[s(r, 'user')] || '', actor: names[s(r, 'actor')] || '',
      ip: s(r, 'ip'), country: s(r, 'country'), city: s(r, 'city'), user_agent: s(r, 'user_agent'), detail: s(r, 'detail') }))
  })
}

// The access log keeps 90 days and at most 10,000 rows (cron crew_access_daily).
exports.daily = function (app) {
  const ago = new Date(Date.now() - 90 * 86400e3).toISOString().replace('T', ' ')
  app.db().newQuery('DELETE FROM access_log WHERE created < {:t}').bind({ t: ago }).execute()
  app.db().newQuery('DELETE FROM access_log WHERE id NOT IN (SELECT id FROM access_log ORDER BY created DESC LIMIT 10000)').execute()
}
