// POST /api/crawl/login {name, password}
// The password is the shared crew password or the admin password from the environment.
// The user record for that name is created on first login; the admin password grants is_admin.
routerAdd('POST', '/api/crawl/login', (e) => {
  const limits = require(`${__hooks}/limits.js`)
  const normalizeName = require(`${__hooks}/names.js`)
  const body = e.requestInfo().body
  const name = normalizeName(body.name)
  if (!name) return e.json(400, { message: "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -" })
  const password = typeof body.password === 'string' ? body.password : ''
  if (!limits.consume('login:' + e.realIP(), 20, 900)) return e.json(429, { message: 'Too many attempts. Try again in 15 minutes.' })
  const crewPassword = $os.getenv('CREW_PASSWORD')
  const adminPassword = $os.getenv('ADMIN_PASSWORD')
  if (!crewPassword) return e.json(503, { message: 'Login is not configured on the server.' })
  const isAdmin = !!adminPassword && $security.equal(password, adminPassword)
  const isCrew = $security.equal(password, crewPassword)
  if (!isAdmin && !isCrew) return e.json(401, { message: 'Wrong password. Ask the family group chat.' })
  let user
  $app.runInTransaction((app) => {
    try { user = app.findFirstRecordByData('users', 'name_key', name.key) } catch (_) {}
    if (!user) {
      user = new Record(app.findCollectionByNameOrId('users'))
      user.set('name', name.display)
      user.set('name_key', name.key)
      user.set('verified', true)
      user.setPassword($security.randomString(40))
    }
    if (isAdmin) user.set('is_admin', true)
    app.save(user)
  })
  return e.json(200, { token: user.newAuthToken(), record: user })
})
