# Crew access: peer-approved boarding, email and Google sign-in, hardening — design

Date: 2026-10-03 · Branch: `feat/crew-access` · Revised after the Codex adversarial review (§10)

## Why

The app is public at chugalug.app and the admin suspects strangers and bots. Today
(`pocketbase/pb_hooks/login.pb.js`):

1. **Anyone with the crew password can become the Conductor.** The hook finds the user by name and
   returns that record's token without checking `is_admin`. The crew password plus the Conductor's
   name (shown on the Crew Board as "· Conductor") therefore yields an admin session. The same gap
   lets anyone act as any relative.
2. **No per-person accounts.** One shared password, any name. Nobody can tell who is who, see who
   has access, or cut one person off.
3. **The PocketBase admin is on the internet.** The tunnel routes `pb.chugalug.app` to
   `pocketbase:8090` (`docs/OPERATIONS.md`), so `/_/` and the superuser auth endpoints are public.
4. **The login rate limit probably shares one bucket.** It keys on `e.realIP()`. No trusted-proxy
   header is configured, so behind cloudflared every visitor likely has the same IP. Bots can lock
   the family out, and logs do not show visitor IPs.
5. **Cloudflare Security Insights** (2026-10-03 export) for chugalug.app and pb.chugalug.app:
   - no Always Use HTTPS;
   - no HSTS;
   - TLS 1.0/1.1 accepted;
   - Bot Fight Mode off;
   - no MFA on the Cloudflare account that owns the tunnel.

## Decisions (agreed in brainstorming)

- **Identity is the email address.** Each person has one account keyed by a verified email. Google
  sign-in only ever reaches the account with the same email. The display name is editable and
  unique, ignoring case.
- **First access is peer approval, with no shared password.** Someone signs up with a name, then
  Google or an email confirmed by code, and waits. **Any approved crew member** can let them aboard.
  The approver is recorded.
- **After boarding, sign-in is by email code or Google.** No passwords for the crew.
- **Crew with the app open get a popup** for each waiting request. **Conductors get an email**,
  because the crew rarely has the app open.
- **The Conductor account is minted from the environment:** `CONDUCTOR_EMAIL=garamizor@pm.me` in
  `.env`, not committed. `CREW_PASSWORD` and `ADMIN_PASSWORD` are retired in production. Making
  another Conductor is done in the PocketBase admin on the box.
- **Existing users are wiped.** Routes and stops are reassigned to the Conductor. All personal
  activity and its traces are deleted:
  - votes, approval votes, comments (route notes included);
  - check-ins, Bulletins and their acks;
  - Tab entries, Freight, chat messages, reactions;
  - the whole `event_log` (Train Sheet), which copies Bulletin bodies.
- **Only Conductors can block or unblock people.**
- Mail goes out through **Resend** over SMTP. **Cloudflare Turnstile** guards email sign-up.
- Out of scope:
  - the admin's other Cloudflare domains;
  - public but unguessable file URLs;
  - changing your own email address (the Conductor does it in the PocketBase admin).

## UI glossary additions

| Developer term | UI label | Notes |
|---|---|---|
| Sign-up page `/join` | **Board** | "Board the Chug-a-Lug" |
| Join request | **Boarding request** | Shown as "waiting to board" |
| Approve / reject a request | **Let aboard / Turn away** | Any approved crew member |
| Conductor access panel `/crew/access` | **Manifest** | People, status, who let them aboard, last seen, access log |
| Block / unblock a person | **Put off / Let back on** | Conductor only |
| Account page `/account` | **Your ticket** | Name edit, email, sign out |

`README.md`'s glossary gets these rows. Every string lives in `web/src/lib/labels.ts`.

## 1. Data model

New migration `1758900000_crew_access.js`, plus the shared module `pocketbase/pb_hooks/crew.js`.
The migration loads that module with `require(`${__hooks}/crew.js`)` when `__hooks` is bound in
migrations. If it is not, the plan's first task finds out and the logic moves into a migration-local
copy that is unit-tested against the module.

### `users` (changed)

- `email`: required, applied in step 6 of the data migration, after the legacy users are gone.
  PocketBase keeps auth emails unique. `emailVisibility` stays false, so only the owner,
  superusers and the Manifest endpoint see addresses.
- `name`, `name_key`: keep the current validation (`names.js`) and the unique index.
- `is_admin`: kept.
- New `blocked` (bool), `approved_by` (relation → users, optional) and `last_seen` (date).
- Auth options:
  - `passwordAuth.enabled = false` (unchanged);
  - `otp.enabled = true`, 6 digits, 600 s;
  - `oauth2.enabled` is set at serve time (§4);
  - `authToken.duration = 2592000` (30 days).
