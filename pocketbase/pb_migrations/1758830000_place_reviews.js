migrate((app) => {
  const places = app.findCollectionByNameOrId('places')
  places.fields.add(new JSONField({ name: 'reviews', maxSize: 50000 }))
  app.save(places)
}, (app) => {
  const places = app.findCollectionByNameOrId('places')
  places.fields.removeByName('reviews')
  app.save(places)
})
