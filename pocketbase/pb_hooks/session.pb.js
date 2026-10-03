// GET /api/crawl/me — who this token belongs to, without minting a token. The app checks it on
// every open and the web server's requireUser uses it: impersonated test sessions are not
// refreshable, and a check must never write anything but last_seen (one column, no stale save).
routerAdd('GET', '/api/crawl/me', (e) => {
  const u = e.auth
  if (!u || u.collection().name !== 'users') return e.json(401, { message: 'Sign in first.' })
  if (u.getBool('blocked')) return e.json(403, { message: 'Your seat was taken away. Ask the Conductor.' })
  const seen = u.getDateTime('last_seen')
  if (seen.isZero() || Date.now() / 1000 - seen.unix() > 600) {
    $app.db().newQuery('UPDATE users SET last_seen = {:t} WHERE id = {:id}').bind({ t: new Date().toISOString().replace('T', ' '), id: u.id }).execute()
  }
  // The owner sees their own address; publicExport hides auth emails otherwise.
  u.ignoreEmailVisibility(true)
  return e.json(200, { record: u })
})
