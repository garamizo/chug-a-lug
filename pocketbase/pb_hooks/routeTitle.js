// Route names: 1–80 characters once trimmed, unique ignoring case and runs of spaces.
// Mirrors web/src/lib/routeTitle.ts; keep the two in step.
// Callers throw BadRequestError('title_taken' | 'title_invalid'); PocketBase sentenizes that
// message on the wire (capitalizes it, appends a period), so web/src/lib/routeTitle.ts's
// titleError() undoes that before matching. Hook tests assert the sentenized form.
module.exports = {
  normalize(input) {
    if (typeof input !== 'string') return null
    const display = input.trim()
    if (display.length < 1 || display.length > 80) return null
    return { display, key: display.replace(/\s+/g, ' ').toLowerCase() }
  },
  taken(app, key, exceptId) {
    try {
      app.findFirstRecordByFilter('itineraries', 'title_key = {:k} && id != {:id}', { k: key, id: exceptId || '' })
      return true
    } catch (_) { return false }
  }
}