- `updateRule`:
  `id = @request.auth.id && @request.body.email:isset = false && @request.body.is_admin:isset = false
  && @request.body.blocked:isset = false && @request.body.approved_by:isset = false
  && @request.body.name_key:isset = false && @request.body.verified:isset = false
  && @request.body.password:isset = false && @request.body.last_seen:isset = false`.
  Only `name` can change; a hook (§2.11) recomputes `name_key`.
- `listRule`/`viewRule` unchanged (`@request.auth.id != ''`).

### `boarding_requests` (new)

**Fields:**

| Field | Type | Notes |
|---|---|---|
| `name`, `name_key` | text | Same validation as users |
| `email` | email | Lowercased |
| `method` | select | `email`, `google` |
| `status` | select | `unverified`, `waiting`, `aboard`, `turned_away`, `expired` |
| `decoy` | bool, hidden | §2.1 |
| `secret_hash` | text, hidden | SHA-256 of the requester's poll secret |
| `code_hash` | text, hidden | SHA-256 of the email code; cleared once used |
| `code_attempts` | number | |
| `code_sent_at` | date | |
| `ip`, `country`, `city`, `user_agent` | text | |
| `decided_by` | relation → users | |
| `decided_at` | date | |
| `notified_at` | date | Set only after the Conductor email is sent |
| `user` | relation → users | Set on approval |
| `created`, `updated` | autodate | |

**Rules:**
- `listRule`/`viewRule`:
  `@request.auth.id != '' && decoy = false && (status = 'waiting' || @request.auth.is_admin = true)`.
- Create, update and delete: `null`. Only hooks write.

**Allowed transitions** (anything else is refused):
- `unverified → waiting`: verify, and only while unverified.
- `waiting → aboard | turned_away`: a decision.
- `unverified | waiting → expired`: the cron.

Decoys never leave `unverified` except to `expired`.

### `access_log` (new)

**Fields:**
- `event` (select): `boarding_requested`, `boarding_verified`, `let_aboard`, `turned_away`,
  `signed_in`, `sign_in_refused`, `code_sent`, `mail_failed`, `rate_limited`, `turnstile_failed`,
  `put_off`, `let_back_on`, `name_changed`.
- `method` (select): `email`, `google`, `rehearsal`, empty.
- `name`, `email`.
- `user`, `actor`: relations → users.
- `request`: relation → `boarding_requests`.
- `ip`, `country`, `city`, `user_agent`, `detail`.
- `created`.

**Rules:** `listRule`/`viewRule` `@request.auth.is_admin = true`. Writes are hook-only.

**Bounded volume.** Denial events (`rate_limited`, `turnstile_failed`, `sign_in_refused`) are
written at most once per IP per event per 15 min, gated by
`limits.consume('log:'+event+':'+ip, 1, 900)`. Repeats in that window are dropped. The daily
cron, `cronAdd('crew_access_daily', '17 3 * * *', …)`:
- deletes rows older than 90 days;
- trims the table to its newest 10,000 rows.

### Expiry

A 5-minute `cronAdd('boarding_sweep', '*/5 * * * *', …)` job:
- sets `unverified` requests older than 30 min to `expired`;
- sets `waiting` requests older than 72 h to `expired`;
- sends any pending Conductor notification (§2.6).

### Settings (migration)

- `trustedProxy.headers = ['CF-Connecting-IP']`, `useLeftmostIP = false`. PocketBase trusts the
  header without authenticating its sender. That is safe only because PocketBase is reachable
  solely through the tunnel, which sets the header, and on the Docker network and 127.0.0.1
  (`compose.yml`). Requests without the header (the web container, local, tests) fall back to the
  socket address. `OPERATIONS.md` records that nothing else may ever publish port 8090.
- `rateLimits.enabled = true`. **PocketBase's default rules are kept**, including the generic
  `/api/` rule that covers the custom `/api/crawl/*` routes. These are added:
  - `users:requestOTP`: 5 per 600 s;
  - `users:authWithOTP`: 10 per 600 s;
  - `users:authWithOAuth2`: 10 per 600 s.

  Collection-action labels apply whether the URL names the collection or uses its ID.
- `auth-refresh` gets no extra rule. `requireUser` (`web/src/lib/server/pb.ts`) refreshes from the
  web container, so those calls share the container's IP under the default `/api/` rule. Its
  5-minute token cache keeps that well inside the limit for ~10 people.

### Data migration (destructive; ordered so every save validates)

1. Add the new fields and collections, but **do not yet** make `email` required.
2. Read `CONDUCTOR_EMAIL`. If it is empty, throw: PocketBase fails to start before any data is
   touched.
3. `crew.ensureConductor(app, email)`, the single idempotent path also used at serve time:
   - Find the user with that email (case-insensitive). If there is one, set `is_admin`,
     `verified`, `blocked = false` and save.
   - Otherwise create one with that email, `verified`, `is_admin`, a random unusable password,
     and the first free name in "Conductor", "Conductor 2", "Conductor 3"… Each candidate is
     checked against `name_key`, and all are valid under the existing pattern.
