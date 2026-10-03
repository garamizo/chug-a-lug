# Crew access: peer-approved boarding, email and Google sign-in, hardening — design

Date: 2026-10-03 · Branch: `feat/crew-access`

## Why

The app is public at chugalug.app and the admin suspects strangers and bots. Today
(`pocketbase/pb_hooks/login.pb.js`):

1. **Anyone with the crew password can become the Conductor.** The hook finds the user by name and
   returns that record's token. It never checks `is_admin`, so the crew password plus the Conductor's
   name (shown on the Crew Board as "· Conductor") yields an admin session. The same gap lets anyone
   act as any relative.
2. **No per-person accounts.** One shared password, any name. Nobody can tell who is who, see who
   has access, or cut one person off.
3. **The PocketBase admin is on the internet.** The tunnel routes `pb.chugalug.app` to
   `pocketbase:8090` (`docs/OPERATIONS.md`), so `/_/` and the superuser auth endpoints are public.
4. **The login rate limit probably shares one bucket.** It keys on `e.realIP()`. No PocketBase
   trusted-proxy header is configured in the repo, so behind cloudflared every visitor likely has the
   same IP. Bots can then lock the family out, and logs do not show visitor IPs.
5. **Cloudflare Security Insights** (2026-10-03 export) for chugalug.app and pb.chugalug.app:
   - no Always Use HTTPS;
   - no HSTS;
   - TLS 1.0/1.1 accepted;
   - Bot Fight Mode off;
   - no MFA on the Cloudflare account that owns the tunnel.

## Decisions (agreed in brainstorming)

- **Identity is the email address.** Each person has one account keyed by a verified email. Google
  sign-in matches that email. The display name is editable and unique, ignoring case.
- **First access is peer approval, with no shared password.** Someone signs up with a name, then
  Google or an email confirmed by code, and waits. **Any approved crew member** can let them aboard.
  The approver is recorded.
- **After boarding, sign-in is by email code or Google.** No passwords for the crew.
- **Crew with the app open get a popup** for each waiting request. **Conductors get an email**,
  because the crew rarely has the app open.
- **The Conductor account is minted from the environment:** `CONDUCTOR_EMAIL=garamizor@pm.me` in
  `.env`, not committed. `CREW_PASSWORD` and `ADMIN_PASSWORD` are retired in production. Making
  another Conductor is done in the PocketBase admin on the box.
- **Existing users are wiped.** Routes and stops are reassigned to the Conductor. Personal activity
  is deleted:
  - votes, approval votes, comments (route notes included);
  - check-ins, Bulletins and their acks;
  - Tab entries, Freight, chat messages, reactions.
- **Only Conductors can block or unblock people.**
- Mail goes out through **Resend** over SMTP. **Cloudflare Turnstile** guards sign-up.
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

New migration `1758900000_crew_access.js`.

### `users` (changed)

- `email`: required. PocketBase already keeps auth emails unique. `emailVisibility` stays false, so
  only the owner, superusers and the `/crew/access` endpoint see it.
- `name`, `name_key`: keep the current validation (`names.js`) and the unique index.
- `is_admin`: kept.
- New `blocked` (bool), `approved_by` (relation → users, optional) and `last_seen` (date).
- Auth options:
  - `passwordAuth.enabled = false` (unchanged);
  - `otp.enabled = true`, 6 digits, 600 s;
  - `oauth2.enabled = true`; the provider is configured at boot (§4);
  - `authToken.duration = 2592000` (30 days).
- `updateRule`: a user may change only their own `name`. A hook (§3.6) recomputes `name_key` and
  rejects invalid or taken names. `email`, `is_admin`, `blocked`, `approved_by`, `name_key`,
  `verified`, `password` and `last_seen` cannot be set through the records API.
- `listRule`/`viewRule` unchanged (`@request.auth.id != ''`).

### `boarding_requests` (new)

**Fields:**

