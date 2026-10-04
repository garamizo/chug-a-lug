// Password sign-in (spec 2026-10-03-password-sign-in-design.md §3.1). Self-contained, like every
// migration here (migration tests run with an empty hooks directory), and it deletes nothing.
migrate((app) => {
  const ADDED_EVENT = ['password_reset_sent', 'password_set']
  const ADDED_METHOD = ['password']
  const RULES = [
    { label: 'users:authWithPassword', maxRequests: 20, duration: 600, audience: '' },
    { label: 'users:requestPasswordReset', maxRequests: 5, duration: 600, audience: '' },
    { label: 'users:confirmPasswordReset', maxRequests: 10, duration: 600, audience: '' }
  ]
  const users = app.findCollectionByNameOrId('users')
  users.passwordAuth.enabled = true
  users.passwordAuth.identityFields = ['email']
  const password = users.fields.getByName('password')
  password.min = 8
  password.max = 64
  users.passwordResetToken.duration = 1800
  // The default links to /_/, which the tunnel blocks. The fragment keeps the token out of every log.
  users.resetPasswordTemplate.subject = 'Set your Chug-a-Lug password'
  users.resetPasswordTemplate.body = '<p>Set a new Chug-a-Lug password here:</p><p><a href="{APP_URL}/reset-password#{TOKEN}">{APP_URL}/reset-password#{TOKEN}</a></p><p>The link works once, for 30 minutes. If you did not ask for it, ignore this email.</p>'
  app.save(users)

  const requests = app.findCollectionByNameOrId('boarding_requests')
  requests.fields.add(new TextField({ name: 'password_hash', hidden: true }))
  app.save(requests)

  const log = app.findCollectionByNameOrId('access_log')
  const event = log.fields.getByName('event'), method = log.fields.getByName('method')
  event.values = event.values.filter((v) => ADDED_EVENT.indexOf(v) < 0).concat(ADDED_EVENT)
  method.values = method.values.filter((v) => ADDED_METHOD.indexOf(v) < 0).concat(ADDED_METHOD)
  app.save(log)

  const s = app.settings()
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => !RULES.some((o) => o.label === r.label)).concat(RULES)
  app.save(s)
}, (app) => {
  const users = app.findCollectionByNameOrId('users')
  users.passwordAuth.enabled = false
  const password = users.fields.getByName('password')
  password.min = 8
  password.max = 0
  users.resetPasswordTemplate.subject = 'Reset your {APP_NAME} password'
  users.resetPasswordTemplate.body = '<p>Hello,</p>\n<p>Click on the button below to reset your password.</p>\n<p>\n  <a class="btn" href="{APP_URL}/_/#/auth/confirm-password-reset/{TOKEN}" target="_blank" rel="noopener">Reset password</a>\n</p>\n<p><i>If you didn\'t ask to reset your password, please ignore this email.</i></p>\n<p>\n  Thanks,<br/>\n  {APP_NAME} team\n</p>'
  app.save(users)
  const requests = app.findCollectionByNameOrId('boarding_requests')
  requests.fields.removeByName('password_hash')
  app.save(requests)
  // access_log keeps the added select values: PocketBase checks them only when a row is saved, and
  // dropping them would orphan history (spec §3.1).
  const s = app.settings()
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => ['users:authWithPassword', 'users:requestPasswordReset', 'users:confirmPasswordReset'].indexOf(r.label) < 0)
  app.save(s)
})