4. Reassign every `itineraries.created_by` to the Conductor.
5. Delete every row of `event_log` and `broadcasts`. `broadcasts.created_by` is required and not
   cascading, so these rows would otherwise block step 6. Then delete every user except the
   Conductor with `app.delete(record)`. PocketBase cascades `votes`, `comments`,
   `approval_votes`, `checkins`, `broadcast_acks`, `drink_entries`, `media`, `chat_messages` and
   `reactions`, all of which have `cascadeDelete: true`.
6. Make `email` required, apply the auth options and rules above, and rename the Conductor to
   "Conductor" if it took a suffix and that name is now free.
7. `crawl_settings`, `places`, `place_lookups`, `stop_photos`, `legs` and `stops` are untouched.

The down migration restores the schema but cannot restore data. `OPERATIONS.md` requires
`just backup` before deploying this. **Existing rehearsal runs** (`.simulations/<run>`) are wiped
too the next time they start. `OPERATIONS.md` says to delete and recreate them after upgrading.

## 2. Hooks: boarding (`pocketbase/pb_hooks/boarding.pb.js` + `crew.js`)

Shared helpers in `crew.js`:
- `clientInfo(e)` returns ip (`e.realIP()`), country (`CF-IPCountry`), city (`CF-IPCity`, when the
  Managed Transform is on) and user agent, truncated.
- `hash(s)`.
- `logEvent(app, fields)`, with the denial throttle.
- `sendMail(app, {to, subject, html, text})`, which uses `$app.newMailClient()` and
  `settings.meta.senderAddress`, and throws on failure.
- `ensureConductor`.
- `oauthDecision` (§2.5).

### 2.1 `POST /api/crawl/join` (guest)

**Body:** `{name, email, turnstile}`.

**Checks, in order:**
1. Per-IP limit: 5 per hour (`limits.consume('join:'+ip, 5, 3600)`), else 429.
2. Turnstile siteverify against `TURNSTILE_VERIFY_URL`, default
   `https://challenges.cloudflare.com/turnstile/v0/siteverify`, with `TURNSTILE_SECRET` and the IP.
   - Failure → 400 "Couldn't confirm you're human. Try again."
   - A missing secret → 503.
3. `normalizeName`. An invalid name → 400.
4. Email: syntax-checked and lowercased.
5. Caps:
   - **unverified**: at most 2 per IP and 10 in total;
   - **waiting**: at most 3 per IP and 20 in total;
   - otherwise 429 "Too many people are waiting to board. Try again later."

   Unverified requests expire after 30 min, so a flood that never verifies holds slots only
   briefly and cannot fill the waiting queue.
6. Name taken (a user, or a non-decoy open request with that `name_key`) → 409 "That name is taken.
   Add an initial?" The check depends only on the name, never on the email, so it reveals nothing
   about who is a member.

**Then, in one transaction:**
- **A decoy request** is created when the email already belongs to a user, or to a request that is
  `waiting`.
  - The row is real, with `decoy = true`, `status = unverified`, random hashes and no usable code.
  - The address gets "You already have a seat — sign in at {APP_URL}/login" or "Your request is
    already waiting".
  - From outside, a decoy behaves exactly like a real unverified request: same response, `status`
    reads `unverified`, verify answers "wrong code" until the attempts run out, then 410, and it
    expires at 30 min. Nothing distinguishes it without the mailbox.
- **An existing unverified, non-decoy request for this email** is updated in place: name, secret
  and code rotate, and the attempts reset.
- **Otherwise** a new request with `status = unverified`.
- Generate a 32-byte `secret` and a 6-digit `code`, and store their hashes.

**After the commit:**
- Send the code email ("Your Chug-a-Lug boarding code: 123456").
- If sending fails, mark the request `expired`, log `mail_failed`, and respond 502 "Couldn't send
  the code. Try Google or try later." Decoys follow the same path, so mail failures are not an
  oracle.
- Otherwise log `boarding_requested` and respond 200 `{request_id, secret}`.

### 2.2 `POST /api/crawl/join/verify` (guest)

**Body:** `{request_id, secret, code}`, handled in one transaction:
- Secret mismatch or unknown request → 404.
- `status != unverified`, or attempts ≥ 5, or the code older than 15 min → 410 "That code expired.
  Start again."
- Increment `code_attempts` first. A wrong code (always the case for a decoy) → 400.
- Right code:
  - clear `code_hash` (the proof is consumed);
  - set `status = waiting`;
  - log `boarding_verified`.

  After the commit, `notifyConductors` runs. Its failure never changes this response.

### 2.3 `POST /api/crawl/join/status` (guest)

