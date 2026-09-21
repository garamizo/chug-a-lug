// The live day: Bulletins and their acks, the Tab, and Freight. Rules: U = any authenticated user,
// O = owner, A = users.is_admin. The Crew never writes `checkins` in M3, so nothing here touches it.
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const itineraries = app.findCollectionByNameOrId('itineraries')
  const stops = app.findCollectionByNameOrId('stops')
  const U = "@request.auth.id != ''"
  const ADMIN = '@request.auth.is_admin = true'

  const broadcasts = new Collection({
    type: 'base',
    name: 'broadcasts',
    listRule: U,
    viewRule: U,
    createRule: `${U} && ${ADMIN}`,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'itinerary', type: 'relation', collectionId: itineraries.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'kind', type: 'select', values: ['reroute', 'hold', 'annul', 'extra', 'message'], maxSelect: 1, required: true },
      { name: 'body', type: 'text', required: true, min: 1, max: 500 },
      { name: 'created_by', type: 'relation', collectionId: users.id, maxSelect: 1, required: true },
      { name: 'created', type: 'autodate', onCreate: true }
    ],
    indexes: ['CREATE INDEX idx_broadcasts_created ON broadcasts (created)']
  })
  app.save(broadcasts)

  const acks = new Collection({
    type: 'base',
    name: 'broadcast_acks',
    listRule: U,
    viewRule: U,
    createRule: `${U} && @request.body.user = @request.auth.id`,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'broadcast', type: 'relation', collectionId: broadcasts.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'created', type: 'autodate', onCreate: true }
    ],
    indexes: ['CREATE UNIQUE INDEX idx_acks_broadcast_user ON broadcast_acks (broadcast, user)']
  })
  app.save(acks)

  const drinks = new Collection({
    type: 'base',
    name: 'drink_entries',
    listRule: U,
    viewRule: U,
    createRule: `${U} && @request.body.user = @request.auth.id`,
    updateRule: null,
    deleteRule: `${U} && user = @request.auth.id`,
    fields: [
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'stop', type: 'relation', collectionId: stops.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'kind', type: 'select', values: ['beer', 'wine', 'cocktail', 'shot', 'water', 'food'], maxSelect: 1, required: true },
      { name: 'at', type: 'date', required: true },
      { name: 'created', type: 'autodate', onCreate: true }
    ],
    indexes: ['CREATE INDEX idx_drinks_stop ON drink_entries (stop)', 'CREATE INDEX idx_drinks_user ON drink_entries (user)']
  })
  app.save(drinks)

  const media = new Collection({
    type: 'base',
    name: 'media',
    listRule: U,
    viewRule: U,
    createRule: `${U} && @request.body.user = @request.auth.id`,
    updateRule: `${U} && ${ADMIN}`,
    deleteRule: `${U} && ${ADMIN}`,
    fields: [
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      // 90 MB: the Cloudflare free plan rejects a request body over 100 MB, and the tunnel is the
      // only way in from a phone.
      { name: 'file', type: 'file', maxSelect: 1, maxSize: 94371840, thumbs: ['400x300', '1200x0'], required: true },
      { name: 'kind', type: 'select', values: ['image', 'video'], maxSelect: 1, required: true },
      { name: 'taken_at', type: 'date' },
      { name: 'stop', type: 'relation', collectionId: stops.id, maxSelect: 1, required: false, cascadeDelete: false },
      { name: 'tagged_by', type: 'select', values: ['clock', 'manual', 'none'], maxSelect: 1 },
      { name: 'created', type: 'autodate', onCreate: true }
    ],
    indexes: ['CREATE INDEX idx_media_stop ON media (stop)', 'CREATE INDEX idx_media_created ON media (created)']
  })
  app.save(media)
}, (app) => {
  for (const name of ['media', 'drink_entries', 'broadcast_acks', 'broadcasts']) {
    try { app.delete(app.findCollectionByNameOrId(name)) } catch (_) {}
  }
})
