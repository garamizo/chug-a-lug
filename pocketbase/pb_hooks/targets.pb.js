// Comments and votes point at their target by text. These hooks keep that link honest: a new one
// must point at a route or stop that exists, and deleting a route or stop takes its comments and
// votes with it. Each wraps its whole chain, e.next() included, in one transaction (see
// action_order.pb.js): a failed delete keeps its comments, and a comment cannot be validated
// against a route that is deleted before the comment lands.

onRecordCreate((e) => {
  const original = e.app
  try {
    original.runInTransaction((tx) => {
      e.app = tx
      const col = e.record.getString('target_collection')
      const id = e.record.getString('target_id')
      if (col !== 'itineraries' && col !== 'stops') throw new BadRequestError('Comments and cheers are for routes and stops.')
      try { tx.findRecordById(col, id) } catch (_) { throw new BadRequestError('That route or stop no longer exists.') }
      if (e.record.collection().name === 'comments' && !e.record.getString('body').trim() &&
          !e.record.getString('file') && !e.record.getUnsavedFiles('file').length) {
        throw new BadRequestError('Write something or attach a photo.')
      }
      e.next()
    })
  } finally { e.app = original }
}, 'comments', 'votes')

onRecordDelete((e) => {
  const original = e.app
  try {
    original.runInTransaction((tx) => {
      e.app = tx
      const col = e.record.collection().name
      for (const name of ['comments', 'votes']) {
        const rows = tx.findRecordsByFilter(name, 'target_collection = {:c} && target_id = {:id}', '', 0, 0, { c: col, id: e.record.id })
        for (const r of rows) tx.delete(r)
      }
      e.next()
    })
  } finally { e.app = original }
}, 'itineraries', 'stops')
