// Route names: 1–80 characters once trimmed, unique ignoring case and runs of spaces.
// Mirrors web/src/lib/routeTitle.ts; keep the two in step.
// Callers throw BadRequestError('title_taken' | 'title_invalid'); PocketBase sentenizes that
// message on the wire (capitalizes it, appends a period), so web/src/lib/routeTitle.ts's
// titleError() undoes that before matching. Hook tests assert the sentenized form.
module.exports = {
  normalize(input) {
    if (typeof input !== 'string') return null
    const display = input.trim()
    // Code points, not UTF-16 units: PocketBase's TextField max counts runes.
    const length = [...display].length
    if (length < 1 || length > 80) return null
    return { display, key: display.replace(/\s+/g, ' ').toLowerCase() }
  },
  taken(app, key, exceptId) {
    const rows = app.findRecordsByFilter('itineraries', 'title_key = {:k} && id != {:id}', '', 1, 0, { k: key, id: exceptId || '' })
    return rows.length > 0
  }
}
