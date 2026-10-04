# Password sign-in — design

Status: draft for review. Branch `feat/password-sign-in`, stacked on `feat/crew-access` (cd69b04).

## 1. Why

Crew access (spec 2026-10-03-crew-access-design.md) signs people in by email code or Google and ruled
out passwords ("No passwords for the crew"). In practice a code is needed on every new browser, after
signing out, and again inside an installed home-screen app, which on iPhone does not share Safari's
session. Each time means leaving the app for the mailbox. This change adds the standard alternative:
an email and a password, with a "Forgot password?" link that mails a reset link through the existing
Resend SMTP.

This reverses one decision of the crew-access spec and nothing else. Boarding stays peer-approved,
the Conductor still gets batched mails, every session still passes `crew.signInGuard`, and email code
and Google keep working.

Decisions taken with the user (2026-10-03):

- **Standard website flow.** `/login` shows Google and email + password. A small link leads to sign-up
  (`/join`), which offers Google or email + password.
- **No Turnstile on sign-in.** Guessing is bounded by rate limits per network and per account.
- **Everyone can have a password**, the Conductor included.

## 2. What people see

### 2.1 `/login` (production; rehearsal stacks keep their name + password form unchanged)

```
Welcome aboard
Sign in with Google or with your email and password.
[G  Continue with Google]                 (only when PUBLIC_GOOGLE_ENABLED=1)
or use your email
Email     [                    ]
Password  [                    ] [Show]
[ Sign in ]
Forgot password?  ·  Email me a code instead
New here? Board the Chug-a-Lug
```

- **Sign in** calls `authWithPassword(email, password)`. A wrong password and an unknown address give
  the same message: "That email and password don't match." A 429 or 403 shows the server's message.
- **Email me a code instead** swaps the password form for today's code form (email → code → sign
  in), unchanged. A "Use a password instead" link swaps back. People who have not set a password yet
  (everyone at deploy time, and anyone who boarded with Google) still have this path.
- **Forgot password?** opens `/login/forgot`, carrying the typed email in memory (SvelteKit
  navigation state), never in the URL.
- When Google is off, the intro reads "Sign in with your email and password." and the Google button
  and "or use your email" are hidden.

### 2.2 `/login/forgot`

An email field and **Email me a link**. Whatever the address, the answer is the same: "If that address
has a seat, a link is on its way. It works for 30 minutes." A link back to sign in.

### 2.3 `/reset-password#<token>`

The emailed link. The token is in the fragment, so it never reaches the server, Cloudflare logs or a
`Referer`. On load the page reads `location.hash`, then strips it once SvelteKit's router is ready
  (`afterNavigate`, then `replaceState` from `$app/navigation`). A fragment that will not decode counts
  as a dead link.

- A **New password** field (with Show) and **Set password**. Client-side check: `passwordProblem` (§3.2), the same rule as the server.
- On success the page signs in with the email in the token's payload and the new password, then goes
  to `/`. The note before leaving says "Password set." If that sign-in is refused (a seat put off
  meanwhile), the message shows with a link to `/login`.
- A missing, expired or already-used token: "That link expired or was already used." plus a link to
  `/login/forgot`.
- iPhone: the mail link opens Safari, not the installed app. Safari ends up signed in. The home-screen
  app then signs in with email and password, which is the convenience this change is for.

### 2.4 `/join`

The email path gains a password:

```
Name      [                    ]
[G  Continue with Google]
or use your email
Email     [                    ]
Password  [                    ] [Show]    "At least 8 characters"
(Turnstile)
[ Send code ]
```

- The code step, the waiting step and the aboard step are unchanged. The code still proves the
  address before anyone is asked to let them aboard.
- Google sign-up has no password. Those people can set one later from Account or with "Forgot password?".

### 2.5 Account (`/account`)

A **Password** line under the email: "Set or change your password" and a button **Email me a link**.
It requests a reset for the signed-in person's own address and notes "Link sent to <email>." There is
no in-app current/new password form. Google-only and code-only crew have no current password to
type, and one email flow covers both cases.

### 2.6 Mail

