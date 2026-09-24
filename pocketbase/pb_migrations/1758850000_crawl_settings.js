// The Conductor's choice of which locked route is "the" route: Live, the home page, The Route and
// photo tagging all follow it. One row; reading needs a login, writing needs a Conductor.
migrate((app) => {
  const itineraries = app.findCollectionByNameOrId('itineraries')
  const collection = new Collection({
    type: 'base',
    name: 'crawl_settings',
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: null,
    updateRule: '@request.auth.is_admin = true',
    deleteRule: null,
    fields: [
      { name: 'current_itinerary', type: 'relation', collectionId: itineraries.id, maxSelect: 1, required: false, cascadeDelete: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ]
  })
  app.save(collection)
  // `crawlsettings` is 13 chars; the default id field is fixed at the standard 15-char length
  // (both its pattern and its min/max), so widen all three the same way the simulation-clock
  // singleton widens its own (15-char, so only the pattern needed changing there).
  const idField = collection.fields.getByName('id')
  idField.pattern = '^crawlsettings$'
  idField.autogeneratePattern = 'crawlsettings'
  idField.min = 13
  idField.max = 13
  app.save(collection)
  const row = new Record(collection)
  row.set('id', 'crawlsettings')
  app.save(row)
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId('crawl_settings')) } catch (_) {}
})