| Field | Type | Notes |
|---|---|---|
| `name`, `name_key` | text | Same validation as users |
| `email` | email | Lowercased |
| `method` | select | `email`, `google` |
| `status` | select | `unverified`, `waiting`, `aboard`, `turned_away`, `expired` |
| `secret_hash` | text, hidden | SHA-256 of the requester's poll secret |
| `code_hash` | text, hidden | SHA-256 of the email code |
| `code_attempts` | number | |
| `code_sent_at` | date | |
| `ip`, `country`, `city`, `user_agent` | text | |
| `decided_by` | relation → users | |
| `decided_at` | date | |
| `notified_at` | date | When Conductors were emailed |
| `user` | relation → users | Set on approval |
| `created`, `updated` | autodate | |

**Rules:**
- `listRule`/`viewRule`:
  `@request.auth.id != '' && (status = 'waiting' || @request.auth.is_admin = true)`.
  Approved crew see the waiting queue; Conductors see the history.
- Create, update and delete: `null`. Only hooks write.

### `access_log` (new)

**Fields:**
- `event` (select): `boarding_requested`, `boarding_verified`, `let_aboard`, `turned_away`,
  `signed_in`, `sign_in_refused`, `code_sent`, `rate_limited`, `turnstile_failed`, `put_off`,
  `let_back_on`, `name_changed`.
- `method` (select): `email`, `google`, `rehearsal`.
- `name`: the attempted name.
- `email`.
- `user`, `actor`: relations → users.
- `request`: relation → `boarding_requests`.
- `ip`, `country`, `city`, `user_agent`, `detail`.
- `created`.

**Rules:** `listRule`/`viewRule` `@request.auth.is_admin = true`. Writes are hook-only.

A `cronAdd('access_log_prune', '17 3 * * *', …)` job deletes `access_log` rows older than 90 days.
The same job sets requests stuck in `unverified` or `waiting` for more than 72 h to `expired`.

### Settings (the same migration)

- `trustedProxy.headers = ['CF-Connecting-IP']`, `useLeftmostIP = false`. The tunnel always sets
  this header, and PocketBase is reachable only on 127.0.0.1 and the Docker network
  (`compose.yml`), so no visitor can forge it. Without the header (local and test runs) PocketBase
  falls back to the socket address.
- `rateLimits.enabled = true` with these rules:
  - `POST /api/collections/users/request-otp`: 5 per 600 s;
  - `POST /api/collections/users/auth-with-otp`: 10 per 600 s;
  - `POST /api/collections/users/auth-with-oauth2`: 10 per 600 s.
- `auth-refresh` gets **no** limit. `requireUser` (`web/src/lib/server/pb.ts`) calls it from the web
  container for every API request, so all those calls share one IP.
- The custom routes keep using `limits.js`, now keyed on the real IP.

### Data migration (destructive, in the same file)

1. Read `CONDUCTOR_EMAIL` from the environment. If it is empty, **throw**, so the migration and the
   container start fail rather than leaving an app with no Conductor.
2. Create the Conductor: email `CONDUCTOR_EMAIL`, `verified`, `is_admin`, name "Conductor"
   (renamed later on Your ticket), and a random unusable password. If a user with that name key
   already exists, rename it first to "Conductor (old)", since it is deleted in step 5.
3. Reassign `itineraries.created_by` to the Conductor for every row.
4. Delete every `broadcasts` row. `created_by` is required and not cascading, so these rows would
   otherwise block step 5.
5. Delete every other user with `app.delete(record)`. PocketBase cascades the rest:
   `votes`, `comments`, `approval_votes`, `checkins`, `broadcast_acks`, `drink_entries`, `media`,
   `chat_messages` and `reactions` all have `cascadeDelete: true`. `event_log.actor` is optional,
   so it is cleared.
6. Rows in `crawl_settings`, `places`, `place_lookups`, `stop_photos`, `legs` and `stops` stay.

The down migration restores the schema but cannot restore data. `OPERATIONS.md` requires
`just backup` before deploying this.

