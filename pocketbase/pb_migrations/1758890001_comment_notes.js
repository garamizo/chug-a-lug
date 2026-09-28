// Notes: comments the server writes when a route is cloned or renamed. Clients can neither write one
// nor turn their own comment into one, and only the Conductor can remove one, so the trail survives.
migrate((app) => {
  const U = "@request.auth.id != ''"
  const ADMIN = '@request.auth.is_admin = true'
  const FIXED_TARGET = '@request.body.target_collection:isset = false && @request.body.target_id:isset = false'
  const NO_NOTE = '@request.body.kind:isset = false && @request.body.meta:isset = false'
  const c = app.findCollectionByNameOrId('comments')
  c.fields.add(new SelectField({ name: 'kind', values: ['cloned_from', 'cloned_to', 'renamed'], maxSelect: 1 }))
  c.fields.add(new JSONField({ name: 'meta', maxSize: 4000 }))
  c.createRule = `${U} && @request.body.user = @request.auth.id && ${NO_NOTE}`
  c.updateRule = `${U} && user = @request.auth.id && kind = '' && @request.body.user:isset = false && ${FIXED_TARGET} && ${NO_NOTE}`
  c.deleteRule = `${U} && ((user = @request.auth.id && kind = '') || ${ADMIN})`
  app.save(c)
}, (app) => {
  const U = "@request.auth.id != ''"
  const ADMIN = '@request.auth.is_admin = true'
  const FIXED_TARGET = '@request.body.target_collection:isset = false && @request.body.target_id:isset = false'
  const c = app.findCollectionByNameOrId('comments')
  c.createRule = `${U} && @request.body.user = @request.auth.id`
  c.updateRule = `${U} && user = @request.auth.id && @request.body.user:isset = false && ${FIXED_TARGET}`
  c.deleteRule = `${U} && (user = @request.auth.id || ${ADMIN})`
  c.fields.removeByName('kind')
  c.fields.removeByName('meta')
  app.save(c)
})
