// Crew chat: messages anyone can post, one Cheers per person per entry, and event time on Freight
// so a photo sorts into the chat by Railroad Time during a rehearsal. U = any authenticated user.
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const itineraries = app.findCollectionByNameOrId('itineraries')
  const U = "@request.auth.id != ''"

  app.save(new Collection({
    type: 'base',
    name: 'chat_messages',
    listRule: U,
    viewRule: U,
    createRule: `${U} && @request.body.user = @request.auth.id`,
    updateRule: null,
    deleteRule: `${U} && user = @request.auth.id`,
    fields: [
      { name: 'itinerary', type: 'relation', collectionId: itineraries.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'body', type: 'text', required: true, min: 1, max: 280 },
      { name: 'at', type: 'date' },
      { name: 'created', type: 'autodate', onCreate: true }
    ],
    indexes: ['CREATE INDEX idx_chat_messages_itinerary ON chat_messages (itinerary)']
  }))

  app.save(new Collection({
    type: 'base',
    name: 'reactions',
    listRule: U,
    viewRule: U,
    createRule: `${U} && @request.body.user = @request.auth.id`,
    updateRule: null,
    deleteRule: `${U} && user = @request.auth.id`,
    fields: [
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'target_kind', type: 'select', values: ['drink', 'bulletin', 'message', 'media'], maxSelect: 1, required: true },
      { name: 'target_id', type: 'text', required: true, min: 1, max: 32 },
      { name: 'itinerary', type: 'relation', collectionId: itineraries.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'created', type: 'autodate', onCreate: true }
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_reactions_user_target ON reactions (user, target_kind, target_id)',
      'CREATE INDEX idx_reactions_itinerary ON reactions (itinerary)'
    ]
  }))

  const media = app.findCollectionByNameOrId('media')
  media.fields.add(new DateField({ name: 'at' }))
  app.save(media)
  app.db().newQuery('UPDATE media SET at = created').execute()
}, (app) => {
  for (const name of ['reactions', 'chat_messages']) {
    try { app.delete(app.findCollectionByNameOrId(name)) } catch (_) {}
  }
  const media = app.findCollectionByNameOrId('media')
  media.fields.removeByName('at')
  app.save(media)
})