**Body:** `{request_id, secret}` → `{status}`. A secret mismatch returns 404. It is covered by
PocketBase's default `/api/` limit; the client polls every 5 s and stops after 72 h.

### 2.4 `POST /api/crawl/join/resend` (guest)

**Body:** `{request_id, secret}`. At most one per 60 s per request, and only while `unverified`.
Rotates the code and resets the attempts. Decoys "resend" their notice email.

### 2.5 Google: `onRecordAuthWithOAuth2Request` for `users`

PocketBase resolves the record in this order: an existing external-auth link, then the
**authenticated caller**, then an email match. Then it calls this hook before creating anything
(`apis/record_auth_with_oauth2.go`, v0.40.4).

The hook applies a pure policy:
`crew.oauthDecision({isNewRecord, hasName, blocked, recordEmail, oauthEmail, oauthEmailVerified})`.

| Situation | Decision |
|---|---|
| Google email not verified | `refuse_unverified`: 403 |
| New record with a name (join page) | `request` |
| New record without a name (login page) | `refuse_new`: 403 "No seat for this Google account yet. Board first." |
| Existing record that is blocked | `refuse_blocked`: 403 |
| Existing record whose email ≠ the Google email (case-insensitive) | `refuse_mismatch`: 403 "This Google account's email doesn't match your seat. Use an email code." |
| Existing record with a matching email | `continue` |

- `refuse_mismatch` covers a crew token plus a different Google identity, and an old link whose
  Google email has since changed. A Google identity can therefore never attach to an account with
  a different email.
- **On `request`:** run the §2.1 rate limit, caps and name checks; Turnstile is skipped because
  Google is the human check. Upsert a request with `method = google`, the Google email and
  `status = waiting`, unless that email is a member or already waiting, in which case it gets the
  decoy treatment with the matching notice email. Then return `e.json(202, {pending: true,
  request_id, secret})` without calling `e.next()`. Codex verified from source that this hook runs
  before the record or link is created, and that skipping `e.next()` creates neither. The plan's
  first task confirms it at runtime.
- **On `continue`:** `e.next()`. The sign-in guard (§2.8) then runs.
- The Google pages also clear the client's auth store before starting, so a normal flow never
  carries a token.

### 2.6 Notifying Conductors

`notifyConductors(app)`:
- Recipients: every user with `is_admin`, `verified`, not blocked.
- Sends one email listing all non-decoy `waiting` requests whose `notified_at` is empty: name,
  email, device, country and time, with a link to `{APP_URL}/crew`. The email holds no approve or
  reject links, because mail scanners follow links.
- `notified_at` is stamped **only after the send succeeds**. A failure logs `mail_failed`, and the
  5-minute sweep retries.
- At most one email per 10 min (`limits.consume('notify', 1, 600)`). Requests that arrive in
  between go out in the next sweep's batch.

### 2.7 Deciding: `POST /api/crawl/boarding/{id}/let-aboard` and `/turn-away` (auth)

- Requires an authenticated, non-blocked user. The request must be non-decoy and `waiting`,
  checked inside the transaction. Otherwise 409 "Someone already answered this one".
- **Let aboard** (transaction):
  - re-check that the name and email are free;
  - create the user (email, `verified`, name, `approved_by = auth`, random unusable password);
  - set the request to `aboard`, with `user`, `decided_by` and `decided_at`;
  - log `let_aboard`.
  - Then, after the commit, email "You're aboard. Sign in at {APP_URL}/login." A send failure logs
    `mail_failed` and the response is still 200, because the requester's waiting page shows Sign in
    anyway.
- **Turn away:** status `turned_away`, `decided_by`, and `turned_away` logged. No email.

### 2.8 Sign-in guard

`crew.signInGuard(e, record, method)` is shared by every way a session is issued:
- a `blocked` user → 403 "Your seat was taken away. Ask the Conductor." and `sign_in_refused`
  logged;
- otherwise set `last_seen`, save, and log `signed_in` with the method.

Where it runs:
- **`onRecordAuthRequest` for `users`:** run the guard only when `e.authMethod` is `otp` (logged as
  `email`) or `oauth2` (logged as `google`). An empty `authMethod` means a refresh, which also fires
  this hook, so it is skipped here. Then `e.next()`.
- **`onRecordAuthRefreshRequest`:** a `blocked` user → 403. Otherwise update `last_seen` at most
  once per 10 min. No log row. Then `e.next()`.
- **The rehearsal route (§2.12)** issues sessions with `$apis.recordAuthResponse(e, record,
  'rehearsal', null)`, which fires `onRecordAuthRequest`. The guard maps `rehearsal` too.
- **`onMailerRecordOTPSend` for `users`:** set the subject and body from the template in §4, call
  `e.next()`, then log `code_sent` only if it returned without throwing. PocketBase sends the OTP
  email asynchronously after returning the OTP id, so a failure here is never visible to the
  requester. The login page always shows "No code after a minute? Send it again, or use Google."

