// Route names are unique ignoring case and spacing. The key lives beside the title so the hook can
// look it up exactly; no unique index, because older data may already hold duplicates.
migrate((app) => {
  const c = app.findCollectionByNameOrId('itineraries')
  c.fields.add(new TextField({ name: 'title_key', max: 200 }))
  app.save(c)
  for (const r of app.findAllRecords('itineraries')) {
    // The update hook (planning.pb.js) trims a title only when it is being changed and leaves an
    // unchanged one as stored, so a legacy title with leading or trailing spaces would never match
    // its own trimmed form: the first rename request that merely re-sends it (or re-cases it)
    // would then look like a rename. Trim here too, once, so a legacy title is already in its
    // normalised form before the hook ever sees it.
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
