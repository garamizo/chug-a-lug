migrate((app) => {
  const collection = app.findCollectionByNameOrId('broadcasts')
  collection.fields.add(new DateField({ name: 'at' }))
  app.save(collection)
  app.db().newQuery('UPDATE broadcasts SET at = created').execute()
}, (app) => {
  const collection = app.findCollectionByNameOrId('broadcasts')
  collection.fields.removeByName('at')
  app.save(collection)
})
