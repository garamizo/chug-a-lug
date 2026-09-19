migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  users.fields.add(new TextField({ name: 'phone', required: true, pattern: '^\\+1[0-9]{10}$', max: 12 }))
  users.fields.add(new BoolField({ name: 'is_admin' }))
  users.fields.add(new BoolField({ name: 'share_position' }))
  users.fields.add(new TextField({ name: 'home_station', max: 32 }))
  users.fields.add(new BoolField({ name: 'left_early' }))
  users.indexes.push('CREATE UNIQUE INDEX idx_users_phone ON users (phone)')
  users.passwordAuth.enabled = true
  users.passwordAuth.identityFields = ['phone']
  users.fields.getByName('password').min = 4
  users.fields.getByName('password').max = 8
  users.fields.getByName('password').pattern = '^[0-9]{4,8}$'
  users.fields.getByName('email').required = false
  users.authToken.duration = 15552000
  users.listRule = "@request.auth.id != ''"
  users.viewRule = "@request.auth.id != ''"
  users.createRule = null
  // Identity, privilege and PIN changes must go through the trusted OTP flow.
  users.updateRule = "id = @request.auth.id && @request.body.is_admin:isset = false && @request.body.phone:isset = false && @request.body.password:isset = false"
  users.deleteRule = null
  app.save(users)
  // Internal table, unavailable through the records API. Transactions serialize counters.
  app.db().newQuery('CREATE TABLE _crawl_limits (key TEXT NOT NULL, at INTEGER NOT NULL)').execute()
  app.db().newQuery('CREATE INDEX idx_crawl_limits_key_at ON _crawl_limits (key, at)').execute()
}, (app) => {
  const users = app.findCollectionByNameOrId('users')
  users.passwordAuth.identityFields = ['email']
  users.fields.getByName('password').min = 8
  users.fields.getByName('password').max = 0
  users.fields.getByName('password').pattern = ''
  users.fields.getByName('email').required = true
  users.authToken.duration = 604800
  users.listRule = 'id = @request.auth.id'
  users.viewRule = 'id = @request.auth.id'
  users.createRule = ''
  users.updateRule = 'id = @request.auth.id'
  users.deleteRule = 'id = @request.auth.id'
  users.indexes = users.indexes.filter((i) => !i.includes('idx_users_phone'))
  for (const field of ['phone', 'is_admin', 'share_position', 'home_station', 'left_early']) users.fields.removeByName(field)
  app.save(users)
  app.db().newQuery('DROP TABLE IF EXISTS _crawl_limits').execute()
})
