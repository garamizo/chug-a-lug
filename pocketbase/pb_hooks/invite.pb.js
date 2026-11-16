// Host-only: the Conductor makes the join link with `just invite` (spec §4.1). Answers 404 unless the
// request carries INTERNAL_SECRET and did not come through the tunnel (Cloudflare adds CF-Connecting-IP).
routerAdd('POST', '/api/crawl/invite', (e) => {
  const secret = $os.getenv('INTERNAL_SECRET')
  const given = e.request.header.get('x-internal-secret') || ''
  if (!secret || !$security.equal(given, secret) || e.request.header.get('CF-Connecting-IP')) {
    return e.json(404, { message: 'Not found.' })
  }
  const links = require(`${__hooks}/links.js`)
  const crew = require(`${__hooks}/crew.js`)
  const body = e.requestInfo().body || {}
  const action = body.action

  if (action === 'status') return e.json(200, links.status($app))

  if (action === 'revoke') {
    const revoked = links.revoke($app)
    if (revoked) crew.logEvent($app, { event: 'link_revoked' })
    return e.json(200, { revoked })
  }

  if (action === 'create') {
    const seats = body.seats === undefined ? NaN : Number(body.seats)
    const days = body.days === undefined ? 14 : Number(body.days)
    if (!Number.isInteger(seats) || seats < 1 || seats > 50) return e.json(400, { message: 'Seats must be a whole number from 1 to 50.' })
    if (!Number.isInteger(days) || days < 1 || days > 60) return e.json(400, { message: 'Days must be a whole number from 1 to 60.' })
    const appURL = String($app.settings().meta.appURL || '').replace(/\/+$/, '')
    if (!appURL) return e.json(500, { message: 'APP_URL is not set, so there is nowhere for the link to point.' })
    const made = links.create($app, seats, days)
    const expires = String(made.record.getString('expires_at')).replace(' ', 'T')
    crew.logEvent($app, { event: 'link_created', detail: seats + ' seats until ' + expires.slice(0, 10) })
    return e.json(200, { url: appURL + '/join#' + made.token, seats, expires_at: expires })
  }

  return e.json(400, { message: 'Unknown action.' })
})