### 2.9 Blocking: `POST /api/crawl/users/{id}/put-off` and `/let-back-on` (Conductor)

- Requires `is_admin`. A Conductor cannot put themselves off.
- **Put off:**
  - `blocked = true`, then `record.refreshTokenKey()` and **`app.save(record)`**; saving
    invalidates every token and drops the user's realtime auth;
  - `put_off` logged.
- **Let back on:** `blocked = false` and `let_back_on` logged.
- `requireUser`'s 5-minute cache means the SvelteKit endpoints may accept a blocked user's
  pre-block token for up to 5 more minutes. PocketBase itself rejects it at once. Accepted and
  documented.

### 2.10 The manifest: `GET /api/crawl/manifest` (Conductor)

- Users (including email, `blocked`, the `approved_by` name, `last_seen`, created).
- The last 50 non-decoy boarding requests.
- The last 200 `access_log` rows.

It exists because the records API hides `email` from non-owners. Decoys are visible only in the
log rows.

### 2.11 Name change

`onRecordUpdateRequest` for `users`:
- When `name` changes: run `normalizeName`, set `name_key`, call `e.next()`, and log
  `name_changed`.
- An invalid name → 400. A unique-index clash → 409 "That name is taken."

### 2.12 The rehearsal login route

`/api/crawl/login` exists **only when `SIM=1`**, for the isolated rehearsal launcher, because
rehearsal stacks have no mail. With `SIM != 1` it returns 404.

Today's behaviour stays, with these changes:
- A name whose user has `is_admin` needs `ADMIN_PASSWORD`, so the takeover is fixed here too.
- New users get the email `<name_key slug>@rehearsal.invalid`.
- The session is issued through `$apis.recordAuthResponse`, so the §2.8 guard runs.

## 3. Hooks: hardening (`pocketbase/pb_hooks/edge.pb.js`)

The `routerUse` middleware acts on requests that carry a `CF-Connecting-IP` header, i.e. those
that came through the tunnel:
- return 404 when the path is `/_` or starts with `/_/`;
- return 404 when the path matches `/api/collections/{x}/…` and `x` resolves, via
  `$app.findCollectionByNameOrId(x)`, to the `_superusers` collection. That covers both the
  collection's name and its ID.

Everything else goes to `e.next()`.

The web server's superuser calls go over the Docker network without that header and keep working,
as does `http://127.0.0.1:8090/_/` on the box.

## 4. Serve-time configuration (`pocketbase/pb_hooks/config.pb.js`)

`onServe` runs after the application migrations, and not during `pocketbase superuser upsert`.
It calls `e.next()` and then applies the environment, saving only what changed:
- `meta.appURL = APP_URL` (`https://chugalug.app`).
- `meta.senderName = "Chug-a-Lug"`, `meta.senderAddress = MAIL_FROM`.
- `smtp`: `{enabled: !!SMTP_HOST, host, port, username, password, tls}` from `SMTP_*`.
- The OTP email template for `users`: subject "Your Chug-a-Lug code", body containing `{OTP}`.
- `users.oauth2`: enabled with the Google provider when `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET` are both set, otherwise disabled.
- `crew.ensureConductor(app, CONDUCTOR_EMAIL)`, the same function the migration uses. This covers
  a changed `CONDUCTOR_EMAIL`; the previous Conductor stays a Conductor until removed in the admin.

These values end up in PocketBase's settings table, inside `pb_data` and its backups. That is the
same exposure as the `.env` secrets already present in the container environment.

## 5. Web client

### `/join` (Board)

1. The name field, then either:
   - **Continue with Google** (shown when `PUBLIC_GOOGLE_ENABLED=1`), or
   - an email field with the Turnstile widget (`PUBLIC_TURNSTILE_SITE_KEY`, explicit render) →
     `/api/crawl/join`.
2. The code step: a 6-digit field, plus **Send it again**.
3. The waiting step: "Request sent. Waiting for someone in the crew to let you aboard." It polls
   `/join/status` every 5 s while visible.
   - `aboard` → "You're aboard!" with **Sign in**.
   - `turned_away` → "The crew turned this request away."
   - `expired` → "This request expired. Board again."

`{request_id, secret, name, email}` stay in `localStorage` (`chugalug_boarding`, suffixed under
`PUBLIC_SIM`) until a final status or 72 h.

### Google redirect flow

The SDK popup flow is unreliable in installed iOS web apps, so both pages use the manual code flow:
1. Clear the auth store. `listAuthMethods()` gives the Google `authURL`, `state` and
   `codeVerifier`.
2. Store those plus `mode` (join/login) and `name` in `sessionStorage`, then go to
   `authURL + redirect_uri`.
