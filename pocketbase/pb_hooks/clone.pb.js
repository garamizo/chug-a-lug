// Clone: copy any route into a draft of the caller's own, with a note on both routes, in one
// transaction, so all of it lands or none of it does. The client names the new record's id and keeps
// it across retries; a retry finds the finished clone by its own `cloned_from` note (which cannot
// exist without the rest) and answers with it. Nothing here ever deletes. The name comes from the
// client ("Copy of …" lives in labels.ts); a taken one answers title_taken and the client tries the
// next. Helpers live inside the callback: top-level consts are not visible in hook callbacks.

routerAdd('POST', '/api/crawl/clone', (e) => {
  const ID = /^[a-z0-9]{15}$/
  // What a stop means for planning. Legs are recomputed by the stop hook after commit; votes,
  // comments, crew photos and anything from the day itself stay with the original.
  const STOP_FIELDS = ['order', 'name', 'kind', 'direction', 'station_id', 'station_name', 'place', 'place_id', 'osm_id',
    'address', 'lat', 'lon', 'hours', 'phone', 'website', 'confirmed_open', 'dwell_min', 'walk_min', 'notes', 'meet_point']
  const body = e.requestInfo().body
  const source = String(body.source || '')
  const id = String(body.id || '')
  if (!ID.test(source) || !ID.test(id) || source === id) throw new BadRequestError('bad_clone_request')
  const titles = require(`${__hooks}/routeTitle.js`)
  const name = titles.normalize(body.title)
  if (!name) throw new BadRequestError('title_invalid')
  const who = e.auth.id
  let answer = null

  $app.runInTransaction((tx) => {
    let existing = null
    try { existing = tx.findRecordById('itineraries', id) } catch (_) {}
    if (existing) {
      const proofs = tx.findRecordsByFilter('comments',
        "target_collection = 'itineraries' && target_id = {:id} && kind = 'cloned_from' && user = {:u}", '', 0, 0, { id, u: who })
      const ours = proofs.some((p) => { try { return JSON.parse(p.getString('meta')).route === source } catch (_) { return false } })
      if (!ours) throw new ApiError(409, 'clone_conflict')
      answer = { id, title: existing.getString('title') }
      return
    }
    let src
    try { src = tx.findRecordById('itineraries', source) } catch (_) { throw new NotFoundError('route_gone') }
    if (titles.taken(tx, name.key, '')) throw new BadRequestError('title_taken')

    const it = new Record(tx.findCollectionByNameOrId('itineraries'))
    it.set('id', id)
    it.set('title', name.display)
    it.set('title_key', name.key)
    it.set('status', 'draft')
    it.set('vote_open', false)
    it.set('created_by', who)
    for (const f of ['event_date', 'start_time', 'start_station', 'start_station_name']) it.set(f, src.get(f))
    tx.save(it)

    const stopsCol = tx.findCollectionByNameOrId('stops')
    for (const s of tx.findRecordsByFilter('stops', 'itinerary = {:id}', 'order,created', 0, 0, { id: source })) {
      const copy = new Record(stopsCol)
      for (const f of STOP_FIELDS) copy.set(f, s.get(f))
      copy.set('itinerary', id)
      copy.set('photos_status', s.getString('photos_status') === 'done' ? 'done' : 'none')
      tx.save(copy)
    }

    const commentsCol = tx.findCollectionByNameOrId('comments')
    const note = (target, kind, meta) => {
      const n = new Record(commentsCol)
      n.set('user', who)
      n.set('target_collection', 'itineraries')
      n.set('target_id', target)
      n.set('kind', kind)
      n.set('meta', meta)
      tx.save(n)
    }
    note(id, 'cloned_from', { route: source, title: src.getString('title') })
    note(source, 'cloned_to', { route: id, title: name.display })
    answer = { id, title: name.display }
  })
  return e.json(200, answer)
}, $apis.requireAuth('users'))
