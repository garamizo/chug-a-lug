// Route names are unique ignoring case and spacing. The key lives beside the title so the hook can
// look it up exactly; no unique index, because older data may already hold duplicates.
migrate((app) => {
  const c = app.findCollectionByNameOrId('itineraries')
  c.fields.add(new TextField({ name: 'title_key', max: 200 }))
  app.save(c)
  for (const r of app.findAllRecords('itineraries')) {
    r.set('title_key', r.getString('title').trim().replace(/\s+/g, ' ').toLowerCase())
    app.saveNoValidate(r)
  }
}, (app) => {
  const c = app.findCollectionByNameOrId('itineraries')
  c.fields.removeByName('title_key')
  app.save(c)
})
