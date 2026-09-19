routerAdd('POST', '/api/crawl/otp/start', (e) => {
  const normalizePhone = require(`${__hooks}/phone.js`)
  const otp = require(`${__hooks}/otp-lib.js`)
  const phone = normalizePhone(e.requestInfo().body.phone)
  if (!phone) return e.json(400, { message: 'Enter a 10-digit US phone number.' })
  if (!otp.allow(phone)) return e.json(403, { message: 'This number is not on the crew list. Ask the admin.' })
  if (!otp.consume('otp-start:' + phone, 5, 3600)) return e.json(429, { message: 'Too many codes requested. Try again in an hour.' })
  if (otp.verify(phone) !== 204) return e.json(502, { message: 'Could not send the code. Try again in a minute.' })
  return e.noContent(204)
})

routerAdd('POST', '/api/crawl/otp/check', (e) => {
  const normalizePhone = require(`${__hooks}/phone.js`)
  const otp = require(`${__hooks}/otp-lib.js`)
  const body = e.requestInfo().body
  const phone = normalizePhone(body.phone)
  if (!phone) return e.json(400, { message: 'Enter a 10-digit US phone number.' })
  if (typeof body.pin !== 'string' || !/^[0-9]{4,8}$/.test(body.pin)) return e.json(400, { message: 'PIN must be 4 to 8 digits.' })
  if (typeof body.code !== 'string' || !/^[0-9]{4,8}$/.test(body.code)) return e.json(400, { message: 'Enter the code from the text message.' })
  const allowed = otp.allow(phone)
  if (!allowed) return e.json(403, { message: 'This number is not on the crew list. Ask the admin.' })
  if (!otp.consume('otp-check:' + phone, 10, 3600)) return e.json(429, { message: 'Too many code attempts. Try again in an hour.' })
  const status = otp.verify(phone, body.code)
  if (status === 502) return e.json(502, { message: 'Could not verify the code. Try again in a minute.' })
  if (status !== 204) return e.json(401, { message: 'That code did not match.' })
  let user
  $app.runInTransaction((app) => {
    try { user = app.findFirstRecordByData('users', 'phone', phone) } catch (_) {}
    if (!user) {
      user = new Record(app.findCollectionByNameOrId('users'))
      user.set('phone', phone)
      user.set('name', allowed.getString('name'))
      user.set('is_admin', allowed.getBool('is_admin'))
    }
    user.set('verified', true)
    user.setPassword(body.pin)
    app.save(user)
  })
  return e.json(200, { token: user.newAuthToken(), record: user })
})

onRecordAuthWithPasswordRequest((e) => {
  const otp = require(`${__hooks}/otp-lib.js`)
  const normalizePhone = require(`${__hooks}/phone.js`)
  const identity = normalizePhone(e.identity) || e.identity
  if (!otp.consume('pin:' + identity, 10, 900)) return e.json(429, { message: 'Too many PIN attempts. Try again in 15 minutes.' })
  e.next()
}, 'users')
