// Planning collections: defaults on create, lock guard, event log, recompute triggers.
// Superusers (admin UI, server scripts) are not crew: leave created_by/actor as submitted and treat them as admin.
// Note: top-level `const` helpers are not visible from inside hook callbacks in this runtime
// (each onRecord*/routerAdd callback is re-instantiated without the enclosing file scope), so
// the isCrew/isAdmin checks are computed locally inside every hook that needs them.

onRecordCreateRequest((e) => {
  const r = e.record
  const isCrew = !!e.auth && !e.auth.isSuperuser()
  r.set('status', 'draft')
  r.set('vote_open', false)
  r.set('locked_at', '')
  if (isCrew) r.set('created_by', e.auth.id)
  if (!r.getString('event_date')) r.set('event_date', '2026-12-26')
  if (!r.getString('start_time')) r.set('start_time', '11:00')
  e.next()
}, 'itineraries')

onRecordUpdateRequest((e) => {
  const isAdmin = !!e.auth && (e.auth.isSuperuser() || e.auth.getBool('is_admin'))
  const isCrew = !!e.auth && !e.auth.isSuperuser()
  const body = e.requestInfo().body
  const original = e.record.original()
  if (!isAdmin) {
    for (const f of ['status', 'vote_open', 'locked_at']) {
      if (Object.prototype.hasOwnProperty.call(body, f) && String(body[f]) !== String(original.get(f))) {
        throw new ForbiddenError('Only the admin can change ' + f)
      }
    }
  }
  const locking = e.record.getString('status') === 'locked' && original.getString('status') !== 'locked'
  if (locking) e.record.set('locked_at', new Date().toISOString())
  const scheduleChanged = e.record.getString('start_time') !== original.getString('start_time') ||
    e.record.getString('event_date') !== original.getString('event_date')
  e.next()
  if (locking) {
    const others = $app.findRecordsByFilter('itineraries',
      "status = 'locked' && event_date = {:date} && id != {:id}", '', 0, 0,
      { date: e.record.getString('event_date'), id: e.record.id })
    for (const o of others) { o.set('status', 'archived'); $app.save(o) }
    const log = new Record($app.findCollectionByNameOrId('event_log'))
    log.set('itinerary', e.record.id)
    log.set('kind', 'locked')
    log.set('payload', { archived: others.map((o) => o.id) })
    log.set('actor', isCrew ? e.auth.id : '')
    log.set('at', new Date().toISOString())
    $app.save(log)
  }
  if (scheduleChanged) require(`${__hooks}/recompute.js`)(e.record.id)
}, 'itineraries')

onRecordCreateRequest((e) => {
  const r = e.record
  if (!r.getString('kind')) r.set('kind', 'bar')
  if (!r.getString('photos_status')) r.set('photos_status', 'none')
  if (r.get('dwell_min') === null || r.get('dwell_min') === undefined || r.getInt('dwell_min') === 0) r.set('dwell_min', 60)
  if (!r.getInt('order')) {
    const last = $app.findRecordsByFilter('stops', 'itinerary = {:it}', '-order', 1, 0, { it: r.getString('itinerary') })
    r.set('order', last.length ? last[0].getInt('order') + 1 : 1)
  }
  e.next()
}, 'stops')

onRecordAfterCreateSuccess((e) => {
  e.next()
  require(`${__hooks}/recompute.js`)(e.record.getString('itinerary'))
}, 'stops')

onRecordAfterUpdateSuccess((e) => {
  e.next()
  require(`${__hooks}/recompute.js`)(e.record.getString('itinerary'))
}, 'stops')

onRecordAfterDeleteSuccess((e) => {
  e.next()
  require(`${__hooks}/recompute.js`)(e.record.getString('itinerary'))
}, 'stops')
