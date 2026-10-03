// Requests through the tunnel always carry CF-Connecting-IP (Cloudflare sets it; nothing else
// reaches PocketBase, see compose.yml). Those never see the admin UI or any superuser endpoint,
// whether the URL names the collection or uses its id. The box and the web container are unaffected.
routerUse((e) => {
  if (e.request.header.get('CF-Connecting-IP')) {
    const path = e.request.url.path
    if (path === '/_' || path.indexOf('/_/') === 0) return e.json(404, { message: 'Not found.' })
    const m = /^\/api\/collections\/([^/]+)/.exec(path)
    if (m) {
      let name = ''
      try { name = $app.findCollectionByNameOrId(decodeURIComponent(m[1])).name } catch (_) {}
      if (name === '_superusers') return e.json(404, { message: 'Not found.' })
    }
  }
  return e.next()
})
