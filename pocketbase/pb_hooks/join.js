// Sign-up with the join link (spec 2026-11-15-join-link-design.md §4.2): link → name, email, password
// → emailed code → signed in. A pending sign-up holds no seat and no name; the seat is taken by the
// verify that creates the user. Every check and write of join, verify and resend share one
// transaction (PocketBase serialises write transactions), and mail goes out only after the commit.
const LINK = 'This link is used up or expired. Ask the Conductor for a new one.'
const EXPIRED = 'That code expired. Start again.'
const BUSY = 'Too many sign-ups right now. Try again in an hour.'
const NO_MAIL = "Couldn't send the email. Try later."
const NOT_FOUND = 'Sign-up not found.'
const LIFE = 60 * 60e3        // a sign-up lives an hour from its creation
const CODE_LIFE = 15 * 60e3   // a code works for 15 minutes
const OPEN_CAP = 10           // open (unexpired, unverified) sign-ups at once

const sqlTime = (ms) => new Date(ms).toISOString().replace('T', ' ')
const ms = (record, field) => record.getDateTime(field).unix() * 1000
const newCode = () => $security.randomStringWithAlphabet(6, '0123456789')
// The mail itself, plain and ticket HTML: ticketMail.js.
const codeMail = (email, code) => require(`${__hooks}/ticketMail.js`).codeMail(email, code)

// Both code-mail budgets: every code mail, first send and resend alike, spends one of each, so
// replacing a sign-up never resets an address, and a leaked link sends at most 40 an hour.
const mailBudgets = (email, linkId) => [['join-mail:' + require(`${__hooks}/crew.js`).hash(email), 3], ['join-mail-link:' + linkId, 40]]
const joinBudget = (ip) => ['join:' + ip, 20]
const fits = (tx, budgets) => budgets.every(([key, max]) => require(`${__hooks}/limits.js`).availableInTransaction(tx, key, max, 3600))

// All of them are checked before any is spent: a refusal sends no mail, so it costs no budget (a
// relative refused by a spent link still has their own three mails for the next one, and their
// IP its sign-ups).
function spendAll(tx, budgets) {
  if (!fits(tx, budgets)) return false
  // Cannot refuse now: the transaction is serialised and every count was just checked.
  for (const [key, max] of budgets) require(`${__hooks}/limits.js`).consumeInTransaction(tx, key, max, 3600)
  return true
}

// Open (unexpired, unverified) sign-ups on this link, not counting the one this email would replace.
// Per link, so revoking a leaked link frees the cap for the next one at once.
const openOn = (tx, linkId, email) => tx.findRecordsByFilter('signups', "user = '' && expires_at > {:now} && link = {:link} && email != {:email}", '', 0, 0, { now: sqlTime(Date.now()), link: linkId, email }).length

// Why this form cannot sign up now, read on `tx`; '' when it can. The same checks run twice: on $app
// before bcrypt (so a refused post costs no hash), then inside the transaction that writes.
function refusal(tx, link, name, email, ip) {
  if (!link) return 'dead'
  try { tx.findFirstRecordByData('users', 'name_key', name.key); return 'name' } catch (_) {}
  try { tx.findAuthRecordByEmail('users', email); return 'seated' } catch (_) {}
  if (openOn(tx, link.id, email) >= OPEN_CAP) return 'busy'
  if (!fits(tx, [joinBudget(ip), ...mailBudgets(email, link.id)])) return 'busy'
  return ''
}

// The signup row named by the body, if its secret matches; read inside the caller's transaction.
function findSignup(tx, body) {
  const crew = require(`${__hooks}/crew.js`)
  if (typeof body.signup_id !== 'string' || typeof body.secret !== 'string') return null
  let r
  try { r = tx.findRecordById('signups', body.signup_id) } catch (_) { return null }
  return $security.equal(r.getString('secret_hash'), crew.hash(body.secret)) ? r : null
}

function linkActive(tx, id) {
  if (!id) return false
  try { return require(`${__hooks}/links.js`).isActive(tx.findRecordById('join_links', id)) } catch (_) { return false }
}

exports.link = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const info = crew.clientInfo(e)
  if (!require(`${__hooks}/limits.js`).consume('join-link:' + info.ip, 30, 3600)) {
    crew.logEvent($app, { event: 'rate_limited', detail: 'join link' }, info)
    return e.json(429, { message: 'Too many tries. Try again in an hour.' })
  }
  const token = (e.requestInfo().body || {}).token
  return require(`${__hooks}/links.js`).findActive($app, token) ? e.json(200, {}) : e.json(410, { message: LINK })
}