## 2. Hooks: boarding (`pocketbase/pb_hooks/boarding.pb.js` + `boarding.js`)

Shared helpers live in `boarding.js`:
- `clientInfo(e)` returns ip (`e.realIP()`), country (`CF-IPCountry`), city (`CF-IPCity`, when the
  Managed Transform is on) and user agent, truncated.
- `hash(s)`.
- `logEvent(app, fields)`.
- `sendMail(app, {to, subject, html, text})`, which uses `$app.newMailClient()` and
  `settings.meta.senderAddress`.

### 2.1 `POST /api/crawl/join` (guest)

**Body:** `{name, email, turnstile}`.

**Checks, in order:**
1. Per-IP limit: 5 per hour (`limits.consume('join:'+ip, 5, 3600)`), else 429 and `rate_limited`
   logged.
2. Turnstile: siteverify against `TURNSTILE_VERIFY_URL`, default
   `https://challenges.cloudflare.com/turnstile/v0/siteverify`, with `TURNSTILE_SECRET` and the IP.
   - Failure → 400 "Couldn't confirm you're human. Try again." and `turnstile_failed` logged.
   - If `TURNSTILE_SECRET` is missing → 503.
3. `normalizeName`. An invalid name → 400.
4. Email: syntax-checked and lowercased.
5. Caps:
   - at most 3 open requests (`unverified`/`waiting`) per IP;
   - at most 20 open in total;
   - otherwise 429 "Too many people are waiting to board. Try again later."
6. Name taken (a user or an open request with that `name_key`, other than this email's own open
   request) → 409 "That name is taken. Add an initial?"

**Then:**
- **The email already belongs to a user:** respond exactly as for a new request (same status and
  shape, fake `request_id`/`secret`). Send that address a "You already have a seat. Sign in at
  {APP_URL}/login" email. This avoids revealing which emails are members.
- **Otherwise:** upsert the open request for this email. A repeat sign-up from the same email
  replaces the name and rotates the secret and code.
  - Generate a 32-byte `secret` and a 6-digit `code`.
  - Store their hashes, set `status = unverified` and the client info.
  - Email the code ("Your Chug-a-Lug boarding code: 123456").
  - Log `boarding_requested`.
  - Respond 200 `{request_id, secret}`.

### 2.2 `POST /api/crawl/join/verify` (guest)

**Body:** `{request_id, secret, code}`.
- Secret mismatch or unknown request → 404.
- More than 5 code attempts, or the code older than 15 min → 410 "That code expired. Start again."
- Wrong code → 400, and `code_attempts` goes up.
- Right code: `status = waiting`, then log `boarding_verified` and notify the Conductors (§2.6).

### 2.3 `POST /api/crawl/join/status` (guest)

**Body:** `{request_id, secret}` → `{status}`. A secret mismatch returns 404. No limit beyond
PocketBase's default; the client polls every 5 s and stops after 72 h.

### 2.4 `POST /api/crawl/join/resend` (guest)

**Body:** `{request_id, secret}`. At most one per 60 s per request, while the request is
`unverified`. Sends a new code and resets the attempts.

### 2.5 Google sign-up and sign-in: `onRecordAuthWithOAuth2Request` for `users`

- **`e.isNewRecord` and `e.createData.name` present** (the join page):
  - Treat it as a sign-up: rate limit, caps and name checks as in §2.1. Turnstile is skipped
    because Google is the human check.
  - Upsert a request with `method = google`, `email = e.oAuth2User.email` (Google emails are
    verified) and `status = waiting`. Notify the Conductors.
  - Return `e.json(202, {pending: true, request_id, secret})` **without calling `e.next()`**, so
    no user record or external-auth link is created. Before building on this, the plan's first
    task proves on PocketBase 0.40.4 that this hook fires before record creation and that
    short-circuiting it creates nothing. If it does not, the fallback is a custom
    `/api/crawl/join/google` route that exchanges the code itself with `$http.send` and the
    provider settings.
- **`e.isNewRecord` without a name** (the sign-in page): 403 "No seat for this Google account yet.
  Board first." and `sign_in_refused` logged.