3. Google returns to `/auth/google`. The page checks `state`, then POSTs
   `/api/collections/users/auth-with-oauth2` with `{provider: 'google', code, codeVerifier,
   redirectURL, createData: {name}}` (`name` on join only), sent through `pb.send` with no
   Authorization header.
   - 200 → save the token.
   - 202 → the join waiting step.
   - 403 → show the message.

The redirect URI to register with Google is `{APP_URL}/auth/google`.

### `/login`

- **Continue with Google**.
- **Email me a code**: `requestOTP(email)` → a 6-digit field → `authWithOTP`.
- A link: "New here? Board."

Outside rehearsal there is no password field. When `PUBLIC_SIM=1` the page shows today's name +
password form against the rehearsal route instead.

### App layout

- On mount, while online and signed in, call `authRefresh()`. A 401/403 → `logout()` and go to
  `/login`. A network failure keeps the current token, so the offline event day works.
- **The boarding queue** is a store owned by the layout, created at sign-in and disposed at logout,
  following the clock-ownership rule in `CLAUDE.md`. It reconciles from the server rather than
  trusting events, because a request that stops being `waiting` drops out of a crew member's
  realtime rule and its removal never arrives:
  - an initial fetch of `waiting` requests;
  - a refetch on any realtime event;
  - a refetch after each Let aboard / Turn away response, 409 included;
  - a refetch every 30 s while the page is visible.

  A popup shows only while its request is in the latest fetch.
- `BoardingPopup` shows one request at a time from the queue: name, email, device, country, how
  long ago, with **Let aboard** / **Turn away** / **Later**. "Later" hides that request until the
  next app open.
- The header menu shows a dot while the queue is non-empty.

### Other pages

- **Crew Board (`/crew`):** a "Waiting to board" section above the board, fed by the same queue
  and offering the same actions.
- **Manifest (`/crew/access`, Conductor):**
  - people, with email, who let them aboard, created, last seen, status and **Put off / Let back
    on**;
  - recent boarding requests;
  - the access log, newest first, filterable by event.
- **Your ticket (`/account`):** edit your name, see your email, **Sign out**.

### Security headers

`web/src/hooks.server.ts` adds to every response:
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Content-Security-Policy: frame-ancestors 'none'`.

HSTS is set at Cloudflare.

## 6. Tests and rehearsal plumbing

**Hook test helpers (`web/tests/hooks/setup.ts`).** `loginToken(name, password)` becomes
`userToken(name, {admin})`: a superuser creates the user (`<slug>@test.invalid`, verified) and
impersonates it. The rate-limit fallback goes away.

**E2E helper (`web/tests/e2e/helpers.ts`).** `login(page, name, password)` keeps its signature:
- It mints the user and token the same way.
- It writes the auth cookie into the browser context in `CookieAuthStore`'s format, under the right
  cookie name: `pb_auth`, or `pb_auth_rehearsal` when `PUBLIC_SIM=1` (`web/src/lib/pb.ts:8`).
- It then runs today's visibility wait.
- An `ADMIN` password means `is_admin`.

**Specs that drive the password UI directly** are rewritten:
- `web/tests/e2e/login.spec.ts` becomes the new sign-in spec;
- `planning.spec.ts:20–25` and `layout.spec.ts:6–11` switch to the helper.

**Environment for every PocketBase the tests start.** That means `scripts/pb-test-server.mjs`,
`scripts/test-hooks.mjs`, the migration subprocesses in `web/tests/hooks/migrations.test.ts`, and
the browser server in `web/tests/browser-config.ts`. Each gets:
- `CONDUCTOR_EMAIL=conductor@test.invalid`;
- `APP_URL`, `MAIL_FROM`, `SMTP_HOST=127.0.0.1`, `SMTP_PORT=12525`;
- `TURNSTILE_SECRET`, with `TURNSTILE_VERIFY_URL` pointing at the fake verifier.

**Mail and Turnstile fakes.** `web/scripts/test-fakes.mjs`, under `web/` so it can resolve the
`smtp-server` devDependency:
- an SMTP sink on **12525**;
- captured messages at `http://127.0.0.1:12526/messages`, with `DELETE` to clear;
- a Turnstile verifier on **12527** that passes token `ok` and fails anything else.

The hooks runner and the e2e global setup start and stop it. **Ports 12525–12527** join the
one-test-run-at-a-time list in `CLAUDE.md`.

**Hook tests** (`web/tests/hooks/boarding.test.ts`, `access.test.ts`, `edge.test.ts`;
`login.test.ts` becomes the rehearsal-route test):
- **Join:**
  - Turnstile pass and fail;
  - per-IP limit;
  - unverified and waiting caps, per IP and in total;
  - 30-min unverified expiry via the sweep;
  - name taken.