exports.join = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const limits = require(`${__hooks}/limits.js`)
  const links = require(`${__hooks}/links.js`)
  const info = crew.clientInfo(e)
  const body = e.requestInfo().body || {}
  // Free to retry: nothing below this spends a budget until the whole form is valid.
  const name = require(`${__hooks}/names.js`)(body.name)
  if (!name) return e.json(400, { message: "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -" })
  const email = crew.normalizeEmail(body.email)
  if (!email) return e.json(400, { message: 'Enter a valid email address.' })
  const problem = crew.passwordProblem(body.password)
  if (problem) return e.json(400, { message: problem })
  // Cheap reads before bcrypt, so a dead link, a taken name or seat, or a spent budget never costs
  // a hash. The transaction checks them all again.
  const early = refusal($app, links.findActive($app, body.token), name, email, info.ip)
  const passwordHash = early ? '' : crew.hashPassword($app, body.password)
  const secret = $security.randomString(43)
  const code = newCode()
  let outcome = early, record = null
  if (!early) $app.runInTransaction((tx) => {
    const link = links.findActive(tx, body.token)
    outcome = refusal(tx, link, name, email, info.ip)
    if (outcome) return
    if (!spendAll(tx, [joinBudget(info.ip), ...mailBudgets(email, link.id)])) { outcome = 'busy'; return }
    const now = Date.now()
    for (const old of tx.findRecordsByFilter('signups', "user = '' && email = {:email}", '', 0, 0, { email })) tx.delete(old)
    record = new Record(tx.findCollectionByNameOrId('signups'))
    record.set('email', email)
    record.set('name', name.display)
    record.set('name_key', name.key)
    record.set('password_hash', passwordHash)
    record.set('code_hash', crew.hash(code))
    record.set('code_attempts', 0)
    record.set('code_sent_at', sqlTime(now))
    record.set('resends', 0)
    record.set('secret_hash', crew.hash(secret))
    record.set('link', link.id)
    record.set('expires_at', sqlTime(now + LIFE))
    for (const k of ['ip', 'country', 'city', 'user_agent']) record.set(k, info[k])
    tx.save(record)
    outcome = 'ok'
  })
  if (outcome === 'dead') return e.json(410, { message: LINK })
  if (outcome === 'name') return e.json(409, { message: 'That name is taken. Add an initial?' })
  if (outcome === 'seated') return e.json(409, { message: 'That email already has a seat. Sign in instead.' })
  if (outcome === 'busy') {
    crew.logEvent($app, { event: 'rate_limited', detail: 'join', email }, info)
    return e.json(429, { message: BUSY })
  }
  try {
    crew.sendMail($app, codeMail(email, code))
  } catch (err) {
    // Only this version: a concurrent re-sign-up for the same email may already have replaced it.
    $app.runInTransaction((tx) => {
      let r
      try { r = tx.findRecordById('signups', record.id) } catch (_) { return }
      if (r.getString('secret_hash') === crew.hash(secret)) tx.delete(r)
    })
    crew.logEvent($app, { event: 'mail_failed', email, detail: String(err).slice(0, 200) }, info)
    return e.json(502, { message: NO_MAIL })
  }
  crew.logEvent($app, { event: 'code_sent', name: name.display, email }, info)
  return e.json(200, { signup_id: record.id, secret })
}