- **An existing record:** if it is blocked → 403 and `sign_in_refused` logged. Otherwise
  `e.next()`. PocketBase links the Google identity to the user with the matching verified email.
  Log `signed_in`.

### 2.6 Notifying Conductors

`notifyConductors(app)`:
- Recipients: every user with `is_admin`, `verified`, not blocked.
- Sends one email listing all `waiting` requests whose `notified_at` is empty: name, email,
  device, country and time, with a link to `{APP_URL}/crew`. The email holds no approve or reject
  links, because mail scanners follow links.
- Stamps `notified_at`.
- At most one email per 10 min (`limits.consume('notify', 1, 600)`). When throttled, the
  10-minute `cronAdd('boarding_notify', '*/10 * * * *', …)` sends the batch.

### 2.7 Deciding: `POST /api/crawl/boarding/{id}/let-aboard` and `/turn-away` (auth)

- Requires an authenticated, non-blocked user. The request must be `waiting`, otherwise 409
  "Someone already answered this one".
- **Let aboard**, in one transaction:
  - re-check that the name and email are free;
  - create the user (email, `verified`, name, `approved_by = auth`, random unusable password);
  - set the request to `aboard`, with `user`, `decided_by` and `decided_at`;
  - log `let_aboard`.
  - Then send "You're aboard. Sign in at {APP_URL}/login."
- **Turn away:** status `turned_away`, `decided_by`, and `turned_away` logged. No email to the
  requester.

### 2.8 Sign-in guards

- `onRecordAuthRequest` for `users`, covering OTP, OAuth2 and our routes: a `blocked` user → 403
  "Your seat was taken away. Ask the Conductor." Otherwise set `last_seen`, log `signed_in`
  (method from `e.authMethod`), then `e.next()`.
- `onRecordAuthRefreshRequest`: a `blocked` user → 403. Otherwise update `last_seen` at most once
  per 10 min, then `e.next()`.
- `onMailerRecordOTPSend` for `users`: log `code_sent` and set the subject and body from the
  template in §4.

### 2.9 Blocking: `POST /api/crawl/users/{id}/put-off` and `/let-back-on` (Conductor)

- Requires `is_admin`. A Conductor cannot put themselves off.
- **Put off:** `blocked = true`, then `record.refreshTokenKey()`, which invalidates every token of
  that user, and `put_off` logged.
- **Let back on:** `blocked = false` and `let_back_on` logged.
- `requireUser`'s 5-minute cache means the SvelteKit endpoints may accept a blocked user's
  pre-block token for up to 5 more minutes. PocketBase itself rejects it at once. Accepted.

### 2.10 The manifest: `GET /api/crawl/manifest` (Conductor)

- Users (including email, `blocked`, `approved_by` name, `last_seen`, created).
- The last 50 boarding requests.
- The last 200 `access_log` rows.

It exists because the records API hides `email` from non-owners.

### 2.11 Name change (§1 `updateRule`)

`onRecordUpdateRequest` for `users`:
- When `name` changes: run `normalizeName`, set `name_key`, and log `name_changed`.
- A unique-index clash → 409 "That name is taken."

### 2.12 The old login route

`/api/crawl/login` is kept **only when `SIM=1`**, for the isolated rehearsal launcher (§6).
- The rehearsal stack has no mail. The route keeps today's behaviour, with the takeover fixed: a
  name whose user has `is_admin` needs `ADMIN_PASSWORD`.
- New users get the email `<name_key slug>@rehearsal.invalid`.
- With `SIM != 1` the route returns 404.

## 3. Hooks: hardening (`pocketbase/pb_hooks/edge.pb.js`)

`routerUse` middleware: if the request has a `CF-Connecting-IP` header and its path is `/_`,
starts with `/_/`, or starts with `/api/collections/_superusers/`, return 404. Otherwise
`e.next()`.
- The web server's superuser calls go over the Docker network without that header and keep working.
- So does `http://127.0.0.1:8090/_/` on the box.

