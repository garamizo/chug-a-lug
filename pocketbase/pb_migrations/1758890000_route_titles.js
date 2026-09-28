// Route names are unique ignoring case and spacing. The key lives beside the title so the hook can
// look it up exactly; no unique index, because older data may already hold duplicates.
migrate((app) => {
  const c = app.findCollectionByNameOrId('itineraries')
  c.fields.add(new TextField({ name: 'title_key', max: 200 }))
  app.save(c)
  for (const r of app.findAllRecords('itineraries')) {
    // The update hook (planning.pb.js) trims on every write; a legacy title with leading or
    // trailing spaces would otherwise never match its own trimmed form, so the hook's
    // `renamed = title !== original.title` check would fire on every later, unrelated update.
    // Trim here too, once, so a legacy title stops looking renamed on the first touch after it.
    const trimmed = r.getString('title').trim()
    if (trimmed) r.set('title', trimmed)
    r.set('title_key', trimmed.replace(/\s+/g, ' ').toLowerCase())
    app.saveNoValidate(r)
  }
}, (app) => {
  const c = app.findCollectionByNameOrId('itineraries')
  c.fields.removeByName('title_key')
  app.save(c)
})
