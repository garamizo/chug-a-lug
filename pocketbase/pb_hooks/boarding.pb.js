// Boarding routes (spec §2). Guests only need the request id and secret they were handed.
routerAdd('POST', '/api/crawl/join', (e) => require(`${__hooks}/boarding.js`).join(e))
routerAdd('POST', '/api/crawl/join/verify', (e) => require(`${__hooks}/boarding.js`).verify(e))
routerAdd('POST', '/api/crawl/join/status', (e) => require(`${__hooks}/boarding.js`).status(e))
routerAdd('POST', '/api/crawl/join/resend', (e) => require(`${__hooks}/boarding.js`).resend(e))

// Google: a new identity becomes a boarding request, never a user; an existing one must match
// its seat's email. Skipping e.next() means PocketBase creates no record and no link.
onRecordAuthWithOAuth2Request((e) => {
  if (require(`${__hooks}/boarding.js`).googleRequest(e)) return
  e.next()
}, 'users')

cronAdd('boarding_sweep', '*/5 * * * *', () => require(`${__hooks}/boarding.js`).sweep($app))
cronAdd('crew_access_daily', '17 3 * * *', () => require(`${__hooks}/boarding.js`).daily($app))

routerAdd('POST', '/api/crawl/boarding/{id}/let-aboard', (e) => require(`${__hooks}/boarding.js`).decide(e, 'aboard'))
routerAdd('POST', '/api/crawl/boarding/{id}/turn-away', (e) => require(`${__hooks}/boarding.js`).decide(e, 'away'))