## 4. Boot configuration (`pocketbase/pb_hooks/config.pb.js`)

`onBootstrap`: call `e.next()`, then apply the environment to the settings and save if anything
changed:
- `meta.appURL = APP_URL` (`https://chugalug.app`).
- `meta.senderName = "Chug-a-Lug"`, `meta.senderAddress = MAIL_FROM`.
- `smtp`: `{enabled: !!SMTP_HOST, host, port, username, password, tls}` from `SMTP_*`.
- The OTP email template for `users`: subject "Your Chug-a-Lug code", body containing `{OTP}`.
- `users.oauth2.providers`: Google with `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` when both are set.
  Otherwise OAuth2 is disabled and the Google buttons are hidden (§5).
- The Conductor upsert: if `CONDUCTOR_EMAIL` has no user, create one as in §1 step 2. Ensure
  `is_admin`, `verified` and `blocked = false`.

These values are stored in PocketBase's settings table, inside `pb_data` and its backups. That is
the same exposure as today's `.env`-sourced secrets that sit in the container environment.

## 5. Web client

### `/join` (Board)

1. The name field, then either:
   - **Continue with Google** (shown when `PUBLIC_GOOGLE_ENABLED=1`), or
   - an email field with the Turnstile widget (`PUBLIC_TURNSTILE_SITE_KEY`, explicit render from
     `challenges.cloudflare.com`) → `/api/crawl/join`.
2. The code step: a 6-digit field, plus **Send it again**.
3. The waiting step: "Request sent. Waiting for someone in the crew to let you aboard." It polls
   `/join/status` every 5 s while visible.
   - `aboard` → "You're aboard!" with a **Sign in** button.
   - `turned_away` → "The crew turned this request away."

`{request_id, secret, name, email}` stay in `localStorage` (`chugalug_boarding`) for 72 h, so
reopening the page resumes the waiting step.

### Google redirect flow

The PocketBase SDK popup flow (`authWithOAuth2`) is unreliable in installed iOS web apps, so both
pages use the manual code flow:
1. `pb.collection('users').listAuthMethods()` gives the Google `authURL`, `state` and
   `codeVerifier`.
2. Store those plus `mode` (join/login) and `name` in `sessionStorage`, then go to
   `authURL + redirect_uri`.
3. Google returns to `/auth/google`. The page checks `state`, then POSTs
   `/api/collections/users/auth-with-oauth2` with `{provider: 'google', code, codeVerifier,
   redirectURL, createData: {name}}` through `pb.send`.
   - 200 → save the token.
   - 202 → the waiting step.
   - 403 → show the message.

The redirect URI to register with Google is `{APP_URL}/auth/google`.

### `/login`

- **Continue with Google**.
- **Email me a code**: `requestOTP(email)` → a 6-digit field → `authWithOTP`.
- A link: "New here? Board."

There is no password field outside rehearsal. When `PUBLIC_SIM=1`, the page instead shows today's
name + password form against the SIM-only route.

### App layout

- On mount, while online and signed in, call `authRefresh()`. A 401/403 → `logout()` and go to
  `/login`. A network failure keeps the current token (offline event day).
- Subscribe to `boarding_requests` (realtime; the list rule gives approved crew the `waiting` rows).
  Show a `BoardingPopup` for each new waiting request:
  - name, email, device and country, how long ago;
  - **Let aboard** / **Turn away** / **Later**;
  - one popup at a time, queued.
- The header menu shows a dot while any request is waiting.
- The listener is torn down on logout, following the clock-ownership rule in `CLAUDE.md`.

### Other pages

- **Crew Board (`/crew`):** a "Waiting to board" section above the board, with the same
  actions.
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

HSTS is set at Cloudflare, not here.

## 6. Tests and rehearsal plumbing

**Hook test helpers (`web/tests/hooks/setup.ts`):**
- `loginToken(name, password)` becomes `userToken(name, {admin})`: a superuser creates the user
  (`<slug>@test.invalid`, verified) and impersonates it. This removes the shared login rate-limit
  dance.
