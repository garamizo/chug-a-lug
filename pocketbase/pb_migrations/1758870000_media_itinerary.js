// Photos belong to a route, not only to a stop: the chat takes them before the first bar and after
// the last one, when there is no stop to hang them on. The hook fills this in on every upload.
migrate((app) => {
  const media = app.findCollectionByNameOrId('media')
  const itineraries = app.findCollectionByNameOrId('itineraries')
  media.fields.add(new RelationField({ name: 'itinerary', collectionId: itineraries.id, maxSelect: 1, required: false, cascadeDelete: false }))
  media.indexes.push('CREATE INDEX idx_media_itinerary ON media (itinerary)')
  app.save(media)
  app.db().newQuery("UPDATE media SET itinerary = (SELECT itinerary FROM stops WHERE stops.id = media.stop) WHERE stop != ''").execute()
}, (app) => {
  const media = app.findCollectionByNameOrId('media')
  media.indexes = media.indexes.filter((i) => !i.includes('idx_media_itinerary'))
  media.fields.removeByName('itinerary')
  app.save(media)
})