- **Decoys:**
  - a member's email, and an email whose request is waiting, produce responses, status polls,
    verify answers and expiry identical to a new request's;
  - a decoy is invisible to the crew list rule and the manifest;
  - the right notice email is sent.
- **Codes:**
  - wrong code;
  - expired code;
  - too many attempts;
  - replaying the right code after `waiting`, `aboard` or `turned_away` → 410, with the status
    unchanged;
  - a re-signup for an email whose request is waiting does not touch it;
  - the resend throttle;
  - status polling with a wrong secret → 404.
- **Mail failure:**
  - with the sink stopped, join → 502 and the request is expired;
  - let-aboard → 200 with `mail_failed` logged;
  - a Conductor notification stays unstamped and is retried by the sweep.
- **Decisions:**
  - let aboard creates a verified user with `approved_by`;
  - a double decision → 409;
  - turn away;
  - a guest, a blocked user or a decoy target is refused;
  - list rules: a guest sees nothing, crew see only non-decoy `waiting` rows, the Conductor sees
    all non-decoys.
- **Sign-in:**
  - OTP for a member;
  - OTP for a non-member sends nothing (the sink stays empty);
  - a blocked member's OTP and refresh → 403;
  - put off invalidates an existing token;
  - only Conductors can put off;
  - no self put-off;
  - a refresh does not write a `signed_in` row.
- **Google:** `web/tests/unit/oauthDecision.test.ts` loads `crew.js`'s pure `oauthDecision` with
  `createRequire` and covers every row of the §2.5 table, including the mismatch case. A test-only
  route would be a backdoor, so there is none. Manual acceptance covers the real round trip.
- **Users:** a name change revalidates and logs; a user cannot change `email`, `is_admin`,
  `blocked`, `approved_by` or `last_seen`.
- **Conductor:** `ensureConductor` is idempotent across the migration and serve. With a legacy user
  already named "Conductor", the new account becomes "Conductor 2" and is renamed after the wipe.
  With a changed `CONDUCTOR_EMAIL`, a second Conductor is created.
- **Edge:** with a `CF-Connecting-IP` header, `/_/`,
  `/api/collections/_superusers/auth-with-password` and
  `/api/collections/<superusers id>/auth-with-password` → 404. Without the header they work.
  `/api/crawl/login` → 404 with `SIM=0`.
- **Migration** (`migrations.test.ts`): seed users (one admin named "Conductor"), routes, comments,
  route notes, drinks, a Bulletin and its `event_log` row, then apply `1758900000`.
  - Only the Conductor remains, and it is named "Conductor".
  - Routes are owned by it.
  - Every personal row and every `event_log` row is gone.
  - Places and stops are intact.
  - Without `CONDUCTOR_EMAIL` the migration throws and the data is unchanged.

**Unit tests:** the join page state machine (`$lib/boarding.ts`), the Google redirect state check,
and the boarding-queue reconciliation (removal after another approver acts, after a 409, and on
"Later").

**E2E (`web/tests/e2e/boarding.spec.ts`):**
1. A visitor boards by email.
2. Reads the code from the sink.
3. Waits.
4. The Conductor (helper login) gets the popup and lets them aboard.
5. A second crew browser's popup disappears.
6. The visitor's page shows Sign in.
7. The visitor signs in with an email code.
8. They reach Home.

A second spec covers put off → their next app open lands on `/login`.

**Rehearsal:**
- `compose.sim.yml`, `web/src/lib/server/sim/setup.ts` (credentials) and `web/tests/sim/setup.ts`
  keep `CREW_PASSWORD`/`ADMIN_PASSWORD` and add `CONDUCTOR_EMAIL=conductor@rehearsal.invalid`.
- `readCredentials` accepts the new key.
- `seedTimetable`'s empty-database guard (`web/src/lib/server/sim/seed.ts:10–12`) allows exactly
  one user, the one whose email equals `CONDUCTOR_EMAIL`, and still rejects any other data. It then
  seeds "Rehearsal Conductor" and "Rehearsal Crew" through the rehearsal route as today.
- `web/tests/unit/simSeed.test.ts` covers the allowed user and still rejects a stray one.

## 7. Docs and configuration

