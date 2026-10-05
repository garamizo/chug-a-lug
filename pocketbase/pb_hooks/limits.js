// Persistent, atomic rolling-window limits backed by the _crawl_limits table.
// Call this only inside an existing write transaction, so a guarded mutation and its budget
// commit together. Keeping the transaction at the caller avoids nested write transactions.
function consumeInTransaction(app, key, maximum, seconds) {
  const now = Math.floor(Date.now() / 1000)
  app.db().newQuery('DELETE FROM _crawl_limits WHERE at <= {:cutoff}').bind({ cutoff: now - 3600 }).execute()
  const row = new DynamicModel({ count: 0 })
  app.db().newQuery('SELECT COUNT(*) AS count FROM _crawl_limits WHERE key = {:key} AND at > {:cutoff}').bind({ key, cutoff: now - seconds }).one(row)
  if (row.count >= maximum) return false
  app.db().newQuery('INSERT INTO _crawl_limits (key, at) VALUES ({:key}, {:now})').bind({ key, now }).execute()
  return true
}
exports.consumeInTransaction = consumeInTransaction
// consume(key, maximum, seconds) returns true when the attempt is allowed and records it.
exports.consume = function (key, maximum, seconds) {
  let allowed = false
  $app.runInTransaction((app) => { allowed = consumeInTransaction(app, key, maximum, seconds) })
  return allowed
}
