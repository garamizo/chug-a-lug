// Live-day guards. Note: top-level consts are not visible inside these callbacks (each one is
// re-instantiated without the file scope), so everything a hook needs is computed inside it.

// Freight: the client sends the stop its board is showing. Trust it only when that stop belongs
// to the current route; a photo is never lost over a tagging disagreement.
onRecordCreateRequest((e) => {
  const r = e.record
  const isCrew = !!e.auth && !e.auth.isSuperuser()
  if (isCrew) r.set('user', e.auth.id)
  let ok = false
  const stopId = r.getString('stop')
  if (stopId) {
    try {
      const stop = $app.findRecordById('stops', stopId)
      ok = stop.getString('itinerary') === require(`${__hooks}/current.js`).currentItineraryId($app)
    } catch (_) {
      ok = false
    }
  }
  if (ok) {
    if (r.getString('tagged_by') !== 'manual') r.set('tagged_by', 'clock')
  } else {
    r.set('stop', '')
    r.set('tagged_by', 'none')
  }
  r.set('at', require(`${__hooks}/clock.js`).eventNow(e.app))
  e.next()
}, 'media')

// Bulletins are the Conductor's: the author is whoever is signed in, whatever the body claims.
onRecordCreateRequest((e) => {
  const isCrew = !!e.auth && !e.auth.isSuperuser()
  if (isCrew) e.record.set('created_by', e.auth.id)
  e.record.set('at', require(`${__hooks}/clock.js`).eventNow(e.app))
  e.next()
}, 'broadcasts')

// Every Bulletin is part of the day's record.
onRecordAfterCreateSuccess((e) => {
  e.next()
  const log = new Record($app.findCollectionByNameOrId('event_log'))
  log.set('itinerary', e.record.getString('itinerary'))
  log.set('kind', 'bulletin')
  log.set('payload', { broadcast: e.record.id, kind: e.record.getString('kind'), body: e.record.getString('body') })
  log.set('actor', e.record.getString('created_by'))
  log.set('at', e.record.getString('at'))
  $app.save(log)
}, 'broadcasts')

// Crew chat: the author is whoever is signed in, and the time is the event's, whatever the body says.
// A superuser may supply the time, so a fixture can put a line on an earlier day.
onRecordCreateRequest((e) => {
  if (e.auth?.isSuperuser() && e.record.getString('at')) return e.next()
  const isCrew = !!e.auth && !e.auth.isSuperuser()
  if (isCrew) e.record.set('user', e.auth.id)
  e.record.set('at', require(`${__hooks}/clock.js`).eventNow(e.app))
  e.next()
}, 'chat_messages')

// Drinks are stamped by the server like every other live row, so a phone's wrong clock cannot put a
// round on the wrong day. The client's `at` is only its optimistic guess.
onRecordCreateRequest((e) => {
  e.record.set('at', require(`${__hooks}/clock.js`).eventNow(e.app))
  e.next()
}, 'drink_entries')
