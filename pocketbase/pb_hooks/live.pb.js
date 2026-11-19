// Live-day guards. Note: top-level consts are not visible inside these callbacks (each one is
// re-instantiated without the file scope), so everything a hook needs is computed inside it.

// Freight: the client sends the stop its board is showing. Trust it only when that stop belongs
// to the current route; a photo is never lost over a tagging disagreement. Every photo is filed
// under the current route, so the chat shows the ones taken before or after the crawl too.
// A photo carrying `drink_kind` is a Tab proof, and stricter: it must be a photo (judged by its
// bytes, not its name or the client's `kind`) taken at a stop of the current route.
onRecordCreateRequest((e) => {
  const r = e.record
  const proof = !!r.getString('drink_kind')
  const isCrew = !!e.auth && !e.auth.isSuperuser()
  // A Trainspotter rides along but keeps no Tab (spec 2026-11-19): photos and chat stay open to them.
  if (isCrew && proof && require(`${__hooks}/crew.js`).roleOf(e.auth) === 'trainspotter') throw new BadRequestError('trainspotter')
  if (proof) {
    // JPEG, PNG, GIF, WebP and HEIC/HEIF, by their leading bytes.
    const isPhoto = (b) => {
      const at = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0))
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true
      if (b[0] === 0x89 && at(1, 'PNG\r\n\x1a\n')) return true
      if (at(0, 'GIF87a') || at(0, 'GIF89a')) return true
      if (at(0, 'RIFF') && at(8, 'WEBP')) return true
      return at(4, 'ftyp') && ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].some((brand) => at(8, brand))
    }
    const file = r.getUnsavedFiles('file')[0]
    let head = []
    if (file) {
      const reader = file.reader.open()
      try { head = toBytes(reader, 16) } finally { reader.close() }
    }
    // No file at all is left to the required field, as for any photo.
    if (r.getString('kind') !== 'image' || (file && !isPhoto(head))) throw new BadRequestError('proof_needs_image')
  }
  if (isCrew) r.set('user', e.auth.id)
  const current = require(`${__hooks}/current.js`).currentItineraryId($app) || ''
  r.set('itinerary', current)
  let ok = false
  const stopId = r.getString('stop')
  if (stopId && current) {
    try {
      ok = $app.findRecordById('stops', stopId).getString('itinerary') === current
    } catch (_) {
      ok = false
    }
  }
  if (ok) {
    if (r.getString('tagged_by') !== 'manual') r.set('tagged_by', 'clock')
  } else if (proof) {
    throw new BadRequestError('proof_needs_stop')
  } else {
    r.set('stop', '')
    r.set('tagged_by', 'none')
  }
  r.set('at', require(`${__hooks}/clock.js`).eventNow(e.app))
  e.next()
}, 'media')

// A proof's drink is written with it or not at all: one transaction around the photo's save chain
// and the drink's (see action_order.pb.js, which numbers the drink inside the same transaction).
// The drink takes the photo's id, so a resent photo is refused as a duplicate and never counts twice.
onRecordCreate((e) => {
  const kind = e.record.getString('drink_kind')
  if (!kind) return e.next()
  const original = e.app
  try {
    original.runInTransaction((tx) => {
      e.app = tx
      e.next()
      const m = e.record
      const drink = new Record(tx.findCollectionByNameOrId('drink_entries'))
      drink.set('id', m.id)
      drink.set('user', m.getString('user'))
      drink.set('stop', m.getString('stop'))
      drink.set('kind', kind)
      // A hook save skips the drinks' request stamping below, so the photo's time is copied over.
      drink.set('at', m.getString('at'))
      drink.set('media', m.id)
      tx.save(drink)
    })
  } finally { e.app = original }
}, 'media')

// The pairing is fixed once made: no update may turn a photo into a proof, or change what a proof
// is, whose it is, or where it was taken. Request-only, so a stop's delete can still clear `stop`.
onRecordUpdateRequest((e) => {
  const before = e.record.original()
  const was = before.getString('drink_kind')
  if (was || e.record.getString('drink_kind')) {
    const changed = ['drink_kind', 'kind', 'file', 'user', 'stop', 'itinerary'].some((f) => e.record.getString(f) !== before.getString(f))
    if (!was || changed || e.record.getUnsavedFiles('file').length) throw new BadRequestError('proof_locked')
  }
  e.next()
}, 'media')

// Deletes go through the drink: Undo, a stop or user cascade, or the Conductor deleting the photo
// (which cascades here through drink_entries.media). The photo goes with its drink in the same
// transaction; one already gone is fine, and a photo that cannot be deleted keeps the drink too.
// Only the drink's own proof goes (a proof photo under the drink's id): a drink pointing at any
// other photo must not become a way round the Conductor-only media delete.
onRecordDelete((e) => {
  const original = e.app
  try {
    original.runInTransaction((tx) => {
      e.app = tx
      e.next()
      const photo = e.record.getString('media')
      if (!photo || photo !== e.record.id) return
      const found = tx.findRecordsByFilter('media', "id = {:id} && drink_kind != ''", '', 1, 0, { id: photo })
      if (found.length) tx.delete(found[0])
    })
  } finally { e.app = original }
}, 'drink_entries')

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

// A Cheers counts on the day it was given, by the event clock: in a rehearsal `created` is wall time.
onRecordCreateRequest((e) => {
  e.record.set('at', require(`${__hooks}/clock.js`).eventNow(e.app))
  e.next()
}, 'reactions')

// Drinks are stamped by the server like every other live row, so a phone's wrong clock cannot put a
// round on the wrong day. The client's `at` is only its optimistic guess. A drink's photo is paired
// by the media hook alone; only a superuser may name one in a drink create.
onRecordCreateRequest((e) => {
  // Defence only: createRule null already refuses every non-superuser create before this hook.
  if (e.record.getString('media') && !e.auth?.isSuperuser()) throw new BadRequestError('proof_locked')
  e.record.set('at', require(`${__hooks}/clock.js`).eventNow(e.app))
  e.next()
}, 'drink_entries')
