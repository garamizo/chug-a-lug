// Crew roles (spec 2026-11-19-crew-roles-design.md, "Data"): users.role replaces users.blocked.
// An empty role reads as crew everywhere (pb_hooks/crew.js roleOf). Self-contained, like every
// migration here (their tests run with an empty hooks directory).
migrate((app) => {
  // Swaps one clause of a rule in place; a rule without it is refused, loudly. Defined inside each
  // callback: the file's top level is not in scope when PocketBase runs them.
  const swapClause = (rule, from, to) => {
    const clauses = rule.split(' && ')
    if (clauses.indexOf(from) < 0) throw new Error('crew roles: users.updateRule lacks ' + from + ': ' + rule)
    return clauses.map((c) => c === from ? to : c).join(' && ')
  }
  const users = app.findCollectionByNameOrId('users')
  users.fields.add(new SelectField({ name: 'role', values: ['crew', 'trainspotter', 'put_off'], maxSelect: 1, required: false }))
  app.save(users)
  // Raw SQL: no hooks, and a put-off's token key is left as it is (its sessions are already dead).
  app.db().newQuery("UPDATE users SET role = CASE WHEN blocked THEN 'put_off' ELSE 'crew' END").execute()

  const fresh = app.findCollectionByNameOrId('users')
  fresh.fields.removeByName('blocked')
  // In place, every other clause and its order kept. A null rule (superusers only) stays null:
  // rewriting it as '' would let anyone edit any user. A rule without the clause stops the upgrade:
  // carrying on would leave `role` open to every user's own update.
  if (fresh.updateRule) fresh.updateRule = swapClause(fresh.updateRule, '@request.body.blocked:isset = false', '@request.body.role:isset = false')
  app.save(fresh)

  const log = app.findCollectionByNameOrId('access_log')
  const event = log.fields.getByName('event')
  event.values = event.values.filter((v) => v !== 'role_changed').concat(['role_changed'])
  app.save(log)

  // One Conductor. onBootstrap runs before migrations, so on the first start after this upgrade
  // pb_hooks/crew.js ensureConductor finds no role field and skips: this copy does its whole path,
  // so a CONDUCTOR_EMAIL changed in the same deploy moves the Conductor instead of leaving none.
  // Reuse the account by email, else mint one under the first free name (as 1758900000_crew_access
  // steps 2–3), make it a verified Crew admin, and only then demote everyone else. Rehearsals (SIM=1)
  // keep their extra admins, and with no CONDUCTOR_EMAIL nobody is demoted. No log row, to stay
  // self-contained.
  const email = ($os.getenv('CONDUCTOR_EMAIL') || '').trim().toLowerCase()
  if ($os.getenv('SIM') !== '1' && email) {
    let conductor = null
    try { conductor = app.findAuthRecordByEmail('users', email) } catch (_) {}
    if (!conductor) {
      let name = 'Conductor'
      for (let n = 2; ; n++) {
        try { app.findFirstRecordByData('users', 'name_key', name.toLowerCase()) } catch (_) { break }
        name = 'Conductor ' + n
      }
      conductor = new Record(app.findCollectionByNameOrId('users'))
      conductor.set('name', name)
      conductor.set('name_key', name.toLowerCase())
      conductor.setEmail(email)
      conductor.setPassword($security.randomString(40))
    }
    conductor.setVerified(true)
    conductor.set('is_admin', true)
    conductor.set('role', 'crew')
    app.save(conductor)
    app.db().newQuery('UPDATE users SET is_admin = FALSE WHERE is_admin = TRUE AND id != {:id}').bind({ id: conductor.id }).execute()
  }
}, (app) => {
  const swapClause = (rule, from, to) => {
    const clauses = rule.split(' && ')
    if (clauses.indexOf(from) < 0) throw new Error('crew roles: users.updateRule lacks ' + from + ': ' + rule)
    return clauses.map((c) => c === from ? to : c).join(' && ')
  }
  const users = app.findCollectionByNameOrId('users')
  users.fields.add(new BoolField({ name: 'blocked' }))
  app.save(users)
  app.db().newQuery("UPDATE users SET blocked = (role = 'put_off')").execute()

  const fresh = app.findCollectionByNameOrId('users')
  fresh.fields.removeByName('role')
  if (fresh.updateRule) fresh.updateRule = swapClause(fresh.updateRule, '@request.body.role:isset = false', '@request.body.blocked:isset = false')
  app.save(fresh)
  // access_log keeps role_changed, as 1759100000_join_link keeps its events: PocketBase checks the
  // values only when a row is saved, and dropping one would orphan history.
})
