// The current route for server-side decisions, as the web client resolves it: the Conductor's
// selection if it is still locked, else the most recently locked route, else ''.
module.exports.currentItineraryId = function (app) {
  try {
    const id = app.findRecordById('crawl_settings', 'crawlsettings').getString('current_itinerary')
    if (id && app.findRecordById('itineraries', id).getString('status') === 'locked') return id
  } catch (_) {}
  try {
    const rows = app.findRecordsByFilter('itineraries', 'status = "locked"', '-locked_at', 1, 0)
    return rows.length ? rows[0].id : ''
  } catch (_) { return '' }
}
