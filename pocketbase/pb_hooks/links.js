// The join link (spec §4.1). Everything takes `app` so callers can pass a transaction. Only the
// sha256 of the token is stored; the token itself is answered once, by create.
const crew = () => require(`${__hooks}/crew.js`)

const DAY = 86400000
const sqlTime = (d) => d.toISOString().replace('T', ' ')
const iso = (s) => (s ? String(s).replace(' ', 'T') : '')

exports.isActive = function (record) {
  if (record.getString('revoked_at')) return false
  if (record.getDateTime('expires_at').time().unix() * 1000 <= Date.now()) return false
  return record.getInt('seats_left') > 0
}

exports.findActive = function (app, token) {
  if (typeof token !== 'string' || !token) return null
  let record
  try { record = app.findFirstRecordByData('join_links', 'token_hash', crew().hash(token)) } catch (_) { return null }
  return exports.isActive(record) ? record : null
}

exports.create = function (app, seats, days) {
  const token = $security.randomString(32)
  let record
  app.runInTransaction((tx) => {
    const now = sqlTime(new Date())
    for (const old of tx.findRecordsByFilter('join_links', "revoked_at = ''", '', 0, 0)) {
      old.set('revoked_at', now)
      tx.save(old)
    }
    record = new Record(tx.findCollectionByNameOrId('join_links'))
    record.set('token_hash', crew().hash(token))
    record.set('seats', seats)
    record.set('seats_left', seats)
    record.set('expires_at', sqlTime(new Date(Date.now() + days * DAY)))
    tx.save(record)
  })
  return { token, record }
}

exports.status = function (app) {
  const rows = app.findRecordsByFilter('join_links', '1 = 1', '-@rowid', 1, 0)
  if (!rows.length) return { state: 'none', seats: 0, seats_left: 0, expires_at: '' }
  const r = rows[0]
  const expired = r.getDateTime('expires_at').time().unix() * 1000 <= Date.now()
  const state = r.getString('revoked_at') ? 'revoked' : expired ? 'expired' : r.getInt('seats_left') <= 0 ? 'full' : 'active'
  return { state, seats: r.getInt('seats'), seats_left: r.getInt('seats_left'), expires_at: iso(r.getString('expires_at')) }
}

exports.revoke = function (app) {
  let revoked = false
  app.runInTransaction((tx) => {
    const now = sqlTime(new Date())
    for (const r of tx.findRecordsByFilter('join_links', "revoked_at = ''", '', 0, 0)) {
      r.set('revoked_at', now)
      tx.save(r)
      revoked = true
    }
  })
  return revoked
}
