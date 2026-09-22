migrate((app) => {
  const sequence = new Collection({ type: 'base', name: 'action_sequence',
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [{ name: 'value', type: 'number', onlyInt: true, min: 0, max: 9007199254740991 }] })
  app.save(sequence)
  for (const name of ['checkins', 'drink_entries']) {
    const c = app.findCollectionByNameOrId(name)
    c.fields.add(new NumberField({ name: 'action_order', onlyInt: true, min: 0, max: 9007199254740991 }))
    app.save(c)
  }
  // Cross-collection historical order is deterministic; original tied request order is unknowable.
  const rows = arrayOf(new DynamicModel({ id: '', collection: '', created: '' }))
  app.db().newQuery("SELECT id, 'checkins' AS collection, created FROM checkins UNION ALL SELECT id, 'drink_entries' AS collection, created FROM drink_entries ORDER BY created, id, collection").all(rows)
  let value = 0
  for (const row of rows) {
    app.db().newQuery('UPDATE ' + row.collection + ' SET action_order = {:value} WHERE id = {:id}')
      .bind({ value: ++value, id: row.id }).execute()
  }
  const counter = new Record(sequence)
  counter.set('id', 'eventactions001')
  counter.set('value', value)
  app.save(counter)
  for (const name of ['checkins', 'drink_entries']) {
    const c = app.findCollectionByNameOrId(name)
    c.indexes.push('CREATE UNIQUE INDEX idx_' + name + '_action_order ON ' + name + ' (action_order)')
    app.save(c)
  }
}, (app) => {
  for (const name of ['checkins', 'drink_entries']) {
    const c = app.findCollectionByNameOrId(name)
    c.indexes = c.indexes.filter(i => !i.includes('idx_' + name + '_action_order'))
    c.fields.removeByName('action_order')
    app.save(c)
  }
  app.delete(app.findCollectionByNameOrId('action_sequence'))
})
