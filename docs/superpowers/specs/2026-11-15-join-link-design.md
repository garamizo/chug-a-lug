# Join link: one limited link instead of peer boarding

Date: 2026-11-15 · Branch: `feat/join-link` · Replaces parts of
[crew access](2026-10-03-crew-access-design.md), [password sign-in](2026-10-03-password-sign-in-design.md)
and [auth UI](2026-10-04-auth-ui-design.md).

## 1. Intent

Getting into the app is too elaborate for ten relatives. Today a newcomer files a boarding request at
`/join` (Turnstile, email code, or Google), it waits in a queue with caps, decoys and Conductor
notification mails, and any crew member has to Let them aboard. Sign-in offers three methods.

The Conductor wants instead:

- **One join link with a limited number of seats**, made from the command line before the trip
  (`just invite`). Whoever opens it, verifies their email and picks a password has a seat at once. No
  approval step.
- **Sign-in by email and password only.** Google sign-in and the emailed sign-in code go away.
  Self-service password reset by email (Resend) stays.
- **Account management on the Conductor screen** (Manifest, `/crew/access`): see every person's name
  and email, put people off and let them back on. This already exists; it loses the request queue.

Production has one user today, the Conductor, and its data is test data (memory, 2026-11-15), so no
existing crew needs migrating.

## 2. Goals, non-goals, anti-goals

Goals
- A newcomer gets in with: link → name, email, password → emailed code → signed in.
- The Conductor makes, checks and revokes the link with `just` recipes; no UI for it.
- Remove Google OAuth, Turnstile, peer approval, the boarding queue, decoys and Conductor
  notification mails, with their env keys, test fakes, labels and docs.

Non-goals
- Self-service email change, account deletion, roles beyond Conductor/crew.
- Changing the rehearsal (`SIM=1`) name + crew-password login.
- Google **Places** (`GOOGLE_PLACES_KEY`) — unrelated, stays.

Anti-goals (a failure even if it works)
- A link that can be used beyond its seats, after expiry or after revocation, including by two people
  verifying at the same moment.
- The token readable in the database, server logs or the browser's address bar after the page loads.
- Any change to the live stack while making a link (no restart, no `.env` edit).

## 3. Approaches

| | How | Trade-off |
|---|---|---|
| **A. PocketBase command + `join_links` table (chosen)** | `just invite 12` runs a console command registered in `pb_hooks`, inside the running container, which stores a hashed token with seats and expiry. Sign-up consumes a seat in the transaction that creates the user. | A new collection and a console command; nothing restarts, seats are exact under concurrency, history is in the database. |
| B. Token in `.env` | `just invite` writes `JOIN_TOKEN`/`JOIN_SEATS` to `.env` and restarts PocketBase; seats counted from users. | No table, but restarts the live stack, keeps the token in plain text, and revoking is edit + restart. |
| C. Per-person invites (status quo shape) | Crew invite each other. | What the Conductor is asking to drop. |

The Conductor picked A. For recovery, running our own mail server was rejected (home IPs land in spam
or are blocked); Conductor-issued reset links were offered and declined in favour of keeping Resend.

## 4. Design

### 4.1 The link

**Collection `join_links`** (base; every API rule `null`, so only hooks and superusers touch it):

| field | type | notes |
|---|---|---|
| `token_hash` | text, hidden, required, unique index | `crew.hash(token)` (sha256) |
| `seats` | number, min 1, max 50 | as created |
| `seats_left` | number, min 0 | decremented by sign-up |
| `expires_at` | date, required | |
| `revoked_at` | date | set when replaced or revoked |

A link is **active** when `revoked_at` is empty, `expires_at` is in the future and `seats_left > 0`.
At most one row is un-revoked: making a link revokes every other one in the same transaction.

**Console command** in a new `pb_hooks/invite.pb.js`, via `$app.rootCmd.addCommand(new Command(...))`:

- `invite <seats> [--days N]` (default 14, 1–60): revokes the old link, stores a new one with token
  `$security.randomString(32)`, logs `link_created` (detail: `12 seats until 2026-11-29`), and prints
  ```
  https://<appURL>/join#<token>
  12 seats, until Sun Nov 29 9:14 PM (Chicago)
  ```
  The token is printed once and never stored in clear; losing it means making a new link.
- `invite-status`: prints `8 of 12 seats left, until …`, `expired`, `revoked` or `no link`.
- `invite-revoke`: sets `revoked_at` on the un-revoked row, logs `link_revoked`.

`appURL` comes from the app settings (`config.pb.js` sets it from `APP_URL`); the command refuses with
a clear message if it is empty.

**Recipes** (`justfile`), run against the live stack:

```
invite SEATS DAYS="14":
    docker compose exec pocketbase /pb/pocketbase invite {{SEATS}} --days {{DAYS}} --dir=/pb/pb_data --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations
invite-status:   (same, `invite-status`)
invite-revoke:   (same, `invite-revoke`)
```

