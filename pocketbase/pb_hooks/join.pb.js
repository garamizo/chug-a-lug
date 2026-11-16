// Sign-up with the join link (spec 2026-11-15-join-link-design.md §4.2). Guests need only the link
// token, then the sign-up id and secret they were handed.
routerAdd('POST', '/api/crawl/join/link', (e) => require(`${__hooks}/join.js`).link(e))
routerAdd('POST', '/api/crawl/join', (e) => require(`${__hooks}/join.js`).join(e))
routerAdd('POST', '/api/crawl/join/verify', (e) => require(`${__hooks}/join.js`).verify(e))
routerAdd('POST', '/api/crawl/join/resend', (e) => require(`${__hooks}/join.js`).resend(e))

cronAdd('join_sweep', '*/5 * * * *', () => require(`${__hooks}/join.js`).sweep($app))
