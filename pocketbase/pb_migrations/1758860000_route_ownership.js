// Routes belong to their builder: only the builder (while it is a draft) or the Conductor writes
// its stops, and the Conductor may delete a route in any status. Comment and vote targets can
// never be changed after creation (targets.pb.js validates them on create).
migrate((app) => {
  const U = "@request.auth.id != ''"
  const ADMIN = '@request.auth.is_admin = true'
  const OWN_DRAFT_OR_ADMIN = `${U} && ((itinerary.status = 'draft' && itinerary.created_by = @request.auth.id) || ${ADMIN})`

  const stops = app.findCollectionByNameOrId('stops')
  stops.createRule = OWN_DRAFT_OR_ADMIN
  stops.updateRule = `${OWN_DRAFT_OR_ADMIN} && @request.body.itinerary:isset = false`
  stops.deleteRule = OWN_DRAFT_OR_ADMIN
  app.save(stops)

  const itineraries = app.findCollectionByNameOrId('itineraries')
  itineraries.deleteRule = `${U} && ((status = 'draft' && created_by = @request.auth.id) || ${ADMIN})`
  app.save(itineraries)

  const FIXED_TARGET = '@request.body.target_collection:isset = false && @request.body.target_id:isset = false'
  for (const name of ['comments', 'votes']) {
    const c = app.findCollectionByNameOrId(name)
    c.updateRule = `${U} && user = @request.auth.id && @request.body.user:isset = false && ${FIXED_TARGET}`
    app.save(c)
  }
}, (app) => {
  const U = "@request.auth.id != ''"
  const ADMIN = '@request.auth.is_admin = true'
  const DRAFT_OR_ADMIN = `${U} && (itinerary.status = 'draft' || ${ADMIN})`
  const stops = app.findCollectionByNameOrId('stops')
  stops.createRule = DRAFT_OR_ADMIN
  stops.updateRule = DRAFT_OR_ADMIN
  stops.deleteRule = DRAFT_OR_ADMIN
  app.save(stops)
  const itineraries = app.findCollectionByNameOrId('itineraries')
  itineraries.deleteRule = `${U} && status = 'draft' && (created_by = @request.auth.id || ${ADMIN})`
  app.save(itineraries)
  for (const name of ['comments', 'votes']) {
    const c = app.findCollectionByNameOrId(name)
    c.updateRule = `${U} && user = @request.auth.id && @request.body.user:isset = false`
    app.save(c)
  }
})