The second process shares `pb_data` with the serving one (SQLite WAL), the way `superuser upsert`
already does in `compose.yml`. **Verify on PocketBase 0.40.4** that a JSVM-registered command runs
with hooks loaded and a bootstrapped app; if it cannot, fall back to a superuser-only route
(`POST /api/crawl/invite`) called by the recipe with `curl` from inside the container, keeping the
same outputs. Either way the token never appears in a command line that is logged.

### 4.2 Sign-up

**The URL carries the token in the fragment** (`/join#token`), like the reset link, so it never
reaches a server log. `/join` reads `location.hash`, immediately removes it with
`history.replaceState`, and keeps the token in `sessionStorage` for the length of the sign-up.

**Collection `signups`** (base; rules `null`), one row per pending email verification:
`email`, `name`, `name_key`, `password_hash` (hidden), `code_hash` (hidden), `code_attempts`,
`code_sent_at`, `resends`, `secret_hash` (hidden), `link` (relation → `join_links`), `ip`,
`country`, `city`, `user_agent`. A pending sign-up holds no seat and no name.

**Routes** in a new `pb_hooks/join.js` + `join.pb.js` (replacing `boarding.js` / `boarding.pb.js`).
Every guest route answers JSON `{message}` on refusal, like today.

1. `POST /api/crawl/join/link {token}` → `200 {}` if active, `410 {message: "This link is used up or
   expired. Ask the Conductor for a new one."}` otherwise (unknown, revoked, expired, full all look
   the same). Limited to 30 per IP per hour (`limits.consume`).
2. `POST /api/crawl/join {token, name, email, password}`:
   - 5 per IP per hour (existing `join:` limit); link active (else 410 as above);
   - name via `names.js` (400), free among users (409 "That name is taken. Add an initial?");
   - email via `crew.normalizeEmail` (400); **if it already has a seat: 409 "That email already has a
     seat. Sign in instead."** (only reachable with an active link, so no decoys);
   - password via `crew.passwordProblem` (400);
   - at most 10 open sign-ups in total (429), so a leaked link cannot become a mail cannon;
   - in one transaction: delete any open sign-up for the same email, insert a new row with
     `password_hash = crew.hashPassword(...)` and a 6-digit code; then send the code mail (existing
     `codeMail` text). On mail failure delete the row and answer 502 "Couldn't send the email. Try
     later."
   - `200 {signup_id, secret}`; logs `code_sent`.