**`.env.example`:**
- add `CONDUCTOR_EMAIL`, `APP_URL`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`,
  `SMTP_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET`,
  `PUBLIC_TURNSTILE_SITE_KEY` and `PUBLIC_GOOGLE_ENABLED`;
- drop `CREW_PASSWORD`/`ADMIN_PASSWORD` from the production section; `.env.sim.example` keeps them;
- `compose.yml` passes the `PUBLIC_*` values as web build args, like `PUBLIC_PB_URL`.

**`README.md`:**
- the "Private" ground rule;
- the Auth section;
- Decision 6 rewritten;
- the glossary rows.

**`docs/OPERATIONS.md`:**
- "Crew access" rewritten:
  - boarding;
  - the Manifest;
  - put off;
  - adding a Conductor in the PocketBase admin;
  - mail troubleshooting;
  - Conductor recovery without mail: set a password in the admin on the box and impersonate.
- A new **Deploying crew access** section:
  1. `just backup`.
  2. Fill the new `.env` keys.
  3. `just up`, then sign in as the Conductor by email code.
  4. Tell the family to board at `/join`.
  5. Delete and recreate any rehearsal runs.
  6. Never publish port 8090 anywhere but the tunnel and Docker network, because the
     `CF-Connecting-IP` trust depends on it.
- A new **Cloudflare checklist**:
  1. MFA on the Cloudflare account.
  2. SSL/TLS → Edge Certificates: Always Use HTTPS on, HSTS on (max-age 6 months, include
     subdomains, no preload), minimum TLS 1.2.
  3. Security → Bots: Bot Fight Mode on, then confirm realtime (SSE) and uploads still work from a
     phone.
  4. WAF custom rule on `pb.chugalug.app`: block paths starting with `/_/` or
     `/api/collections/_superusers`. A second layer; the hook also covers the collection ID.
  5. Rules → Managed Transforms: "Add visitor location headers".
  6. Turnstile: a widget for chugalug.app → site key and secret.
  7. Resend: add the chugalug.app domain records in Cloudflare DNS, create an SMTP key.
  8. Google Cloud: an OAuth client (web), redirect URI `https://chugalug.app/auth/google`.
- "Rotate a secret": the new keys.

**`CLAUDE.md`:**
- the new test ports;
- the trap: "Users are keyed by email. The only production sign-in routes are OTP and Google, and
  every session passes `crew.signInGuard`. Boarding requests are not users. A decoy request must be
  indistinguishable from a real one."

## 8. Failure handling

| Failure | Behaviour |
|---|---|
| SMTP down at join | 502 and the request expired; Google sign-up still works. |
| SMTP down at OTP | The OTP id is returned but no mail arrives; PocketBase logs it. The page offers Send it again and Google. |
| SMTP down after approval or notification | The decision stands. `mail_failed` is logged and notifications retry on the sweep. |
| Conductor without mail | The PocketBase admin on the box: set a password and impersonate (`OPERATIONS.md`). |
| Turnstile unreachable | Join returns 503; Google sign-up still works. |
| Google not configured | Google buttons are hidden; the email path works. |
| `CONDUCTOR_EMAIL` missing | The migration throws and PocketBase does not start, before any data is touched. |
| Approver race | The transaction re-checks `waiting` → 409. Queues reconcile on the 409. |
| Bot floods | Per-IP join limit, Turnstile, separate unverified and waiting caps with 30-min unverified expiry, PocketBase's rate limits, throttled denial logging plus the 10,000-row cap, and Bot Fight Mode at the edge. |

## 9. Acceptance

- All suites green: `cd web && npm test && npm run check && npm run test:e2e`, plus
  `bash scripts/test-hooks.sh`.
- Manual, on the real stack after deploy:
  1. `https://pb.chugalug.app/_/` and the superusers auth endpoint, by name and by ID, return 404.
  2. Sign-in as the Conductor works by email code.
  3. A phone boards by Google.
  4. A second phone boards by email.
  5. Popup approval works from a third browser, and the popup clears on the other approver's
     screen.
  6. Put off works.
  7. The Manifest shows real visitor IPs and countries.
  8. Cloudflare Security Insights clears the chugalug.app findings after the checklist.

## 10. Review record

Codex's adversarial review (2026-10-03) raised 14 findings; all were accepted.

| # | Finding | Resolved in |
|---|---|---|
| 1 | Bootstrap provisioning ran before the application migrations | §4 (`onServe`), §1 step 3 |
| 2 | The superusers path block was bypassable by collection ID | §3 |
| 3 | Google could link a different email to an account | §2.5 |
| 4 | The auth hook fires on refresh; the custom route skipped it | §2.8 |
| 5 | The Conductor rename was invalid under the name-key schema | §1 steps 1–6 |
| 6 | The rehearsal seed guard rejects the new Conductor | §6 Rehearsal |
| 7 | Path-literal rate-limit labels; default rules ambiguous | §1 Settings |
| 8 | Fake credentials formed a membership oracle | §2.1 decoys |
| 9 | Verify had no state guard and did not consume its proof | §1 transitions, §2.2 |
| 10 | Caps did not bound floods or log growth | §2.1, §1 `access_log` |
| 11 | Realtime hides the events needed to clear popups | §5 boarding queue |
| 12 | Mail failure handling contradicted PocketBase | §2.1, §2.6–2.8, §8 |
| 13 | Missed test callers, dependency location, environment | §6 |
| 14 | `event_log` kept Bulletin bodies | Decisions, §1 step 5 |
