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
`Referer`. On load the page reads `location.hash` and strips it with `history.replaceState`.

- A **New password** field (with Show) and **Set password**. Client-side check: 8 to 64 characters.
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
- **Aboard notice** (`boarding.decide`): "Sign in at …/login with your email and the password you
  chose." for an email request, and "… with Google." for a Google request.

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
- Down: password auth off, field limits back to PocketBase's defaults, default reset template, the
  three rules removed, `password_hash` dropped, select values removed. The down migration must clear
  `access_log` rows that use the removed values, or the select change fails to save.

`config.pb.js` (onBootstrap) does not touch any of these, so nothing re-applies them on boot.

### 3.2 Hooks

**`crew.js`**

- `METHODS.password = 'password'`. Password sign-ins then pass `signInGuard` (blocked → 403,
  `last_seen`, `signed_in` logged with method `password`) through the existing `onRecordAuthRequest`.
- `exports.passwordProblem(p)` returns `null` or the message "Pick a password of 8 to 64 characters."
  It requires a string of 8 to 64 characters (JS length) and at most 72 UTF-8 bytes (bcrypt's limit).
  The client mirrors it in `$lib/password.ts`.
- `exports.hashPassword(app, p)` returns the bcrypt hash PocketBase would store. It builds a
  throwaway, unsaved `users` record, calls `setPassword(p)` and returns `getRaw('password').hash`. This
  was verified on PocketBase 0.40.4 on 2026-10-03: a 60-character `$2a$10$` hash, written to a user's
  `password` column by SQL, passes `validatePassword` for the original and fails for others.
  `setRaw('password', hash)` is rejected ("Invalid or unsupported value type"), so SQL is the only way.

**`access.pb.js`**

- `onRecordAuthWithPasswordRequest` (users): normalise `e.identity`, then
  `limits.consume('password:' + identity, 10, 900)`. When the limit is spent, log `rate_limited`
  (detail `password`) and return 429: "Too many tries for this address. Use an email code or Google,
  or try again in 15 minutes." This runs before the password is checked and keys on the typed
  identity whether or not it has a seat, so it reveals nothing about which addresses exist. Locking
  out the real person only costs them the password path; code and Google stay open.
- `onRecordRequestPasswordResetRequest` (users): `limits.consume('reset:' + email, 3, 3600)`. When
  spent, or when the record is blocked, answer 204 without `e.next()`, which is the same answer as a
  sent link, so no mail goes out and nothing is revealed. The hook must answer exactly as PocketBase's
  own success does (verify the status and body in the hook test).
- `onMailerRecordPasswordResetSend` (users): skip the send when blocked (defence in depth), otherwise
  `e.next()` and then log `password_reset_sent`.
- `onRecordConfirmPasswordResetRequest` (users): a blocked record gets 403 "Your seat was taken
  away. Ask the Conductor." Otherwise `e.next()`, then log `password_set`. PocketBase changes the
  token key with the password, which ends every other session. The hook test pins this: an old token
  is refused by `/api/crawl/me` after a reset.
- The existing `onRecordUpdateRequest` and the `updateRule` keep `password` locked for crew self-updates.

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
- `decide('away')`, and every place the sweep expires a request, clear `password_hash`. The daily job
  also blanks `password_hash` on any row whose status is not `unverified` or `waiting` (belt and braces).

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
- **Stored hashes.** `password_hash` is hidden, so no API response carries it, whoever lists requests.
  It lives only while a request is open. Backups carry it, as they carry `users.password`.
- **Reset.** Single-use, expires in 30 minutes, kept in the fragment, and it ends other sessions.
- **The Conductor.** The same rules apply. OPERATIONS.md tells the Conductor to use a long, unique
  password, and adds "Forgot password?" to Conductor recovery while mail works.

## 5. Unchanged

Rehearsal stacks (`SIM=1`): `/api/crawl/login`, the name + password form and every test helper that
mints sessions by impersonation (`loginToken`, `sessionFor`). Email code sign-in, Google, boarding
caps, decoys, Conductor batching, put-off and let-back-on, and the Manifest.

## 6. Testing

Tests first, per task. Each task ends with the full gate: `cd web && npm test && npm run check &&
npm run test:e2e`, then `bash scripts/test-hooks.sh`.

- **Unit:** `passwordProblem` (7, 8, 64 and 65 characters, 73 bytes of multi-byte text, non-string);
  `resetTokenEmail` (a valid payload, garbage, no claim); `PasswordInput` toggles the type and `aria-pressed`.
- **Migration test:** up applies every setting in §3.1. Down restores the previous ones, including
  when `access_log` holds a `password_set` row.
- **Hook tests:**
  - Password sign-in for a user with a set password: 200, and `signed_in` logged with method `password`.
  - A wrong password and an unknown address give the same 400 body.
  - The 11th try on one address within 15 minutes gets 429 (the per-address limit in `_crawl_limits`
    is ours, so it applies even with `PB_RATE_LIMITS=off`). A blocked user gets 403.
  - Reset for a member sends a mail whose link is `<APP_URL>/reset-password#<token>`.
  - Reset gives an identical 204 and sends no mail for an unknown address, a blocked member, and the
    fourth request in an hour.
  - Confirm sets the password, the new password signs in, an old token is refused, and a blocked user
    gets 403.
  - `/join` without a password, or with a short one, gets 400.
  - A decoy sign-up for a member stores a hash and leaves the member's password unchanged.
  - Let aboard copies the hash so the chosen password signs in, and clears it on the request.
  - Turning a request away clears its hash. Google sign-up still works with no password.
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