3. `POST /api/crawl/join/verify {signup_id, secret, code}` — one transaction, reread fresh:
   - secret mismatch / missing → 404; > 5 wrong codes or > 15 min since the code → 410 "That code
     expired. Start again."; wrong code → 400 and `code_attempts + 1`;
   - link (the row's `link`) no longer active → 410 link message, row deleted;
   - name or email now taken → 409, row deleted;
   - otherwise create the user (`name`, `name_key`, email, `verified = true`, password installed from
     `password_hash` by SQL exactly as `decide` does today), `seats_left - 1`, delete the row.
   - After commit: log `joined` (`name`, `email`, `user`, `detail: link id`), then answer with
     `$apis.recordAuthResponse(e, user, 'password', null)` so the newcomer is signed in. This passes
     `signInGuard` (logs `signed_in`, sets `last_seen`) like any password sign-in.
4. `POST /api/crawl/join/resend {signup_id, secret}` — today's rules: once a minute, 3 per sign-up,
   3 per address per hour (`join-resend:` budget), 410 if the row is gone.

**Cron** `join_sweep` every 5 minutes deletes sign-ups older than 30 minutes. The existing daily
`access_log` pruning moves from `boarding.js` to `access.js` unchanged.

### 4.3 Sign-in and recovery

- `/login`: email + password, "Forgot password?" (unchanged flow, Resend), and below it the line
  "Need a seat? Ask the Conductor for a join link." instead of the Sign up link. No code mode, no
  Google button. Rehearsal mode unchanged.
- The password rate-limit message drops "Use an email code or Google": "Too many tries for this
  address. Reset your password or try again in 15 minutes."
- `/login/forgot` and `/reset-password` unchanged.

### 4.4 Conductor screen (Manifest, `/crew/access`)

Keeps: every person (name, email, Conductor badge, status, since, last seen), Put off / Let back on,
the access log with its filter. Drops: the "Recent requests" section and the "Let aboard by" line
(`approved_by` is removed). The link itself is managed only from `just` (Conductor's call); the access
log shows `link_created`, `link_revoked` and `joined` rows.

### 4.5 What is removed

Server: `boarding.js`, `boarding.pb.js` (join/verify/status/resend/cancel, let-aboard/turn-away,
Google request hook, boarding sweep), `crew.oauthDecision`, the OTP mail hook in `access.pb.js`,
Google provider setup in `config.pb.js`, `otp`/`oauth2` entries in `crew.METHODS` (old log rows still
render through `signInMethodLabels`), `notifyConductors` and `NOTIFY_INTERVAL_SECONDS`.

Client: `routes/auth/google`, `lib/google.ts`, `lib/googleStart.ts`, `SignInButton.svelte` (if only
Google uses it), `Turnstile.svelte`, `BoardingPopup.svelte`, `WaitingList.svelte`,
`live/boardingQueue.svelte.ts` and their uses in `routes/+layout.svelte`, `(app)/+layout.svelte` and
`(app)/crew/+page.svelte`; `lib/boarding.ts` (replaced by the sign-up's own storage); the boarding,
Google and code-sign-in helpers in `lib/pb.ts`; their labels. `ApprovalPanel.svelte` is route
approval votes, not boarding — **it stays**.

Config: `TURNSTILE_SECRET`, `TURNSTILE_VERIFY_URL`, `PUBLIC_TURNSTILE_SITE_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `PUBLIC_GOOGLE_ENABLED`, `NOTIFY_INTERVAL_SECONDS` from `.env.example`,
`compose.yml` and the env readers. Test fakes: the Turnstile fake and fake OIDC provider in
`web/scripts/test-fakes.mjs` (ports 12527, 12528); the SMTP sink (12525/12526) stays.

### 4.6 Migration `1759100000_join_link.js`

Self-contained, like every migration here (the migration tests run with an empty hooks directory).

Up:
- create `join_links` and `signups` as above;
- delete the `boarding_requests` collection;
- `users`: `otp.enabled = false`, `oauth2.enabled = false`, `oauth2.providers = []`, remove the
  `approved_by` field; delete every `_externalAuths` row for `users`;
- `access_log`: add `link_created`, `link_revoked`, `joined` to `event` (old values stay so history
  renders);
- settings: drop the `users:requestOTP`, `users:authWithOTP`, `users:authWithOAuth2` rate-limit rules.

Down: drop `join_links` and `signups`, recreate `boarding_requests` with its 1759000000 schema (no
rows), re-add `approved_by`, re-enable OTP, restore the three rate-limit rules. Google comes back on
the next start only if `config.pb.js` is also reverted.

### 4.7 Words and docs

- `labels.ts`: new strings for the link states and sign-up; remove boarding, Google, Turnstile, code
  sign-in and waiting-list strings. README glossary: drop **Boarding request**, **Let aboard / Turn
  away**; add **Join link** (Plain; "the one link the Conductor shares; it has seats and an end
  date"); **Sign up** reads "Name, email, password, then an emailed code; needs a join link".
- README decision 6, the Users/auth paragraphs and roadmap note; OPERATIONS: "Making the join link"
  (`just invite`, `invite-status`, `invite-revoke`, the token is shown once), removal of the Turnstile
  and Google OAuth setup sections, and a note that the Cloudflare Turnstile widget and Google OAuth
  client can be deleted in their dashboards. `CLAUDE.md`: port list (12525–12526 only) and the
  "Users are keyed by email" trap (OTP and Google gone; boarding requests gone).

### 4.8 Tests (written first, per the repo's convention)

- Hooks (`web/tests/hooks/join.test.ts`, replacing `boarding`, `decisions`, `oauth` tests): link
  states (active / expired / revoked / full all 410); sign-up refusals (name, email with a seat,
  password, caps); verify happy path signs in and decrements seats; **two verifies racing for the last
  seat: exactly one user**; link revoked or expired between code and verify; resend limits; sweep;
  `invite`, `invite-status`, `invite-revoke` run as a second process against the test server's data
  dir (one active link, token printed once, hash stored).
- Migrations test: up from the current schema (with a `boarding_requests` row and an OTP-enabled
  users collection) and down.
- Unit: drop `google`, `googleReturn`, `oauthDecision`, `boardingQueue`, `boarding`, `signInButton`
  tests that no longer have a subject; `labels.test.ts` follows.
- e2e (`join.spec.ts` replacing `boarding.spec.ts`, `authUx.spec.ts` updated): no link / dead link
  shows the ask-the-Conductor card; link → form → code from the SMTP sink → lands on Home signed in;
  the URL has no fragment after load; login has no Google or code options. Layout sweep lines for
  `/join` dead link, form and code step.
- Gate: `cd web && npm test && npm run check && npm run test:e2e`, plus `bash scripts/test-hooks.sh`.

## 5. Constraints

- PocketBase 0.40.4 JSVM; hooks and migrations are read-only bind mounts, so the deploy is `just up`
  (web image rebuild) plus a PocketBase restart for the migration.
- All user-visible strings in `labels.ts`; times rendered in America/Chicago through `$lib/time.ts`
  (the console command formats its own Chicago time).
- Stage explicit paths; never `git add -A`.

## 6. Left to the builder

- Exact copy for new strings (keep the rail flavour light; "seat" is already the house word).
- Whether `signups` reuses the crew-access request fields' names or shorter ones.
- The shape of the sign-up's client storage (survives a reload during the code step, cleared on
  success or on a dead link).
- How the hooks test launches the console command against the test server's data dir.

## 7. Calls made by Claude (for the Conductor to check)

1. A pending sign-up does not hold a seat; the seat is taken when the code is verified.
2. An email that already has a seat is told so (409) — no decoys, because only active-link holders can
   ask.
3. After verifying the code the newcomer is signed in directly; there is no separate sign-in step.
4. Default link lifetime 14 days, 1–60 allowed; seats 1–50.
5. The link's state is checked with `just invite-status`, not shown in the Manifest.
6. `approved_by` and all boarding request history are dropped (production holds only the Conductor).
