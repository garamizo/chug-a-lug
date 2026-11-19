// Crew roles (spec 2026-11-19-crew-roles-design.md, "Data"): users.role replaces users.blocked.
// An empty role reads as crew everywhere (pb_hooks/crew.js roleOf). Self-contained, like every
// migration here (their tests run with an empty hooks directory).
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  users.fields.add(new SelectField({ name: 'role', values: ['crew', 'trainspotter', 'put_off'], maxSelect: 1, required: false }))
  app.save(users)
  // Raw SQL: no hooks, and a put-off's token key is left as it is (its sessions are already dead).
  app.db().newQuery("UPDATE users SET role = CASE WHEN blocked THEN 'put_off' ELSE 'crew' END").execute()

  const fresh = app.findCollectionByNameOrId('users')
  fresh.fields.removeByName('blocked')
  // In place, every other clause and its order kept. A null rule (superusers only) stays null:
  // rewriting it as '' would let anyone edit any user.
  if (fresh.updateRule) fresh.updateRule = fresh.updateRule.split(' && ').map((c) => c === '@request.body.blocked:isset = false' ? '@request.body.role:isset = false' : c).join(' && ')
  app.save(fresh)

  const log = app.findCollectionByNameOrId('access_log')
  const event = log.fields.getByName('event')
  event.values = event.values.filter((v) => v !== 'role_changed').concat(['role_changed'])
  app.save(log)
}, (app) => {
  const users = app.findCollectionByNameOrId('users')
  users.fields.add(new BoolField({ name: 'blocked' }))
  app.save(users)
  app.db().newQuery("UPDATE users SET blocked = (role = 'put_off')").execute()

  const fresh = app.findCollectionByNameOrId('users')
  fresh.fields.removeByName('role')
  if (fresh.updateRule) fresh.updateRule = fresh.updateRule.split(' && ').map((c) => c === '@request.body.role:isset = false' ? '@request.body.blocked:isset = false' : c).join(' && ')
  app.save(fresh)
  // access_log keeps role_changed, as 1759100000_join_link keeps its events: PocketBase checks the
  // values only when a row is saved, and dropping one would orphan history.
})
