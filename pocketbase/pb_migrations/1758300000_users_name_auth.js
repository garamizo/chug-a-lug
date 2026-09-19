// Crew identities are created on first login by name. There are no per-person credentials:
// the shared crew/admin passwords live in the environment and are checked by pb_hooks/login.pb.js.
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const name = users.fields.getByName('name')
  name.required = true
  name.min = 2
  name.max = 32
  // Case-insensitive identity: "Gui" and "gui" are the same person.
  users.fields.add(new TextField({ name: 'name_key', required: true, min: 2, max: 32, pattern: "^[a-z0-9][a-z0-9 .'-]{1,31}$" }))
  users.fields.add(new BoolField({ name: 'is_admin' }))
  users.fields.add(new BoolField({ name: 'share_position' }))
  users.fields.add(new TextField({ name: 'home_station', max: 32 }))
  users.fields.add(new BoolField({ name: 'left_early' }))
  users.indexes.push('CREATE UNIQUE INDEX idx_users_name_key ON users (name_key)')
  users.fields.getByName('email').required = false
  // Only the login hook may authenticate; the password field holds a random secret nobody uses.
  users.passwordAuth.enabled = false
  users.otp.enabled = false
  users.mfa.enabled = false
  users.authToken.duration = 31536000 // one year; the session cookie has the same lifetime
  users.listRule = "@request.auth.id != ''"
  users.viewRule = "@request.auth.id != ''"
  users.createRule = null
  // Identity and privilege changes must go through the login hook or a superuser.
  users.updateRule = "id = @request.auth.id && @request.body.is_admin:isset = false && @request.body.name:isset = false && @request.body.name_key:isset = false && @request.body.password:isset = false"
  users.deleteRule = null
  app.save(users)
  // Internal table for rolling-window rate limits, unavailable through the records API.
  app.db().newQuery('CREATE TABLE IF NOT EXISTS _crawl_limits (key TEXT NOT NULL, at INTEGER NOT NULL)').execute()
  app.db().newQuery('CREATE INDEX IF NOT EXISTS idx_crawl_limits_key_at ON _crawl_limits (key, at)').execute()
}, (app) => {
  const users = app.findCollectionByNameOrId('users')
  users.fields.getByName('name').required = false
  users.fields.getByName('name').min = 0
  users.fields.getByName('name').max = 0
  users.fields.getByName('email').required = true
  users.passwordAuth.enabled = true
  users.authToken.duration = 604800
  users.listRule = 'id = @request.auth.id'
  users.viewRule = 'id = @request.auth.id'
  users.createRule = ''
  users.updateRule = 'id = @request.auth.id'
  users.deleteRule = 'id = @request.auth.id'
  users.indexes = users.indexes.filter((i) => !i.includes('idx_users_name_key'))
  for (const field of ['name_key', 'is_admin', 'share_position', 'home_station', 'left_early']) users.fields.removeByName(field)
  app.save(users)
  app.db().newQuery('DROP TABLE IF EXISTS _crawl_limits').execute()
})
