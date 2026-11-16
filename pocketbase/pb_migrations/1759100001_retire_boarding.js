// Retire peer boarding, Google and email-code sign-in (spec 2026-11-15-join-link-design.md §4.6;
// the join link itself arrived in 1759100000). Self-contained, like every migration here (their
// tests run with an empty hooks directory). Destructive: boarding request history and Google links
// are deleted, and down restores the schema, not the rows.
migrate((app) => {
  const RULES = ['users:requestOTP', 'users:authWithOTP', 'users:authWithOAuth2']

  // PocketBase 0.40.4 refuses to delete a collection that a relation still points at.
  const log = app.findCollectionByNameOrId('access_log')
  log.fields.removeByName('request')
  app.save(log)
  app.delete(app.findCollectionByNameOrId('boarding_requests'))

  const users = app.findCollectionByNameOrId('users')
  users.otp.enabled = false
  users.oauth2.enabled = false
  users.oauth2.providers = []
  users.fields.removeByName('approved_by')
  users.updateRule = String(users.updateRule || '').split(' && ').filter((c) => c !== '@request.body.approved_by:isset = false').join(' && ')
  app.save(users)
  app.db().newQuery('DELETE FROM _externalAuths WHERE collectionRef = {:c}').bind({ c: users.id }).execute()

  const s = app.settings()
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => RULES.indexOf(r.label) < 0)
  app.save(s)
}, (app) => {
  const ADMIN = '@request.auth.is_admin = true'
  const RULES = [
    { label: 'users:requestOTP', maxRequests: 5, duration: 600, audience: '' },
    { label: 'users:authWithOTP', maxRequests: 10, duration: 600, audience: '' },
    { label: 'users:authWithOAuth2', maxRequests: 10, duration: 600, audience: '' }
  ]
  const users = app.findCollectionByNameOrId('users')
  users.fields.add(new RelationField({ name: 'approved_by', collectionId: users.id, maxSelect: 1, cascadeDelete: false }))
  if (users.updateRule && users.updateRule.indexOf('@request.body.approved_by:isset = false') < 0) users.updateRule += ' && @request.body.approved_by:isset = false'
  users.otp.enabled = true
  app.save(users)

  // boarding_requests as 1758900000 made it and 1759000000 extended it (password_hash).
  const requests = new Collection({
    type: 'base', name: 'boarding_requests',
    listRule: `@request.auth.id != '' && decoy = false && (status = 'waiting' || ((status = 'aboard' || status = 'turned_away') && decided_at > @yesterday) || ${ADMIN})`,
    viewRule: `@request.auth.id != '' && decoy = false && (status = 'waiting' || ((status = 'aboard' || status = 'turned_away') && decided_at > @yesterday) || ${ADMIN})`,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'name', type: 'text', required: true, min: 2, max: 32 },
      { name: 'name_key', type: 'text', required: true, min: 2, max: 32 },
      { name: 'email', type: 'email', required: true },
      { name: 'method', type: 'select', values: ['email', 'google'], maxSelect: 1, required: true },
      { name: 'status', type: 'select', values: ['unverified', 'waiting', 'aboard', 'turned_away', 'expired'], maxSelect: 1, required: true },
      { name: 'decoy', type: 'bool', hidden: true },
      { name: 'secret_hash', type: 'text', hidden: true },
      { name: 'code_hash', type: 'text', hidden: true },
      { name: 'code_attempts', type: 'number', onlyInt: true },
      { name: 'resends', type: 'number', onlyInt: true, hidden: true },
      { name: 'code_sent_at', type: 'date' },
      { name: 'status_at', type: 'date' },
      { name: 'ip', type: 'text', max: 64 },
      { name: 'country', type: 'text', max: 8 },
      { name: 'city', type: 'text', max: 80 },
      { name: 'user_agent', type: 'text', max: 300 },
      { name: 'decided_by', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'decided_at', type: 'date' },
      { name: 'notified_at', type: 'date' },
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'password_hash', type: 'text', hidden: true },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE INDEX idx_boarding_status ON boarding_requests (status, ip)', 'CREATE INDEX idx_boarding_email ON boarding_requests (email)']
  })
  app.save(requests)

  const log = app.findCollectionByNameOrId('access_log')
  log.fields.add(new RelationField({ name: 'request', collectionId: requests.id, maxSelect: 1, cascadeDelete: false }))
  app.save(log)

  const s = app.settings()
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => !RULES.some((o) => o.label === r.label)).concat(RULES)
  app.save(s)
})
