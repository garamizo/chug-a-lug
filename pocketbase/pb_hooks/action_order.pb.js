// Wrap the entire save chain so a failed validation/insert rolls back its allocated order too.
// e.app must follow the transaction; using $app inside it would deadlock SQLite's writer.
onRecordCreate((e) => {
  const original = e.app
  try {
    original.runInTransaction((tx) => {
      e.app = tx
      const counter = tx.findRecordById('action_sequence', 'eventactions001')
      const next = counter.getInt('value') + 1
      if (!Number.isSafeInteger(next)) throw new Error('action_order_exhausted')
      counter.set('value', next)
      tx.save(counter)
      e.record.set('action_order', next)
      e.next()
    })
  } finally { e.app = original }
}, 'checkins', 'drink_entries')

onRecordUpdate((e) => {
  e.record.set('action_order', e.record.original().get('action_order'))
  e.next()
}, 'checkins', 'drink_entries')
