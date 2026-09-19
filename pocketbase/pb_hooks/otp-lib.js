exports.allow = function (phone) {
  try { return $app.findFirstRecordByData('allowlist', 'phone', phone) } catch (_) { return null }
}

// Persistent, atomic rolling-window limits; rejected attempts do not extend the window.
exports.consume = function (key, maximum, seconds) {
  let allowed = false
  const now = Math.floor(Date.now() / 1000)
  $app.runInTransaction((app) => {
    app.db().newQuery('DELETE FROM _crawl_limits WHERE at <= {:cutoff}').bind({ cutoff: now - 3600 }).execute()
    const row = new DynamicModel({ count: 0 })
    app.db().newQuery('SELECT COUNT(*) AS count FROM _crawl_limits WHERE key = {:key} AND at > {:cutoff}').bind({ key, cutoff: now - seconds }).one(row)
    if (row.count < maximum) {
      app.db().newQuery('INSERT INTO _crawl_limits (key, at) VALUES ({:key}, {:now})').bind({ key, now }).execute()
      allowed = true
    }
  })
  return allowed
}

exports.verify = function (phone, code) {
  const devCode = $os.getenv('OTP_DEV_CODE')
  if ($app.isDev() && devCode) return code === undefined || code === devCode ? 204 : 401
  const sid = $os.getenv('TWILIO_ACCOUNT_SID')
  const token = $os.getenv('TWILIO_AUTH_TOKEN')
  const service = $os.getenv('TWILIO_VERIFY_SID')
  if (!sid || !token || !service) return 502
  try {
    // net/http converts URL userinfo to Basic auth. Never log this URL or the error.
    const response = $http.send({
      url: 'https://' + encodeURIComponent(sid) + ':' + encodeURIComponent(token) + '@verify.twilio.com/v2/Services/' + encodeURIComponent(service) + (code === undefined ? '/Verifications' : '/VerificationChecks'),
      method: 'POST', timeout: 20,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'To=' + encodeURIComponent(phone) + (code === undefined ? '&Channel=sms' : '&Code=' + encodeURIComponent(code)),
    })
    if (code !== undefined && response.statusCode === 404) return 401 // expired/missing verification
    if (response.statusCode < 200 || response.statusCode >= 300) return 502
    return code === undefined || (response.json && response.json.status === 'approved') ? 204 : 401
  } catch (_) { return 502 }
}