- Every existing hook test changes only through this helper.

**E2E helper (`web/tests/e2e/helpers.ts`):**
- `login(page, name, password)` keeps its signature. It mints a user and token the same way, writes
  the `pb_auth` cookie in `CookieAuthStore`'s format into the browser context, then runs today's
  visibility wait.
- `ADMIN`-password callers get `is_admin`. The 53 call sites stay unchanged.

**Mail in tests:**
- A small SMTP sink, `scripts/smtp-sink.mjs`, using the `smtp-server` package as a web
  devDependency. It runs on port **12525** and exposes the captured messages on
  `http://127.0.0.1:12526/messages`.
- `scripts/test-hooks.mjs` and the e2e global setup start it.
- The test PocketBase gets `SMTP_HOST=127.0.0.1`, `SMTP_PORT=12525`, `APP_URL`, `MAIL_FROM`,
  `CONDUCTOR_EMAIL=conductor@test.invalid` and `TURNSTILE_SECRET`, with `TURNSTILE_VERIFY_URL`
  pointing at a fake verifier on 12527 that passes token `ok` and fails anything else.
- **New fixed ports 12525–12527** join the "one test run at a time" list in `CLAUDE.md`.

**Hook tests (`web/tests/hooks/boarding.test.ts`, `access.test.ts`, `edge.test.ts`; replaces
`login.test.ts`):**
- **Join:**
  - Turnstile pass and fail;
  - per-IP limit;
  - open-request caps;
  - name taken;
  - an existing member's email gets an indistinguishable response, and the "already have a seat"
    mail;
  - code wrong, expired and too many attempts;
  - resend throttle;
  - status polling with a wrong secret → 404.
- **Decisions:**
  - let aboard creates a verified user with `approved_by`;
  - a double decision → 409;
  - turn away;
  - a guest or blocked user cannot decide;
  - list rules: a guest sees nothing, crew see only `waiting`, the Conductor sees all.
- **Sign-in:**
  - OTP for a member;
  - OTP for a non-member sends nothing (the sink stays empty);
  - a blocked member's OTP and refresh → 403;
  - put off invalidates an existing token;
  - only Conductors can put off;
  - no self put-off.
- **Google:** a real provider cannot run in tests, and a test-only route would be a backdoor. The
  hook's branching therefore lives in `boarding.js` as a pure function,
  `oauthDecision({isNewRecord, hasName, blocked})`, returning `'request' | 'refuse_new' |
  'refuse_blocked' | 'continue'`. It uses no `$app`, so `web/tests/unit/oauthDecision.test.ts`
  loads it with `createRequire`. The hook is a thin wrapper around it. Manual acceptance covers the
  real Google round trip.
- **Users:** a name change revalidates and logs; a user cannot change `email`, `is_admin` or
  `blocked`.
- **Conductor:** the boot upsert creates the `CONDUCTOR_EMAIL` user with `is_admin`.
- **Edge:**
  - `/_/` and `/api/collections/_superusers/auth-with-password` with a `CF-Connecting-IP` header
    → 404;
  - the same requests without the header work;
  - `/api/crawl/login` → 404 with `SIM=0`.
- **Migration** (`migrations.test.ts`): with seeded users, routes, comments, drinks and a
  Bulletin, applying `1758900000` leaves only the Conductor. Routes are owned by the Conductor and
  the personal rows are gone.

**Unit tests:** the join page state machine (`$lib/boarding.ts`), the Google redirect state
check, and the popup queue.

**E2E (`web/tests/e2e/boarding.spec.ts`):**
1. A visitor boards by email.
2. Reads the code from the sink.
3. Waits.
4. The Conductor (helper login) sees the popup and lets them aboard.
5. The visitor's page shows Sign in.
6. The visitor signs in with an email code.
7. They reach Home.

A second spec covers put off → their next app open lands on `/login`.

