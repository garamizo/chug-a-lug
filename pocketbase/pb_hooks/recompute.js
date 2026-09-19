// Asks the SvelteKit server to recompute legs for an itinerary. Synchronous ($http.send blocks), so keep
// the timeout short; a missing web server only logs. Skipped when the env is not configured (tests).
module.exports = function requestRecompute(itineraryId) {
  const base = $os.getenv('WEB_INTERNAL_URL')
  const secret = $os.getenv('INTERNAL_SECRET')
  if (!base || !secret || !itineraryId) return
  const url = base.replace(/\/$/, '') + '/api/internal/recompute?itinerary=' + encodeURIComponent(itineraryId)
  try {
    const res = $http.send({ url, method: 'POST', headers: { 'X-Internal-Secret': secret }, timeout: 20 })
    if (res.statusCode >= 300) console.log('[recompute] ' + itineraryId + ' -> HTTP ' + res.statusCode + ' ' + toString(res.body))
  } catch (err) {
    console.log('[recompute] ' + itineraryId + ' unreachable: ' + err)
  }
}
