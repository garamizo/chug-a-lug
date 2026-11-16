// Photo Tab: a drink counts once its photo lands. A photo uploaded with `drink_kind` is a proof, and
// the media hook writes its drink in the same transaction, under the same id (pb_hooks/live.pb.js).
// The drink points back at its photo; deleting the photo takes the drink with it, and deleting the
// drink takes the photo (the drink delete hook). Legacy drinks have no photo and keep counting.
migrate((app) => {
  const media = app.findCollectionByNameOrId('media')
  media.fields.add(new SelectField({ name: 'drink_kind', values: ['beer', 'cocktail', 'shot', 'water', 'food'], maxSelect: 1, required: false }))
  app.save(media)

  const drinks = app.findCollectionByNameOrId('drink_entries')
  drinks.fields.add(new RelationField({ name: 'media', collectionId: media.id, maxSelect: 1, required: false, cascadeDelete: true }))
  drinks.indexes.push("CREATE UNIQUE INDEX idx_drinks_media ON drink_entries (media) WHERE media != ''")
  app.save(drinks)
}, (app) => {
  const drinks = app.findCollectionByNameOrId('drink_entries')
  drinks.indexes = drinks.indexes.filter((i) => !i.includes('idx_drinks_media'))
  drinks.fields.removeByName('media')
  app.save(drinks)

  const media = app.findCollectionByNameOrId('media')
  media.fields.removeByName('drink_kind')
  app.save(media)
})