**Rehearsal:**
- `compose.sim.yml`, `web/src/lib/server/sim/setup.ts` and `web/tests/sim/setup.ts` keep
  `CREW_PASSWORD`/`ADMIN_PASSWORD` and add `CONDUCTOR_EMAIL=conductor@rehearsal.invalid`.
- `web/src/lib/server/sim/seed.ts` gives seeded users `@rehearsal.invalid` emails.

## 7. Docs and configuration

**`.env.example`:**
- add `CONDUCTOR_EMAIL`, `APP_URL`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`,
  `SMTP_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET`,
  `PUBLIC_TURNSTILE_SITE_KEY` and `PUBLIC_GOOGLE_ENABLED`;
- remove `CREW_PASSWORD`/`ADMIN_PASSWORD` from production;
- `compose.yml` passes the `PUBLIC_*` values as web build args, like `PUBLIC_PB_URL`.

**`README.md`:**
- the "Private" ground rule;
- the Auth section;
- Decision 6 rewritten: peer-approved boarding, email/Google sign-in, emails as identity;
- the glossary rows.

**`docs/OPERATIONS.md`:**
- "Crew access" rewritten:
  - boarding;
  - the Manifest;
  - put off;
  - adding a Conductor in the PocketBase admin;
  - mail troubleshooting.
- A new **Deploying crew access** section:
  1. `just backup`.
  2. Fill the new `.env` keys.
  3. `just up`, then sign in as the Conductor by email code.
  4. Tell the family to board at `/join`.
- A new **Cloudflare checklist**:
  1. MFA on the Cloudflare account.
  2. SSL/TLS → Edge Certificates: Always Use HTTPS on, HSTS on (max-age 6 months, include
     subdomains, no preload), minimum TLS 1.2.
  3. Security → Bots: Bot Fight Mode on, then confirm realtime (SSE) and uploads still work from a
     phone.
  4. WAF custom rule: `http.host eq "pb.chugalug.app" and (starts_with(http.request.uri.path,
     "/_/") or starts_with(http.request.uri.path, "/api/collections/_superusers"))` → Block.
  5. Rules → Managed Transforms: "Add visitor location headers".
  6. Turnstile: a widget for chugalug.app → site key and secret.
  7. Resend: add the chugalug.app domain records in Cloudflare DNS, create an SMTP key.
  8. Google Cloud: an OAuth client (web), redirect URI `https://chugalug.app/auth/google`.
- "Rotate a secret": the new keys.

**`CLAUDE.md`:**
- the new test ports;
- the trap: "Users are keyed by email; the only sign-in routes are OTP and Google; boarding requests
  are not users."

## 8. Failure handling

| Failure | Behaviour |
|---|---|
| SMTP down or misconfigured | Join returns 502 "Couldn't send the code. Try Google or try later." and logs it. OTP request: PocketBase's own error. The Conductor's way back in is the PocketBase admin on the box (set a password temporarily or impersonate). |
| Turnstile unreachable | Join returns 503; Google sign-up still works. |
| Google not configured | Google buttons are hidden; the email path works. |
| `CONDUCTOR_EMAIL` missing | The migration throws and PocketBase does not start: a loud failure before any data is touched. |
| Approver and requester race | The status check inside the transaction → 409 for the second decision. |
| Bot floods | Per-IP join limit, Turnstile, open-request caps, and log rows bounded by those caps and 90-day pruning. Bot Fight Mode at the edge. |

## 9. Acceptance

- All suites green: `cd web && npm test && npm run check && npm run test:e2e`, plus
  `bash scripts/test-hooks.sh`.
- Manual, on the real stack after deploy:
  1. `https://pb.chugalug.app/_/` is a 404.
  2. Sign-in as the Conductor works by email code.
  3. A phone boards by Google.
  4. A second phone boards by email.
  5. Popup approval works from a third browser.
  6. Put off works.
  7. The Manifest shows real visitor IPs and countries.
  8. Cloudflare Security Insights clears the chugalug.app findings after the checklist.
