// Planning phase collections. Rules: U = any authenticated user, O = owner, A = users.is_admin.
// legs and event_log are written only by the SvelteKit server (superuser) and hooks.
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const U = "@request.auth.id != ''"
  const ADMIN = '@request.auth.is_admin = true'

  const itineraries = new Collection({
    type: 'base',
    name: 'itineraries',
    listRule: U,
    viewRule: U,
    createRule: U,
    updateRule: `${U} && (created_by = @request.auth.id || ${ADMIN})`,
    deleteRule: `${U} && status = 'draft' && (created_by = @request.auth.id || ${ADMIN})`,
    fields: [
      { name: 'title', type: 'text', required: true, min: 1, max: 80 },
      { name: 'status', type: 'select', values: ['draft', 'locked', 'archived'], maxSelect: 1, required: true },
      { name: 'event_date', type: 'text', required: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      { name: 'start_time', type: 'text', required: true, pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
      { name: 'vote_open', type: 'bool' },
      { name: 'created_by', type: 'relation', collectionId: users.id, maxSelect: 1, required: true },
      { name: 'locked_at', type: 'date' },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE INDEX idx_itineraries_status ON itineraries (status, event_date)']
  })
  app.save(itineraries)

  const DRAFT_OR_ADMIN = `${U} && (itinerary.status = 'draft' || ${ADMIN})`
  const stops = new Collection({
    type: 'base',
    name: 'stops',
    listRule: U,
    viewRule: U,
    createRule: DRAFT_OR_ADMIN,
    updateRule: DRAFT_OR_ADMIN,
    deleteRule: DRAFT_OR_ADMIN,
    fields: [
      { name: 'itinerary', type: 'relation', collectionId: itineraries.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'order', type: 'number', onlyInt: true },
      { name: 'name', type: 'text', required: true, min: 1, max: 120 },
      { name: 'kind', type: 'select', values: ['bar', 'restaurant', 'other'], maxSelect: 1 },
      { name: 'station_id', type: 'text', required: true, max: 32 },
      { name: 'station_name', type: 'text', max: 80 },
      { name: 'place_id', type: 'text', max: 200 },
      { name: 'osm_id', type: 'text', max: 40 },
      { name: 'address', type: 'text', max: 200 },
      { name: 'lat', type: 'number' },
      { name: 'lon', type: 'number' },
      { name: 'hours', type: 'json', maxSize: 20000 },
      { name: 'phone', type: 'text', max: 40 },
      { name: 'website', type: 'text', max: 300 },
      { name: 'confirmed_open', type: 'bool' },
      { name: 'dwell_min', type: 'number', onlyInt: true, min: 0, max: 600 },
      { name: 'walk_min', type: 'number', onlyInt: true, min: 0, max: 120 },
      { name: 'notes', type: 'text', max: 2000 },
      { name: 'meet_point', type: 'text', max: 200 },
      { name: 'photos_status', type: 'select', values: ['none', 'pending', 'done', 'failed'], maxSelect: 1 },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE INDEX idx_stops_itinerary_order ON stops (itinerary, `order`)']
  })
  app.save(stops)

  const stopPhotos = new Collection({
    type: 'base',
    name: 'stop_photos',
    listRule: U,
    viewRule: U,
    createRule: `${U} && @request.body.source = 'user'`,
    updateRule: `${U} && ${ADMIN}`,
    deleteRule: `${U} && ${ADMIN}`,
    fields: [
      { name: 'stop', type: 'relation', collectionId: stops.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'file', type: 'file', maxSelect: 1, maxSize: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], thumbs: ['400x300', '800x0'], required: true },
      { name: 'source', type: 'select', values: ['google', 'user'], maxSelect: 1, required: true },
      { name: 'attribution', type: 'text', max: 300 },
      { name: 'created', type: 'autodate', onCreate: true }
    ]
  })
  app.save(stopPhotos)

  const votes = new Collection({
    type: 'base',
    name: 'votes',
    listRule: U,
    viewRule: U,
    createRule: `${U} && @request.body.user = @request.auth.id`,
    updateRule: `${U} && user = @request.auth.id && @request.body.user:isset = false`,
    deleteRule: `${U} && user = @request.auth.id`,
    fields: [
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'target_collection', type: 'text', required: true, max: 40 },
      { name: 'target_id', type: 'text', required: true, max: 40 },
      { name: 'value', type: 'select', values: ['up', 'down'], maxSelect: 1, required: true },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE UNIQUE INDEX idx_votes_unique ON votes (user, target_collection, target_id)']
  })
  app.save(votes)

  const comments = new Collection({
    type: 'base',
    name: 'comments',
    listRule: U,
    viewRule: U,
    createRule: `${U} && @request.body.user = @request.auth.id`,
    updateRule: `${U} && user = @request.auth.id && @request.body.user:isset = false`,
    deleteRule: `${U} && (user = @request.auth.id || ${ADMIN})`,
    fields: [
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'target_collection', type: 'text', required: true, max: 40 },
      { name: 'target_id', type: 'text', required: true, max: 40 },
      { name: 'body', type: 'text', required: true, min: 1, max: 1000 },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE INDEX idx_comments_target ON comments (target_collection, target_id)']
  })
  app.save(comments)

  const VOTE_OPEN = "itinerary.status = 'draft' && itinerary.vote_open = true"
  const approvalVotes = new Collection({
    type: 'base',
    name: 'approval_votes',
    listRule: U,
    viewRule: U,
    createRule: `${U} && @request.body.user = @request.auth.id && ${VOTE_OPEN}`,
    updateRule: `${U} && user = @request.auth.id && @request.body.user:isset = false && ${VOTE_OPEN}`,
    deleteRule: `${U} && user = @request.auth.id && ${VOTE_OPEN}`,
    fields: [
      { name: 'itinerary', type: 'relation', collectionId: itineraries.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'value', type: 'select', values: ['go', 'nogo'], maxSelect: 1, required: true },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE UNIQUE INDEX idx_approval_unique ON approval_votes (itinerary, user)']
  })
  app.save(approvalVotes)

  const legs = new Collection({
    type: 'base',
    name: 'legs',
    listRule: U,
    viewRule: U,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'itinerary', type: 'relation', collectionId: itineraries.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'from_stop', type: 'relation', collectionId: stops.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'to_stop', type: 'relation', collectionId: stops.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'kind', type: 'select', values: ['train', 'walk', 'impossible'], maxSelect: 1, required: true },
      { name: 'ready_at', type: 'date' },
      { name: 'depart_at', type: 'date' },
      { name: 'arrive_at', type: 'date' },
      { name: 'segments', type: 'json', maxSize: 20000 },
      { name: 'computed_at', type: 'date' }
    ],
    indexes: ['CREATE INDEX idx_legs_itinerary ON legs (itinerary)']
  })
  app.save(legs)

  const eventLog = new Collection({
    type: 'base',
    name: 'event_log',
    listRule: U,
    viewRule: U,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'itinerary', type: 'relation', collectionId: itineraries.id, maxSelect: 1, cascadeDelete: true },
      { name: 'kind', type: 'text', required: true, max: 40 },
      { name: 'payload', type: 'json', maxSize: 20000 },
      { name: 'actor', type: 'relation', collectionId: users.id, maxSelect: 1 },
      { name: 'at', type: 'date' }
    ],
    indexes: ['CREATE INDEX idx_event_log_itinerary_at ON event_log (itinerary, at)']
  })
  app.save(eventLog)
}, (app) => {
  for (const name of ['event_log', 'legs', 'approval_votes', 'comments', 'votes', 'stop_photos', 'stops', 'itineraries']) {
    try { app.delete(app.findCollectionByNameOrId(name)) } catch (_) {}
  }
})