// Judged on one fresh transactional read, so two verifies for the last seat cannot both take it.
// After success the row keeps its user and code hash until the sweep: a verify whose answer was
// lost can be repeated and signs in again without a second seat.
exports.verify = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const body = e.requestInfo().body || {}
  let outcome = 'missing', userId = '', signup = null
  $app.runInTransaction((tx) => {
    const r = findSignup(tx, body)
    if (!r) return
    signup = r
    const good = r.getString('code_hash') !== '' && $security.equal(r.getString('code_hash'), crew.hash(String(body.code || '')))
    if (r.getString('user')) {
      if (good) { outcome = 'again'; userId = r.getString('user') } else outcome = 'wrong'
      return
    }
    const now = Date.now()
    if (now >= ms(r, 'expires_at') || r.getInt('code_attempts') >= 5 || now - ms(r, 'code_sent_at') > CODE_LIFE) { outcome = 'expired'; return }
    if (!good) { r.set('code_attempts', r.getInt('code_attempts') + 1); tx.save(r); outcome = 'wrong'; return }
    let link = null
    try { link = tx.findRecordById('join_links', r.getString('link')) } catch (_) {}
    if (!link || !require(`${__hooks}/links.js`).isActive(link)) { tx.delete(r); outcome = 'dead'; return }
    try { tx.findFirstRecordByData('users', 'name_key', r.getString('name_key')); tx.delete(r); outcome = 'name'; return } catch (_) {}
    try { tx.findAuthRecordByEmail('users', r.getString('email')); tx.delete(r); outcome = 'seated'; return } catch (_) {}
    const user = new Record(tx.findCollectionByNameOrId('users'))
    user.set('name', r.getString('name'))
    user.set('name_key', r.getString('name_key'))
    user.setEmail(r.getString('email'))
    user.setVerified(true)
    user.setPassword($security.randomString(40))
    tx.save(user)
    // The hash /join stored becomes the password. SQL, because setRaw rejects a hash (crew.hashPassword).
    tx.db().newQuery('UPDATE users SET password = {:h} WHERE id = {:id}').bind({ h: r.getString('password_hash'), id: user.id }).execute()
    link.set('seats_left', link.getInt('seats_left') - 1)
    tx.save(link)
    r.set('user', user.id)
    r.set('password_hash', '')
    tx.save(r)
    userId = user.id
    outcome = 'joined'
  })
  if (outcome === 'missing') return e.json(404, { message: NOT_FOUND })
  if (outcome === 'expired') return e.json(410, { message: EXPIRED })
  if (outcome === 'wrong') return e.json(400, { message: "That code isn't right." })
  if (outcome === 'dead') return e.json(410, { message: LINK })
  if (outcome === 'name') return e.json(409, { message: 'That name was just taken. Start again with another.' })
  if (outcome === 'seated') return e.json(409, { message: 'That email already has a seat. Sign in instead.' })
  let user
  try { user = $app.findRecordById('users', userId) } catch (_) { return e.json(404, { message: NOT_FOUND }) }
  if (outcome === 'joined') {
    // A failed log never fails the sign-up: the seat is already taken.
    try { crew.logEvent($app, { event: 'joined', name: user.getString('name'), email: user.email(), user: user.id, detail: signup.getString('link') }, crew.clientInfo(e)) } catch (_) {}
  }
  // Fires onRecordAuthRequest, so signInGuard logs the sign-in and refuses a put-off seat, retries included.
  return $apis.recordAuthResponse(e, user, 'password', null)
}

// Final answers (a closed sign-up, too little life left, a dead link) come before the transient ones
// (the cooldown, the caps), so nobody waits a minute to be told to start again.
exports.resend = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const body = e.requestInfo().body || {}
  const code = newCode()
  let outcome = 'missing', email = ''
  $app.runInTransaction((tx) => {
    const r = findSignup(tx, body)
    if (!r) return
    const now = Date.now()
    if (r.getString('user') || ms(r, 'expires_at') - now < CODE_LIFE) { outcome = 'expired'; return }
    if (!linkActive(tx, r.getString('link'))) { outcome = 'dead'; return }
    if (now - ms(r, 'code_sent_at') < 60e3) { outcome = 'early'; return }
    if (r.getInt('resends') >= 3) { outcome = 'capped'; return }
    email = r.getString('email')
    if (!spendAll(tx, mailBudgets(email, r.getString('link')))) { outcome = 'capped'; return }
    r.set('code_hash', crew.hash(code))
    r.set('code_attempts', 0)
    r.set('code_sent_at', sqlTime(now))
    r.set('resends', r.getInt('resends') + 1)
    tx.save(r)
    outcome = 'ok'
  })
  if (outcome === 'missing') return e.json(404, { message: NOT_FOUND })
  if (outcome === 'expired') return e.json(410, { message: EXPIRED })
  if (outcome === 'dead') return e.json(410, { message: LINK })
  if (outcome === 'early') return e.json(429, { message: 'Wait a minute before asking again.' })
  if (outcome === 'capped') return e.json(429, { message: "That's enough codes for now. Start again later." })
  // On failure the new code is simply never seen; the person can ask again after a minute.
  try { crew.sendMail($app, codeMail(email, code)) } catch (err) {
    crew.logEvent($app, { event: 'mail_failed', email, detail: String(err).slice(0, 200) }, crew.clientInfo(e))
    return e.json(502, { message: NO_MAIL })
  }
  crew.logEvent($app, { event: 'code_sent', email }, crew.clientInfo(e))
  return e.json(200, {})
}

exports.sweep = function (app) {
  app.db().newQuery('DELETE FROM signups WHERE expires_at < {:now}').bind({ now: sqlTime(Date.now()) }).execute()
}
