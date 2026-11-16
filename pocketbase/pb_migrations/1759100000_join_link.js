// Join links (spec 2026-11-15-join-link-design.md §4.1, §4.2). Additive: the join link and the
// pending sign-ups it feeds. Self-contained, like every migration here (their tests run with an
// empty hooks directory). Boarding is retired by the next migration, not this one.
migrate((app) => {
  const ADDED_EVENT = ['link_created', 'link_revoked', 'joined']
  const users = app.findCollectionByNameOrId('users')

  const links = new Collection({
    type: 'base', name: 'join_links', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'token_hash', type: 'text', required: true, hidden: true },
      { name: 'seats', type: 'number', onlyInt: true, min: 1, max: 50 },
      { name: 'seats_left', type: 'number', onlyInt: true, min: 0 },
      { name: 'expires_at', type: 'date', required: true },
      { name: 'revoked_at', type: 'date' },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE UNIQUE INDEX idx_join_links_token ON join_links (token_hash)']
  })
  app.save(links)

  const signups = new Collection({
    type: 'base', name: 'signups', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'name', type: 'text', required: true, min: 2, max: 32 },
      { name: 'name_key', type: 'text', required: true, min: 2, max: 32 },
      { name: 'password_hash', type: 'text', hidden: true },
      { name: 'code_hash', type: 'text', hidden: true },
      { name: 'code_attempts', type: 'number', onlyInt: true },
      { name: 'code_sent_at', type: 'date' },
      { name: 'resends', type: 'number', onlyInt: true },
      { name: 'secret_hash', type: 'text', hidden: true },
      { name: 'link', type: 'relation', collectionId: links.id, maxSelect: 1, cascadeDelete: false },
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'expires_at', type: 'date', required: true },
      { name: 'ip', type: 'text', max: 64 },
      { name: 'country', type: 'text', max: 8 },
      { name: 'city', type: 'text', max: 80 },
      { name: 'user_agent', type: 'text', max: 300 },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE INDEX idx_signups_email ON signups (email)', 'CREATE INDEX idx_signups_expires ON signups (expires_at)']
  })
  app.save(signups)

  const log = app.findCollectionByNameOrId('access_log')
  const event = log.fields.getByName('event')
  event.values = event.values.filter((v) => ADDED_EVENT.indexOf(v) < 0).concat(ADDED_EVENT)
  app.save(log)
}, (app) => {
  // access_log keeps the added event values: PocketBase checks them only when a row is saved, and
  // dropping them would orphan history. signups references join_links, so it goes first.
  app.delete(app.findCollectionByNameOrId('signups'))
  app.delete(app.findCollectionByNameOrId('join_links'))
})
