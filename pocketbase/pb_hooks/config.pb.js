// The environment becomes settings at every boot. onServe does not exist in the PocketBase JSVM,
// so this is onBootstrap, which runs BEFORE the application migrations (first deploy) and also
// during `pocketbase superuser upsert`. Hence two parts, both idempotent:
//   - settings (mail, app name, rate limits) are applied every time;
//   - the Conductor only once the users schema is ready; on a first deploy the migration mints it.
onBootstrap((e) => {
  e.next()
  const env = (k) => $os.getenv(k) || ''
  const s = $app.settings()
  s.meta.appName = 'Chug-a-Lug'
  s.meta.senderName = 'Chug-a-Lug'
  if (env('APP_URL')) s.meta.appURL = env('APP_URL')
  if (env('MAIL_FROM')) s.meta.senderAddress = env('MAIL_FROM')
  s.smtp.enabled = !!env('SMTP_HOST')
  s.smtp.host = env('SMTP_HOST')
  s.smtp.port = parseInt(env('SMTP_PORT'), 10) || 465
  s.smtp.username = env('SMTP_USERNAME')
  s.smtp.password = env('SMTP_PASSWORD')
  s.smtp.tls = env('SMTP_TLS') === '1'
  // Test harnesses drive everything from one loopback address; only they set PB_RATE_LIMITS=off.
  s.rateLimits.enabled = env('PB_RATE_LIMITS') !== 'off'
  $app.save(s)

  let users = null
  try { users = $app.findCollectionByNameOrId('users') } catch (_) { return }
  if (!users.fields.getByName('blocked')) return
  require(`${__hooks}/crew.js`).ensureConductor($app, env('CONDUCTOR_EMAIL'))
})