- **Reset** (PocketBase's reset template, sent over the configured SMTP): subject "Set your
  Chug-a-Lug password". The body says the link works for 30 minutes and links to
  `{APP_URL}/reset-password#{TOKEN}`, plus "If you did not ask for it, ignore this email." The default
  template links to `/_/`, which the tunnel blocks, so overriding it is required.
- **Aboard notice** (`boarding.decide`) is chosen by whether approval actually installed a password,
  captured before the request's hash is cleared:
  - "Sign in at …/login with your email and the password you chose." when one was installed;
  - "… with Google." for a Google request;
  - today's "… with this email address or Google." for an email request without a hash, which is
    any request filed before this deploy.

## 3. Server

### 3.1 Migration `1759000000_password_sign_in.js`

Self-contained (migration tests run with an empty hooks directory), reversible, and it deletes no data.

- `users.passwordAuth = { enabled: true, identityFields: ['email'] }`.
- `users` `password` field: `min = 8`, `max = 64`.
- `users.resetPasswordTemplate` as in §2.6. `users.passwordResetToken.duration = 1800` (PocketBase's
  default, written explicitly).
- `boarding_requests`: new `password_hash` text field, `hidden: true`.
- `access_log.event` gains `password_reset_sent` and `password_set`. `access_log.method` gains `password`.
- Rate-limit rules, added idempotently like the crew-access ones: `users:authWithPassword` 20 per 600 s
  (a crew on one bar's Wi-Fi shares an IP), `users:requestPasswordReset` 5 per 600 s,
  `users:confirmPasswordReset` 10 per 600 s.
- Down: password auth off, field limits back to PocketBase's defaults, the default reset template,
  the three rules removed, `password_hash` dropped. The new `access_log` select values stay. History
  is kept, and PocketBase validates select values only when a record is saved, not when the
  collection changes, so the extra values cost nothing. Codex corrected an earlier draft that deleted
  those rows.

`config.pb.js` (onBootstrap) does not touch any of these, so nothing re-applies them on boot.

### 3.2 Hooks

**`crew.js`**

- `METHODS.password = 'password'`. Password sign-ins then pass `signInGuard` (blocked → 403,
  `last_seen`, `signed_in` logged with method `password`) through the existing `onRecordAuthRequest`.
- `exports.passwordProblem(p)` returns `null` or the message "Pick a password of 8 to 64 characters."
  It requires a string of 8 to 64 **Unicode code points** (`[...p].length`, which is how PocketBase's
  password field counts its `min` and `max`) and at most 72 UTF-8 bytes (bcrypt's limit). Sign-up and
  reset therefore accept exactly the same passwords. Sign-up must call it itself, because the hash is
  installed by SQL and bypasses field validation. The client mirrors it in `$lib/password.ts`.
- `exports.hashPassword(app, p)` returns the bcrypt hash PocketBase would store. It builds a
  throwaway, unsaved `users` record, calls `setPassword(p)` and returns `getRaw('password').hash`.
  Verified on PocketBase 0.40.4 on 2026-10-03: the hash is a 60-character `$2a$10$` string. Written to
  a user's `password` column by SQL, it passes `validatePassword` for the original password and fails
  for any other. A raw string through `setRaw('password', hash)` is rejected ("Invalid or unsupported
  value type"). `PasswordField.prepareValue` might be a cleaner alternative, but it is untested, so
  the plan uses the SQL write unless its first test proves `prepareValue` works.

**`access.pb.js`**

- `onRecordAuthWithPasswordRequest` (users): normalise `e.identity`, then
  `limits.consume('password:' + identity, 10, 900)`. When the limit is spent, log `rate_limited`
  (detail `password`) and return 429: "Too many tries for this address. Use an email code or Google,
  or try again in 15 minutes." This runs before the password is checked and keys on the typed
  identity whether or not it has a seat, so it reveals nothing about which addresses exist. Locking
  out the real person only costs them the password path; code and Google stay open.
- `onRecordRequestPasswordResetRequest` (users) runs only for an address that has a record, and only
  after PocketBase's own two-minute resend cooldown. An unknown address, or a repeat within two
  minutes, gets PocketBase's empty 204 before the hook. The hook calls
  `limits.consume('reset:' + record.email(), 3, 3600)`. When the limit is spent, or the record is
  blocked, it answers the same empty 204 without `e.next()`. No mail goes out, and the answer matches
  a sent link exactly.
- `onMailerRecordPasswordResetSend` (users): skip the send when blocked (defence in depth), otherwise
  `e.next()` and then log `password_reset_sent`.
- `onRecordConfirmPasswordResetRequest` (users). PocketBase validates the token against a record it
  loaded earlier, and after `e.next()` it saves that same instance (`e.record`). A put-off, or a second
  confirmation, that commits between the load and the save would be overwritten: the blocked flag
  reverts, or an older token key comes back. The hook therefore follows the pattern of the
  existing `onRecordUpdateRequest`:
  - Inside `$app.runInTransaction`, with `e.app = tx` and restored in `finally`, read a fresh copy of
    the user.
  - If the fresh `tokenKey` differs from `e.record.original().tokenKey()`, the token was signed with a
    key that no longer exists, because of a put-off, an earlier reset or a password change. Answer 400
    "That link expired or was already used." This makes a reset link single-use under concurrency too.
  - If the fresh copy is blocked, answer 403 "Your seat was taken away. Ask the Conductor."
  - Otherwise copy **every** field except `password` and `tokenKey` from the fresh copy onto
    `e.record`, the instance PocketBase will save (iterate `collection().fields.fieldNames()`). That
    covers the moderation fields and also preferences such as `share_position`, `home_station` and
    `left_early`. A reset changes the password and nothing else, so a list kept by hand would drift
    (Codex, plan review).
  - Then call `e.next()` inside the transaction. Write transactions are serialised, so nothing can
    land between the check and the save.
  - After the commit, log `password_set`. PocketBase rotates the token key with the password, which
    ends every other session.
- The existing `onRecordUpdateRequest` (access.pb.js) refreshes some fields and the token key from a
  fresh read, but not the password hash. A crew name change that PocketBase loaded before a reset and
  saved after it would therefore write the **old** hash back, and the compromised password would work
  again. The hook gains one rule: when the request body does not name `password`, the fresh row's raw
  password value is copied onto `e.record` (`e.record.setRaw('password', fresh.getRaw('password'))`;
  the plan's test confirms `setRaw` accepts the field-value object). The `updateRule` keeps
  `password` locked for crew self-updates.

**`boarding.js`**

- `join`: the email path requires `body.password`. Checks run in this order: rate limit, Turnstile,
  name, email, then `passwordProblem` (400 with its message). Then `fileRequest(e, { …, passwordHash })`.
- `fileRequest` writes `password_hash` on the row it saves, decoys included. A decoy computes and
  stores a hash exactly like a real request, so its cost and its answer match. A decoy's hash is never
  applied, and a member's password can never be changed through `/join`.
- Google requests (`googleRequest`) write `password_hash = ''`.
- `decide('aboard')`: after `tx.save(user)`, if the request has a hash, run
  `tx.db().newQuery('UPDATE users SET password = {:h} WHERE id = {:id}')` inside the same
  transaction. Then clear `password_hash` on the request. A user whose request had no hash keeps
  today's random unusable password.
- Every transition into a closed state clears `password_hash`. That means `decide('away')`, every
  place the sweep expires a request, and `fileRequest`'s mail-failure expiry, which keeps its existing
  secret and status check so a concurrent re-signup is not touched. The daily job also blanks
  `password_hash` on any row whose status is not `unverified` or `waiting`, as a backstop.

### 3.3 Client

- `$lib/pb.ts`: `signInWithPassword(email, password)`, `requestPasswordReset(email)`,
  `confirmPasswordReset(token, password)` (sends `passwordConfirm = password`). `joinCrew(name, email,
  password, turnstile)` gains `password`.
- `$lib/password.ts`: `passwordProblem(p)` mirroring the server check, and `resetTokenEmail(token)`,
  which reads the `email` claim from the token payload (base64url JSON) or returns `null`. If the
  claim is missing, `/reset-password` sends the person to `/login` with "Password set. Sign in."
- `$lib/components/PasswordInput.svelte`: an input plus a Show/Hide toggle (`aria-pressed`) that takes
  `autocomplete` (`current-password` or `new-password`).
- All new strings go in `labels.ts`. The README glossary gains nothing: "password" is a plain word.
- Docs: CLAUDE.md's trap "Production signs in only by OTP or Google" becomes "by OTP, password or
  Google". OPERATIONS.md gains the password notes in §4.

## 4. Security notes

- **Enumeration.** Sign-in errors are identical for an unknown address and a wrong password
  (PocketBase answers 400 for both). Forgot always gives the same answer. `/join` keeps its decoys.
- **Guessing.** 10 tries per address per 15 minutes, plus 20 per IP per 10 minutes, behind
  Cloudflare. Online guessing of an 8+ character password is therefore impractical. Credential
  stuffing (passwords reused from elsewhere) is the remaining risk. A breach-list check is out of scope.
- **Account takeover through sign-up.** A sign-up with a member's address becomes a decoy and never
  touches the member's password. A sign-up with a non-member's address needs the code mailed to that
  address.
- **Stored hashes.** `password_hash` is a hidden field: no crew or Conductor response carries it, and
  neither do realtime events. PocketBase still shows hidden fields to superusers, the on-box admin
  who already holds the whole database. It lives only while a request is open. Backups carry it, as
  they carry `users.password`.
- **Reset.** Expires in 30 minutes, kept in the fragment, single-use even under concurrency (the fresh
  token-key check in §3.2), and it ends other sessions.
- **The Conductor.** The same rules apply. OPERATIONS.md tells the Conductor to use a long, unique
  password, and adds "Forgot password?" to Conductor recovery while mail works.

## 5. Unchanged

Rehearsal stacks (`SIM=1`): `/api/crawl/login`, the name + password form and every test helper that
mints sessions by impersonation (`loginToken`, `sessionFor`). Email code sign-in, Google, boarding
caps, decoys, Conductor batching, put-off and let-back-on, and the Manifest.

## 6. Testing

Tests first, per task. Each task ends with the full gate: `cd web && npm test && npm run check &&
npm run test:e2e`, then `bash scripts/test-hooks.sh`.

- **Unit:** `passwordProblem` (7, 8, 64 and 65 code points; four emoji, which is 8 UTF-16 units but
  4 code points and must be refused; 72 and 73 UTF-8 bytes; non-string);
  `resetTokenEmail` (a valid payload, garbage, no claim); `PasswordInput` toggles the type and `aria-pressed`.
- **Migration test:** up applies every setting in §3.1, including the three rate-limit rules. Down
  restores the previous settings and keeps an `access_log` row with method `password`. The hook
  harness runs with `PB_RATE_LIMITS=off` (scripts/pb-test-server.mjs), so the per-IP rules are
  checked as installed settings, not exercised live.
- **Existing test to change:** web/tests/hooks/access.test.ts, "every sign-in method is guarded".
  It now expects `method = "password"`. Its `finally` stops switching password auth off and restores
  whatever setting it found, because password auth is on by default now.
- **Hook tests:**
  - Password sign-in for a user with a set password: 200, and `signed_in` logged with method `password`.
  - A wrong password and an unknown address give the same 400 body.
  - The 11th try on one address within 15 minutes gets 429 (the per-address limit in `_crawl_limits`
    is ours, so it applies even with `PB_RATE_LIMITS=off`). A blocked user gets 403.
  - Reset for a member sends a mail whose link is `<APP_URL>/reset-password#<token>`.
  - An unknown address and a blocked member each get an identical empty 204 and no mail.
  - Confirm sets the password, and the new password signs in.
  - Confirm: an old session token is refused by `/api/crawl/me`, and a second confirmation with the
    same reset token gets 400.
  - A reset token issued before a put-off gets 400. The put-off rotated the key, so PocketBase refuses
    it before the hook runs.
  - A crew name change after a reset leaves the new password working and the old one refused.
  - Races, fired together like the existing double-decision test. These cannot force an interleaving,
    but every run gives each one a real chance:
    - two confirmations with one link: exactly one 204;
    - put-off sent together with a confirmation: the seat ends blocked and the old session is dead;
    - a rename sent together with a confirmation: whichever password the confirmation set still
      signs in.
  - Reset confirmation goes through PocketBase's own field validation. Four emoji, and 37 code points
    that make 73 bytes, are refused. Eight emoji are accepted, matching `/join`.
  - A crew member's and the Conductor's list and view of `boarding_requests` never include
    `password_hash`.
  - `/join` without a password, or with a short one, gets 400.
  - A decoy sign-up for a member stores a hash and leaves the member's password unchanged.
  - Let aboard copies the hash so the chosen password signs in, clears it on the request, and mails
    "the password you chose".
  - Let aboard for an email request with no hash (filed before the deploy) mails "this email address
    or Google".
  - Turning a request away clears its hash, and so does a mail failure at sign-up, for real requests
    and for decoys. A password of four emoji is refused at `/join`.
  - Google sign-up still works with no password.
- **Not automated, reviewed instead.**
  - A deterministic interleaving of the races. Pausing PocketBase between its load and its save would
    need a test-only hook in `pb_hooks`, and this repo forbids backdoors. The concurrent tests above
    and the serialised write transactions (the argument the existing update hook rests on) carry it.
  - The 3-per-hour reset cap. PocketBase's two-minute cooldown answers before the hook, and the tests
    cannot reach `_crawl_limits`, which is a raw table that no API exposes.
- **E2E:**
  - Sign in with email and password.
  - Forgot → read the link from the SMTP sink → set password → land signed in.
  - Board with email + password → code → a crew member lets them aboard → sign in with that password.
  - Account "Email me a link" sends the mail.
  - "Email me a code instead" still signs in.

Ports are unchanged (15173, 18093, 18090, 12525–12528). This worktree and `crew-access` cannot run the
gate at the same time.

## 7. Deploying

There are no new environment variables. The migration deletes nothing and needs no backup beyond the
usual `just backup` first. Deploy with `just up` (`docker compose up -d --build`), which rebuilds the
web image and restarts PocketBase. Existing crew have no usable password until they use
"Forgot password?" or Account's link, and code and Google keep working meanwhile.

## 8. Out of scope

Breached-password checks, two-factor, passkeys, an in-app current/new password form, and password
sign-in on rehearsal stacks beyond today's.
