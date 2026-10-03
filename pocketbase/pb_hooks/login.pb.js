// POST /api/crawl/login {name, password} — rehearsal stacks only (SIM=1), which have no mail.
// Production signs in by email code or Google (access.pb.js); here the route does not exist.
// A Conductor name always needs the admin password: the crew password never yields an admin token.
routerAdd('POST', '/api/crawl/login', (e) => {
  if ($os.getenv('SIM') !== '1') return e.json(404, { message: 'Not found.' })
  const limits = require(`${__hooks}/limits.js`)
  const normalizeName = require(`${__hooks}/names.js`)
  const body = e.requestInfo().body
  const name = normalizeName(body.name)
  if (!name) return e.json(400, { message: "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -" })
  const password = typeof body.password === 'string' ? body.password : ''
  const loginRateLimit = parseInt($os.getenv('LOGIN_RATE_LIMIT'), 10) || 20
  if (!limits.consume('login:' + e.realIP(), loginRateLimit, 900)) return e.json(429, { message: 'Too many attempts. Try again in 15 minutes.' })
  const crewPassword = $os.getenv('CREW_PASSWORD')
  const adminPassword = $os.getenv('ADMIN_PASSWORD')
  if (!crewPassword) return e.json(503, { message: 'Login is not configured on the server.' })
  const isAdmin = !!adminPassword && $security.equal(password, adminPassword)
  const isCrew = $security.equal(password, crewPassword)
  if (!isAdmin && !isCrew) return e.json(401, { message: 'Wrong password. Ask the family group chat.' })
  // Looked up inside the transaction, and saved only when something changes, so a concurrent
  // change to an existing user (a block, a promotion) is never written back stale.
  let user = null, refused = false
  $app.runInTransaction((app) => {
    try { user = app.findFirstRecordByData('users', 'name_key', name.key) } catch (_) { user = null }
    if (user && user.getBool('is_admin') && !isAdmin) { refused = true; return }
    if (user && (!isAdmin || user.getBool('is_admin'))) return
    if (!user) {
      user = new Record(app.findCollectionByNameOrId('users'))
      user.set('name', name.display)
      user.set('name_key', name.key)
      user.setEmail(name.key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + $security.randomStringWithAlphabet(6, 'abcdefghijklmnopqrstuvwxyz0123456789') + '@rehearsal.invalid')
      user.setVerified(true)
      user.setPassword($security.randomString(40))
    }
    if (isAdmin) user.set('is_admin', true)
    app.save(user)
  })
  if (refused) return e.json(403, { message: 'This name needs the Conductor password.' })
  return $apis.recordAuthResponse(e, user, 'rehearsal', null)
})
