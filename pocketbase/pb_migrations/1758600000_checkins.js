// Where the crawl is. M2 writes only the Conductor's correction from the Departure Board; the rules
// already allow any user to create their own, so M3's Punch needs no migration.
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const stops = app.findCollectionByNameOrId('stops')

  const checkins = new Collection({
    type: 'base',
    name: 'checkins',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != "" && user = @request.auth.id',
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'stop', type: 'relation', collectionId: stops.id, maxSelect: 1, required: false, cascadeDelete: true },
      { name: 'kind', type: 'select', values: ['at_stop', 'on_train'], maxSelect: 1, required: true },
      { name: 'at', type: 'date', required: true },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE INDEX idx_checkins_at ON checkins (at)']
  })
  app.save(checkins)
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId('checkins'))
  } catch (_) {}
})
