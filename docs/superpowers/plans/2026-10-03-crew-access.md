# Crew Access Implementation Plan

> **Spike results (Task 1, 2026-10-03), binding on Tasks 2–6:**
> - `onServe` is **not** bound in the PocketBase 0.40.4 JSVM (ReferenceError). `config.pb.js` uses
>   `onBootstrap((e) => { e.next(); … })` instead.
> - Bootstrap runs before application migrations, so the users-collection work in it (OAuth2
>   providers, `ensureConductor`) runs only once the schema is ready, i.e. when `users` has a
>   `blocked` field.
> - The crew-access migration also applies the Google provider from `GOOGLE_CLIENT_ID`/`_SECRET`,
>   so a first deploy has Google without a second restart.
> - Confirmed as assumed: OAuth2 providers map from plain objects; the default rate-limit labels are
>   `*:auth`, `*:create`, `/api/batch` and `/api/`; `authMethod` is `"otp"` for OTP and `""` for
>   refresh; `$apis.recordAuthResponse`, `MailerMessage`, `$app.newMailClient` and `cronAdd` exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared crew password with per-person accounts keyed by email: peer-approved
boarding, then sign-in by email code or Google. Also close the Conductor takeover and the public
PocketBase admin, and record every access attempt.

**Architecture:**
- **PocketBase hooks hold all the rules.** `crew.js` has the shared helpers and the pure policy,
  `boarding.js` the boarding flow, `access.js` the Conductor actions. Thin `*.pb.js` files register
  the routes, hooks, crons and middleware.
- **One destructive migration** (`1758900000_crew_access.js`):
  - adds the schema and settings;
  - mints the Conductor from `CONDUCTOR_EMAIL`;
  - reassigns routes to the Conductor and wipes everyone else.
- **The SvelteKit client** gets new `/join`, `/login`, `/auth/google`, `/account` and
  `/crew/access` pages, plus a layout-owned boarding queue that drives popups.
- **Tests** run against local fakes: an SMTP sink and a Turnstile verifier.

**Tech Stack:** PocketBase 0.40.4 JSVM hooks/migrations, SvelteKit 2 + Svelte 5 runes, the
pocketbase JS SDK 0.28, Vitest 5, Playwright 1.63, plus `smtp-server` and `mailparser` (new web
devDependencies).

**Spec:** `docs/superpowers/specs/2026-10-03-crew-access-design.md`. Read it with this plan; section
numbers below (§) refer to it.

## Global Constraints

- **Worktree.** Work only in `/home/garamizo/chug-a-lug/.worktrees/crew-access` on branch
  `feat/crew-access`.
- **Staging.** Stage explicit paths. Never `git add -A` or `git add .`. Read `git status --short`
  before every commit. Never `--no-verify`.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Ports.**
  - Never touch ports 8090 or 3000, the live stack.
  - Test ports are 15173, 18093 and 18090, plus the new **12525** (SMTP sink), **12526** (sink
    control), **12527** (Turnstile fake) and **12528** (fake OIDC provider).
  - One test run at a time across all worktrees.
- **Copy.** Every user-visible client string goes in `web/src/lib/labels.ts`. Hook error messages
  stay inline, as in today's hooks.
- **Hook scoping.** A PocketBase hook callback cannot see file-scope constants. `require(...)`
  modules *inside* each callback, as `live.pb.js` does.
- **Transactions.** Never call `limits.consume` (or `logEvent` for a denial event) inside a
  `runInTransaction`, because nested write transactions deadlock SQLite.
- **No stale saves.** Never `save()` a record you loaded before an `await`, a mail send or another
  request's chance to run. Either refetch it inside `runInTransaction` and re-check its state, or
  write one column with SQL (`last_seen`). This is what keeps a put-off or a decision from being
  undone (Codex plan review #4).
- **Static test sessions.** Test sessions are impersonation tokens: long-lived and not refreshable.
  Nothing in the app may call `auth-refresh` just to check a session; use `GET /api/crawl/me`
  (Task 2).
- **Times.** UTC everywhere. A PocketBase date filter takes `'YYYY-MM-DD HH:MM:SS.sssZ'`, i.e.
  `new Date(x).toISOString().replace('T', ' ')`.
- **Production env:** `CONDUCTOR_EMAIL` (the admin's own address) goes into `.env` only, never into a
  committed file.
- **Green gate** at the end of every task: `cd web && npm test && npm run check && npm run test:e2e`,
  plus `bash scripts/test-hooks.sh`.

## Review Focus

These are inputs the spec implies but no test exercised, each pinned to a test in its owning task:

1. **Email case and whitespace.** Joining as ` Bob@Example.COM ` and later signing in with
   `bob@example.com` must reach the same account. *Task 5 step 1 (join), Task 7 step 9 (an
   upper-case email at sign-in).*
2. **Name variants at join.** `"  bob   SMITH "` when "Bob Smith" exists must answer 409, not create
   a near-duplicate. *Task 5 step 1.*
3. **Reopening `/join`** after closing the browser resumes the waiting step from storage. A
   resumed request that has since expired shows "expired", not a spinner. *Task 7 step 1 (unit) and
   step 9 (e2e).*
4. **A double tap on Let aboard** (two requests in flight) gives one success and one 409. The UI
   treats the 409 as "already answered", not as an error. *Task 6 step 1 (hook), Task 8 step 1
   (unit).*
5. **Opening the app offline** with a valid token keeps you signed in. A failed refresh over the
   network must not log you out; only a 401/403 does. *Task 8 step 1.*

---

## File Structure

**PocketBase (`pocketbase/`)**
- `pb_migrations/1758900000_crew_access.js` (new): schema, settings, Conductor, wipe.
- `pb_hooks/crew.js` (new):
  - `clientInfo`, `hash`, `normalizeEmail`, `logEvent`, `sendMail`, `ensureConductor`;
  - `oauthDecision` (pure), `signInGuard`.
- `pb_hooks/boarding.js` (new):
  - `join`, `verify`, `status`, `resend`, `fileRequest`, `googleRequest`;
  - `decide`, `notifyConductors`, `sweep`, `daily`.
- `pb_hooks/access.js` (new): `setBlocked`, `manifest`.
- `pb_hooks/boarding.pb.js` (new): boarding routes, the OAuth2 hook, crons.
- `pb_hooks/access.pb.js` (new): the sign-in guards, the OTP mail hook, the name-change hook,
  put-off/let-back-on, the manifest.
- `pb_hooks/edge.pb.js` (new): the tunnel middleware.
- `pb_hooks/config.pb.js` (new): `onServe` environment → settings, OAuth2, Conductor.
- `pb_hooks/login.pb.js` (rewrite): the rehearsal-only route.

**Scripts and harness**
- `web/scripts/test-fakes.mjs` (new): the SMTP sink, sink control and Turnstile fake.
- `scripts/pb-test-server.mjs`, `scripts/test-hooks.mjs`, `web/tests/browser-config.ts`:
  environment and fakes.
- `web/tests/hooks/setup.ts`:
  - `loginToken` becomes find-or-create + impersonate;
  - adds `postFrom`, `randomIp`, `mails`, `clearMails`, `codeFor`, `mailMode`, `runCron`.
- `web/tests/e2e/helpers.ts`: `login` mints a session cookie; adds `sessionFor`, `codeFor`,
  `clearMails`.

**Web client (`web/src/`)**
- `lib/pb.ts`: OTP, join, refresh and rehearsal helpers.
- `lib/boarding.ts` (new): the stored-request state helpers.
- `lib/google.ts` (new): the redirect flow helpers.
- `lib/live/boardingQueue.svelte.ts` (new): the queue singleton and the pure `visibleRequests`.
- `lib/components/Turnstile.svelte`, `BoardingPopup.svelte`, `WaitingList.svelte` (new).
- `routes/login/+page.svelte` (rewrite), `routes/join/+page.svelte`,
  `routes/auth/google/+page.svelte` (new).
- `routes/(app)/account/+page.svelte`, `routes/(app)/crew/access/+page.svelte` (new).
- `routes/(app)/+layout.svelte`, `routes/+layout.svelte`, `lib/components/AppMenu.svelte`,
  `routes/(app)/crew/+page.svelte`: wiring.
- `hooks.server.ts`: security headers.
- `lib/labels.ts`, `lib/types.ts`.

**Rehearsal:** `compose.sim.yml`, `web/src/lib/server/sim/seed.ts`, `web/src/lib/sim/config.ts`,
`web/scripts/sim.mjs`.

**Docs:** `README.md`, `docs/OPERATIONS.md`, `CLAUDE.md`, `.env.example`, `compose.yml`.

---

### Task 1: Test fakes, harness environment and API spike

**Files:**
- Create: `web/scripts/test-fakes.mjs`
- Modify: `web/package.json` (devDependencies), `scripts/pb-test-server.mjs`,
  `scripts/test-hooks.mjs`, `web/tests/browser-config.ts`, `web/tests/hooks/setup.ts`
- Test: `web/tests/hooks/fakes.test.ts`

**Interfaces:**
- **Produces, for hook tests (`setup.ts`):**
  - `MAIL: string`;
  - `mails(to?: string): Promise<Mail[]>`, where `Mail = {to: string[]; subject: string; text: string}`;
  - `clearMails(): Promise<void>`;
  - `mailMode(mode: 'ok' | 'fail'): Promise<void>`;
  - `codeFor(to: string): Promise<string>`, the last 6-digit code mailed to `to`;
  - `randomIp(): string`;
  - `postFrom(ip, path, body, token?)`, a POST with `CF-Connecting-IP: ip`;
  - `turnstileToken(): string`, a fresh single-use `ok-…` token;
  - `runCron(id: string): Promise<void>`, which only *schedules* the job;
  - `waitFor<T>(probe: () => Promise<T | null | undefined | false>, ms?: number): Promise<T>`, which
    polls until truthy;
  - `oidcCode(identity: {sub: string; email: string; email_verified?: boolean; name?: string}): string`,
    a code the fake OIDC provider (port 12528) turns into that identity.
- **Produces:** the test PocketBase environment `CONDUCTOR_EMAIL=conductor@test.invalid`,
  `APP_URL=http://127.0.0.1:15173`, `MAIL_FROM=crew@test.invalid`, `SMTP_HOST=127.0.0.1`,
  `SMTP_PORT=12525`, `TURNSTILE_SECRET=test-turnstile-secret`,
  `TURNSTILE_VERIFY_URL=http://127.0.0.1:12527/siteverify`, `PB_RATE_LIMITS=off`,
  `NOTIFY_INTERVAL_SECONDS=0`.

- [ ] **Step 1: Install the mail devDependencies**

Run: `cd web && npm install --save-dev smtp-server@^3 mailparser@^3`
Expected: `package.json` and `package-lock.json` gain both packages.

- [ ] **Step 2: Write the fakes**

`web/scripts/test-fakes.mjs`:

```js
// Disposable stand-ins for the harnesses only: Resend (SMTP), Cloudflare Turnstile and an OIDC
// provider that plays Google. SMTP sink :12525 · control :12526 (GET/DELETE /messages, POST /mode)
// · Turnstile :12527 (single-use tokens starting "ok") · OIDC :12528 (code = base64url identity JSON).
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { createServer } from 'node:http';

const messages = [];
let mode = 'ok';
const smtp = new SMTPServer({
  authOptional: true, disabledCommands: ['STARTTLS', 'AUTH'], logger: false,
  onRcptTo(_address, _session, callback) {
    if (mode === 'fail') return callback(Object.assign(new Error('Mailbox unavailable (test)'), { responseCode: 554 }));
    callback();
  },
  onData(stream, session, callback) {
    simpleParser(stream).then((m) => {
      messages.push({ to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()), subject: m.subject ?? '', text: m.text ?? '' });
      callback();
    }, callback);
  }
});
const readBody = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => resolve(s)); });
const control = createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/health') return send(200, { ok: true });
  if (req.url === '/messages' && req.method === 'GET') return send(200, messages);
  if (req.url === '/messages' && req.method === 'DELETE') { messages.length = 0; return send(200, {}); }
  if (req.url === '/mode' && req.method === 'POST') { mode = JSON.parse(await readBody(req)).mode; return send(200, { mode }); }
  send(404, {});
});
// Like Cloudflare, a token passes once: a client that resubmits a used token must fail.
const usedTokens = new Set();
const turnstile = createServer(async (req, res) => {
  const form = new URLSearchParams(await readBody(req));
  const token = form.get('response') ?? '';
  const success = token.startsWith('ok') && !usedTokens.has(token) && form.get('secret') === 'test-turnstile-secret';
  usedTokens.add(token);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ success }));
});
// The token endpoint hands the code back as the access token; userinfo decodes it.
const oidc = createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url?.startsWith('/token')) {
    const code = new URLSearchParams(await readBody(req)).get('code') ?? '';
    return send(200, { access_token: code, token_type: 'Bearer', expires_in: 3600 });
  }
  if (req.url?.startsWith('/userinfo')) {
    try { return send(200, JSON.parse(Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''), 'base64url').toString('utf8'))); }
    catch { return send(401, {}); }
  }
  send(404, {});
});
smtp.listen(12525, '127.0.0.1');
control.listen(12526, '127.0.0.1');
turnstile.listen(12527, '127.0.0.1');
oidc.listen(12528, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { smtp.close(); control.close(); turnstile.close(); oidc.close(); process.exit(0); });
```

- [ ] **Step 3: Pass the environment to every test PocketBase**

In `scripts/pb-test-server.mjs`, extend the `env` object of the `spawn` call. Keep the existing keys
(`CREW_PASSWORD`/`ADMIN_PASSWORD` stay for the rehearsal route) and add:

```js
    CONDUCTOR_EMAIL: 'conductor@test.invalid', APP_URL: 'http://127.0.0.1:15173', MAIL_FROM: 'crew@test.invalid',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '12525', TURNSTILE_SECRET: 'test-turnstile-secret',
    TURNSTILE_VERIFY_URL: 'http://127.0.0.1:12527/siteverify', PB_RATE_LIMITS: 'off', NOTIFY_INTERVAL_SECONDS: '0'
```

`NOTIFY_INTERVAL_SECONDS=0` turns off the 10-minute Conductor-mail throttle (Task 6) so tests are
not order-dependent. Production leaves it unset, which means 600.

- [ ] **Step 4: Start the fakes from the hooks runner**

In `scripts/test-hooks.mjs`:
- Before the `for (const sim of …)` loop, start the fakes once and wait for their health check:

```js
const fakes = spawn(process.execPath, ['web/scripts/test-fakes.mjs'], { stdio: ['ignore', 'ignore', 'inherit'] });
for (let attempt = 0; ; attempt++) {
  try { if ((await fetch('http://127.0.0.1:12526/health')).ok) break; } catch {}
  if (attempt > 50) throw new Error('Test fakes did not start');
  await setTimeout(100);
}
```

- After the loop: `fakes.kill('SIGTERM');`.
- Add `CONDUCTOR_EMAIL: 'conductor@test.invalid'` and `MAIL_SINK_URL: 'http://127.0.0.1:12526'` to
  the vitest `env`. The migration subprocesses in `migrations.test.ts` inherit it.
- Leave the SIM pass's file list alone; Task 2 adds `rehearsalLogin.test.ts` to it.

- [ ] **Step 5: Start the fakes from Playwright**

In `web/tests/browser-config.ts`:
- set `process.env.MAIL_SINK_URL = 'http://127.0.0.1:12526';` and
  `process.env.CONDUCTOR_EMAIL = 'conductor@test.invalid';`;
- prepend a web server, so the fakes are up before PocketBase:

```ts
      {
        command: 'node scripts/test-fakes.mjs',
        url: 'http://127.0.0.1:12526/health',
        reuseExistingServer: false, timeout: 10_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 }
      },
```

- add `PUBLIC_TURNSTILE_SITE_KEY: 'test-site-key', PUBLIC_GOOGLE_ENABLED: '0'` to the web dev
  server's `env`.

- [ ] **Step 6: Add the test helpers**

Append to `web/tests/hooks/setup.ts`:

```ts
export const MAIL = process.env.MAIL_SINK_URL ?? 'http://127.0.0.1:12526';
export type Mail = { to: string[]; subject: string; text: string };
export async function mails(to?: string): Promise<Mail[]> {
  const all = (await (await fetch(`${MAIL}/messages`)).json()) as Mail[];
  return to ? all.filter((m) => m.to.includes(to.toLowerCase())) : all;
}
export async function clearMails(): Promise<void> { await fetch(`${MAIL}/messages`, { method: 'DELETE' }); }
export async function mailMode(mode: 'ok' | 'fail'): Promise<void> {
  await fetch(`${MAIL}/mode`, { method: 'POST', body: JSON.stringify({ mode }) });
}
/** The last 6-digit code mailed to `to`, polling briefly because PocketBase sends OTP mail asynchronously. */
export async function codeFor(to: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const code = (await mails(to)).map((m) => /\b(\d{6})\b/.exec(m.text)?.[1]).filter(Boolean).at(-1);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No code mailed to ${to}`);
}
/** A fresh documentation-range IP, so each test owns its own rate-limit buckets. */
export const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
/** POST as if through the tunnel from `ip`; PocketBase trusts CF-Connecting-IP once Task 2's migration runs. */
export function postFrom(ip: string, path: string, body: unknown, token?: string) {
  return fetch(`${PB}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, ...(token ? { Authorization: token } : {}) },
    body: JSON.stringify(body)
  });
}
/** Schedules a registered cron job now (superuser API). It returns before the job finishes: follow with waitFor. */
export async function runCron(id: string): Promise<void> {
  const res = await fetch(`${PB}/api/crons/${id}`, { method: 'POST', headers: { Authorization: await superuserToken() } });
  if (!res.ok) throw new Error(`Cron ${id} failed: ${res.status}`);
}
/** Polls until `probe` returns something truthy, or fails after `ms`. */
export async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, ms = 5000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}
let tokens = 0;
/** A Turnstile token the fake accepts exactly once. */
export const turnstileToken = () => `ok-${process.pid}-${++tokens}-${Math.random().toString(36).slice(2)}`;
/** A code the fake OIDC provider exchanges for this identity. */
export const oidcCode = (identity: { sub: string; email: string; email_verified?: boolean; name?: string }) =>
  Buffer.from(JSON.stringify({ email_verified: true, name: 'Fake Person', ...identity })).toString('base64url');
```

- [ ] **Step 7: Write the fakes' smoke test**

`web/tests/hooks/fakes.test.ts`:

```ts
import { expect, it } from 'vitest';
import { clearMails, mails, oidcCode, turnstileToken } from './setup';

it('the SMTP sink, the single-use Turnstile fake and the OIDC fake are reachable', async () => {
  await clearMails();
  expect(await mails()).toEqual([]);
  const verify = (response: string) => fetch('http://127.0.0.1:12527/siteverify', { method: 'POST', body: new URLSearchParams({ secret: 'test-turnstile-secret', response }) }).then((r) => r.json());
  const token = turnstileToken();
  expect((await verify(token)).success).toBe(true);
  expect((await verify(token)).success).toBe(false); // used once already
  expect((await verify('nope')).success).toBe(false);
  const code = oidcCode({ sub: 's1', email: 'a@test.invalid' });
  const { access_token } = await (await fetch('http://127.0.0.1:12528/token', { method: 'POST', body: new URLSearchParams({ code }) })).json();
  const me = await (await fetch('http://127.0.0.1:12528/userinfo', { headers: { Authorization: `Bearer ${access_token}` } })).json();
  expect(me).toMatchObject({ sub: 's1', email: 'a@test.invalid', email_verified: true });
});
```

- [ ] **Step 8: Run the hooks suite**

Run: `bash scripts/test-hooks.sh`
Expected: PASS, including `fakes.test.ts`.

- [ ] **Step 9: Spike the PocketBase JSVM APIs (throwaway)**

This step confirms **names and shapes only**. Behaviour is proven by the tests in Tasks 2–6,
including the runtime OAuth2 interception in `oauth.test.ts`. Do not count the spike as
verification of anything else.
1. Create `$SCRATCH/spike/hooks/spike.pb.js`, with `$SCRATCH` the session scratchpad directory, never
   the repo:

```js
onServe((e) => {
  e.next()
  const users = $app.findCollectionByNameOrId('users')
  users.oauth2.providers = [{ name: 'google', clientId: 'x', clientSecret: 'y' }]
  users.oauth2.enabled = true
  $app.save(users)
  console.log('SPIKE oauth2', JSON.stringify($app.findCollectionByNameOrId('users').oauth2.providers.map((p) => p.name)))
  const s = $app.settings()
  console.log('SPIKE rules', JSON.stringify(s.rateLimits.rules.map((r) => r.label)))
  console.log('SPIKE apis', typeof $apis.recordAuthResponse, typeof MailerMessage, typeof $app.newMailClient, typeof cronAdd)
})
routerAdd('GET', '/spike/auth', (e) => e.json(200, { method: e.auth ? 'auth' : 'guest' }))
onRecordAuthRequest((e) => { console.log('SPIKE authMethod=' + JSON.stringify(e.authMethod)); e.next() }, 'users')
```

2. Run `pocketbase/pocketbase serve --dev --http 127.0.0.1:18090 --dir $SCRATCH/spike/data
   --hooksDir $SCRATCH/spike/hooks --migrationsDir pocketbase/pb_migrations`, with
   `CONDUCTOR_EMAIL` unset.
3. Through the admin API, create a user with an email, enable OTP, request an OTP, auth with it,
   then auth-refresh.
4. Write down:
   - whether `providers` maps from plain objects;
   - the default rate-limit labels;
   - the `authMethod` strings for OTP (`otp`?) and refresh (`""`?);
   - that `$apis.recordAuthResponse`, `MailerMessage` and `cronAdd` exist.
5. **If any name differs**, add a "Spike results" note at the top of this plan with the real names
   and use them in Tasks 2–6.
6. Delete `$SCRATCH/spike`.

- [ ] **Step 10: Commit**

```bash
git add web/scripts/test-fakes.mjs web/package.json web/package-lock.json scripts/pb-test-server.mjs scripts/test-hooks.mjs web/tests/browser-config.ts web/tests/hooks/setup.ts web/tests/hooks/fakes.test.ts
git status --short
git commit -m "test: SMTP sink and Turnstile fakes for the crew-access harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The crew-access migration, rehearsal-only login and test session helpers

**Files:**
- Create: `pocketbase/pb_migrations/1758900000_crew_access.js`, `pocketbase/pb_hooks/session.pb.js`,
  `web/tests/hooks/rehearsalLogin.test.ts`, `web/tests/hooks/session.test.ts`
- Modify:
  - `pocketbase/pb_hooks/login.pb.js`, `web/src/lib/server/pb.ts` (`requireUser`);
  - `web/tests/hooks/setup.ts` (`loginToken`), `web/tests/hooks/migrations.test.ts`;
  - `web/tests/e2e/helpers.ts`, `web/tests/e2e/login.spec.ts`,
    `web/tests/e2e/layout.spec.ts:6-11`, `web/tests/e2e/planning.spec.ts:20-25`;
  - `scripts/test-hooks.mjs` (SIM file list).
- Delete: `web/tests/hooks/login.test.ts`

**Interfaces:**
- **Produces, collections:**
  - `users` gains `blocked`, `approved_by` and `last_seen`; `email` becomes required; OTP is on;
    tokens last 30 days.
  - `boarding_requests` and `access_log` are new (fields exactly as spec §1, plus `status_at`).
- **Produces, settings:** `trustedProxy.headers = ['CF-Connecting-IP']`; three extra rate-limit
  rules; the OTP template.
- **Produces, hook tests:** `loginToken(name, password?)` returns `{token, id}` by
  find-or-create + impersonate. An admin password means `is_admin`. Each user's email is
  `hex(name_key)@test.invalid`.
- **Produces, e2e:** `sessionFor(name, admin)` returns `{token, record}`; `login(page, name,
  password)` keeps its signature. Both mint impersonation tokens with an explicit 400-day duration,
  because several e2e specs move the browser clock to December 2026.
- **Produces:** `GET /api/crawl/me` returns 200 `{record}`, 401 for no or invalid token, 403 for a
  blocked user. It updates `last_seen` at most every 10 min with SQL and **mints no token**.
  `requireUser` (web) uses it instead of `auth-refresh`.

- [ ] **Step 1: Write the failing migration test**

Append to `web/tests/hooks/migrations.test.ts` (same copy-migrations pattern as the tests above):

```ts
it('crew access keeps routes for the Conductor and wipes every other user and their traces', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-crew-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    await writeFile(join(migrations, '1758895000_crew_fixture.js'), `migrate(app => {
      const mk = (name, admin) => { const u = new Record(app.findCollectionByNameOrId('users'));
        u.set('name', name); u.set('name_key', name.toLowerCase()); u.set('is_admin', admin); u.setPassword('legacy-password-only'); app.save(u); return u };
      const boss = mk('Conductor', true), rider = mk('Rider', false);
      const it = new Record(app.findCollectionByNameOrId('itineraries'));
      it.set('id', 'routeroute00001'); it.set('title', 'Keep me'); it.set('status', 'draft'); it.set('event_date', '2026-12-26');
      it.set('start_time', '11:00'); it.set('created_by', rider.id); app.save(it);
      const stop = new Record(app.findCollectionByNameOrId('stops'));
      stop.set('id', 'stopstopstop001'); stop.set('itinerary', it.id); stop.set('name', 'Keep'); stop.set('station_id', 'CUS'); app.save(stop);
      const c = new Record(app.findCollectionByNameOrId('comments'));
      c.set('user', rider.id); c.set('target_collection', 'itineraries'); c.set('target_id', it.id); c.set('body', 'bye'); app.save(c);
      const d = new Record(app.findCollectionByNameOrId('drink_entries'));
      d.set('user', rider.id); d.set('stop', stop.id); d.set('kind', 'beer'); d.set('at', '2026-12-26T18:00:00Z'); app.save(d);
      const b = new Record(app.findCollectionByNameOrId('broadcasts'));
      b.set('itinerary', it.id); b.set('kind', 'message'); b.set('body', 'secret plan'); b.set('created_by', boss.id); app.save(b);
      const log = new Record(app.findCollectionByNameOrId('event_log'));
      log.set('itinerary', it.id); log.set('kind', 'bulletin'); log.set('payload', { body: 'secret plan' }); log.set('at', '2026-12-26T18:00:00Z'); app.save(log);
    }, app => {})`);
    await writeFile(join(migrations, '1758905000_verify_crew.js'), `migrate(app => {
      const users = app.findAllRecords('users');
      if (users.length !== 1) throw new Error('users left: ' + users.length);
      const c = users[0];
      if (c.email() !== 'conductor@test.invalid' || !c.getBool('is_admin') || !c.verified()) throw new Error('conductor fields');
      if (c.getString('name') !== 'Conductor') throw new Error('conductor name: ' + c.getString('name'));
      if (app.findRecordById('itineraries', 'routeroute00001').getString('created_by') !== c.id) throw new Error('route owner');
      app.findRecordById('stops', 'stopstopstop001');
      app.findRecordById('crawl_settings', 'crawlsettings');
      for (const name of ['comments', 'drink_entries', 'broadcasts', 'event_log', 'votes', 'checkins', 'chat_messages', 'reactions', 'media', 'broadcast_acks', 'approval_votes']) {
        if (app.countRecords(name) !== 0) throw new Error(name + ' not wiped');
      }
      const s = app.settings();
      if (s.trustedProxy.headers.join() !== 'CF-Connecting-IP') throw new Error('trusted proxy');
      if (!s.rateLimits.rules.some(r => r.label === 'users:requestOTP')) throw new Error('rate limits');
      const u = app.findCollectionByNameOrId('users');
      if (!u.otp.enabled || u.authToken.duration !== 2592000 || !u.fields.getByName('email').required) throw new Error('users options');
      app.findCollectionByNameOrId('boarding_requests'); app.findCollectionByNameOrId('access_log');
    }, app => {})`);
    const output = execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', 'up', '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, env: { ...process.env, CONDUCTOR_EMAIL: 'conductor@test.invalid' } });
    expect(output).toContain('1758905000_verify_crew');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('crew access reuses an account that already has the Conductor email, but kills its sessions and activity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-crew-reuse-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    await writeFile(join(migrations, '1758895000_reuse_fixture.js'), `migrate(app => {
      const u = new Record(app.findCollectionByNameOrId('users'));
      u.set('id', 'legacyconductr1'); u.set('name', 'Gui'); u.set('name_key', 'gui'); u.setEmail('conductor@test.invalid');
      u.setPassword('legacy-password-only'); u.set('tokenKey', 'legacy-token-key-legacy-token-key'); app.save(u);
      const it = new Record(app.findCollectionByNameOrId('itineraries'));
      it.set('title', 'Mine'); it.set('status', 'draft'); it.set('event_date', '2026-12-26'); it.set('start_time', '11:00'); it.set('created_by', u.id); app.save(it);
      const stop = new Record(app.findCollectionByNameOrId('stops'));
      stop.set('itinerary', it.id); stop.set('name', 'S'); stop.set('station_id', 'CUS'); app.save(stop);
      const d = new Record(app.findCollectionByNameOrId('drink_entries'));
      d.set('user', u.id); d.set('stop', stop.id); d.set('kind', 'beer'); d.set('at', '2026-12-26T18:00:00Z'); app.save(d);
    }, app => {})`);
    await writeFile(join(migrations, '1758905000_verify_reuse.js'), `migrate(app => {
      const c = app.findRecordById('users', 'legacyconductr1');
      if (!c.getBool('is_admin') || !c.verified()) throw new Error('not promoted');
      if (c.tokenKey() === 'legacy-token-key-legacy-token-key') throw new Error('legacy sessions survive');
      if (app.countRecords('drink_entries') !== 0) throw new Error('conductor activity survived');
    }, app => {})`);
    const output = execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', 'up', '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, env: { ...process.env, CONDUCTOR_EMAIL: 'conductor@test.invalid' } });
    expect(output).toContain('1758905000_verify_reuse');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('crew access can be rolled back and applied again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-crew-redo-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    const run = (...args: string[]) => execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', ...args, '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, env: { ...process.env, CONDUCTOR_EMAIL: 'conductor@test.invalid' } });
    run('up'); run('down', '1');
    expect(run('up')).toContain('1758900000_crew_access');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('crew access refuses to run without CONDUCTOR_EMAIL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-crew-noenv-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    const env = { ...process.env }; delete env.CONDUCTOR_EMAIL;
    expect(() => execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', 'up', '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, env, stdio: 'pipe' })).toThrow(/CONDUCTOR_EMAIL/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

The fixture's "Conductor" legacy admin proves the name-collision path: the new account starts as
"Conductor 2" and is renamed once the legacy one is gone.

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/test-hooks.sh`
Expected: FAIL. `1758905000_verify_crew` throws "users left: 2".

- [ ] **Step 3: Write the migration**

`pocketbase/pb_migrations/1758900000_crew_access.js`:

```js
// Crew access (spec 2026-10-03): email identity, boarding requests, access log, tunnel-aware
// settings, and the one-time wipe. Ordered so every save validates: fields first, then the
// Conductor, then the wipe, and only then is email made required. Self-contained on purpose:
// migration tests run with an empty hooks directory. pb_hooks/crew.js ensureConductor mirrors step 3.
migrate((app) => {
  const email = ($os.getenv('CONDUCTOR_EMAIL') || '').trim().toLowerCase()
  if (!email) throw new Error('Set CONDUCTOR_EMAIL before starting PocketBase: the crew-access migration mints the Conductor from it.')
  const ADMIN = '@request.auth.is_admin = true'

  // 1. Schema, email still optional.
  const users = app.findCollectionByNameOrId('users')
  users.fields.add(new BoolField({ name: 'blocked' }))
  users.fields.add(new RelationField({ name: 'approved_by', collectionId: users.id, maxSelect: 1, cascadeDelete: false }))
  users.fields.add(new DateField({ name: 'last_seen' }))
  app.save(users)

  const requests = new Collection({
    type: 'base', name: 'boarding_requests',
    listRule: `@request.auth.id != '' && decoy = false && (status = 'waiting' || ((status = 'aboard' || status = 'turned_away') && decided_at > @yesterday) || ${ADMIN})`,
    viewRule: `@request.auth.id != '' && decoy = false && (status = 'waiting' || ((status = 'aboard' || status = 'turned_away') && decided_at > @yesterday) || ${ADMIN})`,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'name', type: 'text', required: true, min: 2, max: 32 },
      { name: 'name_key', type: 'text', required: true, min: 2, max: 32 },
      { name: 'email', type: 'email', required: true },
      { name: 'method', type: 'select', values: ['email', 'google'], maxSelect: 1, required: true },
      { name: 'status', type: 'select', values: ['unverified', 'waiting', 'aboard', 'turned_away', 'expired'], maxSelect: 1, required: true },
      { name: 'decoy', type: 'bool', hidden: true },
      { name: 'secret_hash', type: 'text', hidden: true },
      { name: 'code_hash', type: 'text', hidden: true },
      { name: 'code_attempts', type: 'number', onlyInt: true },
      { name: 'code_sent_at', type: 'date' },
      { name: 'status_at', type: 'date' },
      { name: 'ip', type: 'text', max: 64 },
      { name: 'country', type: 'text', max: 8 },
      { name: 'city', type: 'text', max: 80 },
      { name: 'user_agent', type: 'text', max: 300 },
      { name: 'decided_by', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'decided_at', type: 'date' },
      { name: 'notified_at', type: 'date' },
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE INDEX idx_boarding_status ON boarding_requests (status, ip)', 'CREATE INDEX idx_boarding_email ON boarding_requests (email)']
  })
  app.save(requests)

  const log = new Collection({
    type: 'base', name: 'access_log', listRule: ADMIN, viewRule: ADMIN, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'event', type: 'select', maxSelect: 1, required: true, values: ['boarding_requested', 'boarding_verified', 'let_aboard', 'turned_away',
        'signed_in', 'sign_in_refused', 'code_sent', 'mail_failed', 'rate_limited', 'turnstile_failed', 'put_off', 'let_back_on', 'name_changed'] },
      { name: 'method', type: 'select', maxSelect: 1, values: ['email', 'google', 'rehearsal'] },
      { name: 'name', type: 'text', max: 64 },
      { name: 'email', type: 'text', max: 254 },
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'actor', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'request', type: 'relation', collectionId: requests.id, maxSelect: 1, cascadeDelete: false },
      { name: 'ip', type: 'text', max: 64 },
      { name: 'country', type: 'text', max: 8 },
      { name: 'city', type: 'text', max: 80 },
      { name: 'user_agent', type: 'text', max: 300 },
      { name: 'detail', type: 'text', max: 300 },
      { name: 'created', type: 'autodate', onCreate: true }
    ],
    indexes: ['CREATE INDEX idx_access_log_created ON access_log (created)']
  })
  app.save(log)

  // 2–3. The Conductor: reuse the account with that email, else mint one under the first free name.
  let conductor = null
  try { conductor = app.findAuthRecordByEmail('users', email) } catch (_) {}
  if (!conductor) {
    let name = 'Conductor'
    for (let n = 2; ; n++) {
      try { app.findFirstRecordByData('users', 'name_key', name.toLowerCase()) } catch (_) { break }
      name = 'Conductor ' + n
    }
    conductor = new Record(users)
    conductor.set('name', name)
    conductor.set('name_key', name.toLowerCase())
    conductor.setEmail(email)
    conductor.setPassword($security.randomString(40))
  }
  conductor.setVerified(true)
  conductor.set('is_admin', true)
  conductor.set('blocked', false)
  app.save(conductor)

  // 4. Routes belong to the Conductor. Raw SQL: no planner hooks, no recompute.
  app.db().newQuery('UPDATE itineraries SET created_by = {:id}').bind({ id: conductor.id }).execute()

  // 5. Every personal row goes, the Conductor's included (an email-matched legacy account keeps
  // nothing but its routes). app.delete removes Freight and comment files with their rows; none of
  // these collections has a delete hook. Bulletins go too: they block user deletion and the Train
  // Sheet copies their bodies. Then everyone else, and the Conductor's old sessions die.
  for (const name of ['reactions', 'chat_messages', 'media', 'drink_entries', 'checkins', 'broadcast_acks', 'broadcasts',
    'event_log', 'approval_votes', 'votes', 'comments']) {
    for (const r of app.findAllRecords(name)) app.delete(r)
  }
  for (const u of app.findAllRecords('users')) if (u.id !== conductor.id) app.delete(u)
  const kept = app.findRecordById('users', conductor.id)
  kept.refreshTokenKey()
  app.save(kept)

  // 6. Email becomes the identity; options and rules for the new sign-in paths.
  const fresh = app.findCollectionByNameOrId('users')
  fresh.fields.getByName('email').required = true
  fresh.otp.enabled = true
  fresh.otp.duration = 600
  fresh.otp.length = 6
  fresh.otp.emailTemplate.subject = 'Your Chug-a-Lug code'
  fresh.otp.emailTemplate.body = '<p>Your Chug-a-Lug sign-in code is <strong>{OTP}</strong>.</p><p>It works for 10 minutes. If you did not ask for it, ignore this email.</p>'
  fresh.authToken.duration = 2592000
  const locked = ['email', 'is_admin', 'blocked', 'approved_by', 'name_key', 'verified', 'password', 'last_seen']
  fresh.updateRule = 'id = @request.auth.id && ' + locked.map((f) => `@request.body.${f}:isset = false`).join(' && ')
  app.save(fresh)
  if (conductor.getString('name') !== 'Conductor') {
    let taken = false
    try { app.findFirstRecordByData('users', 'name_key', 'conductor'); taken = true } catch (_) {}
    if (!taken) { const c = app.findRecordById('users', conductor.id); c.set('name', 'Conductor'); c.set('name_key', 'conductor'); app.save(c) }
  }

  // PB_RATE_LIMITS=off exists for the test harnesses only, which drive everything from one IP;
  // config.pb.js applies the same switch on every start. Rules are added idempotently.
  const s = app.settings()
  s.trustedProxy.headers = ['CF-Connecting-IP']
  s.trustedProxy.useLeftmostIP = false
  s.rateLimits.enabled = $os.getenv('PB_RATE_LIMITS') !== 'off'
  const ours = [
    { label: 'users:requestOTP', maxRequests: 5, duration: 600, audience: '' },
    { label: 'users:authWithOTP', maxRequests: 10, duration: 600, audience: '' },
    { label: 'users:authWithOAuth2', maxRequests: 10, duration: 600, audience: '' }
  ]
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => !ours.some((o) => o.label === r.label)).concat(ours)
  app.save(s)
}, (app) => {
  const s = app.settings()
  s.trustedProxy.headers = []
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => ['users:requestOTP', 'users:authWithOTP', 'users:authWithOAuth2'].indexOf(r.label) < 0)
  app.save(s)
  // Schema only: the wiped data is gone. Restore a backup (OPERATIONS.md) to get it back.
  for (const name of ['access_log', 'boarding_requests']) app.delete(app.findCollectionByNameOrId(name))
  const users = app.findCollectionByNameOrId('users')
  for (const f of ['blocked', 'approved_by', 'last_seen']) users.fields.removeByName(f)
  users.fields.getByName('email').required = false
  users.otp.enabled = false
  users.authToken.duration = 31536000
  users.updateRule = "id = @request.auth.id && @request.body.is_admin:isset = false && @request.body.name:isset = false && @request.body.name_key:isset = false && @request.body.password:isset = false"
  app.save(users)
})
```

- [ ] **Step 4: Run the hooks suite**

Run: `bash scripts/test-hooks.sh`
Expected: the migration tests PASS. Many other hook tests FAIL, because `login.pb.js` creates
users without an email. Steps 5–7 fix that.

- [ ] **Step 5: Make `/api/crawl/login` rehearsal-only, with the takeover fixed**

Replace `pocketbase/pb_hooks/login.pb.js`:

```js
// POST /api/crawl/login {name, password} — rehearsal stacks only (SIM=1), which have no mail.
// Production signs in by email code or Google (access.pb.js); here the route does not exist.
// A Conductor name always needs the admin password: the crew password never yields an admin token.
routerAdd('POST', '/api/crawl/login', (e) => {
  if ($os.getenv('SIM') !== '1') return e.json(404, { message: 'Not found.' })
  const limits = require(`${__hooks}/limits.js`)
  const normalizeName = require(`${__hooks}/names.js`)
  const body = e.requestInfo().body
  const name = normalizeName(body.name)
  if (!name) return e.json(400, { message: "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -" })
  const password = typeof body.password === 'string' ? body.password : ''
  const loginRateLimit = parseInt($os.getenv('LOGIN_RATE_LIMIT'), 10) || 20
  if (!limits.consume('login:' + e.realIP(), loginRateLimit, 900)) return e.json(429, { message: 'Too many attempts. Try again in 15 minutes.' })
  const crewPassword = $os.getenv('CREW_PASSWORD')
  const adminPassword = $os.getenv('ADMIN_PASSWORD')
  if (!crewPassword) return e.json(503, { message: 'Login is not configured on the server.' })
  const isAdmin = !!adminPassword && $security.equal(password, adminPassword)
  const isCrew = $security.equal(password, crewPassword)
  if (!isAdmin && !isCrew) return e.json(401, { message: 'Wrong password. Ask the family group chat.' })
  let user = null
  try { user = $app.findFirstRecordByData('users', 'name_key', name.key) } catch (_) {}
  if (user && user.getBool('is_admin') && !isAdmin) return e.json(403, { message: 'This name needs the Conductor password.' })
  $app.runInTransaction((app) => {
    if (!user) {
      user = new Record(app.findCollectionByNameOrId('users'))
      user.set('name', name.display)
      user.set('name_key', name.key)
      user.setEmail(name.key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + $security.randomStringWithAlphabet(6, 'abcdefghijklmnopqrstuvwxyz0123456789') + '@rehearsal.invalid')
      user.setVerified(true)
      user.setPassword($security.randomString(40))
    }
    if (isAdmin) user.set('is_admin', true)
    app.save(user)
  })
  return $apis.recordAuthResponse(e, user, 'rehearsal', null)
})
```

- [ ] **Step 6: Switch the hook test session helper**

In `web/tests/hooks/setup.ts`:
- replace `seedUserToken` and `loginToken` with the version below;
- delete the `login` export and the comment about the shared login budget.

`CREW_PASSWORD` and `ADMIN_LOGIN_PASSWORD` stay exported.

```ts
const hexEmail = (key: string) => `${Buffer.from(key).toString('hex')}@test.invalid`;

/** A session for `name`, created on first use: superuser find-or-create, then impersonation. */
export async function loginToken(name: string, password: string = CREW_PASSWORD): Promise<{ token: string; id: string }> {
  const su = await superuserToken();
  const display = name.trim().replace(/\s+/g, ' '), key = display.toLowerCase();
  const admin = password === ADMIN_LOGIN_PASSWORD;
  const query = new URLSearchParams({ filter: `name_key=${JSON.stringify(key)}` });
  const found = await (await fetch(`${PB}/api/collections/users/records?${query}`, { headers: { Authorization: su } })).json();
  let user = found.items?.[0];
  if (!user) {
    const create = await fetch(`${PB}/api/collections/users/records`, {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: su },
      body: JSON.stringify({ name: display, name_key: key, email: hexEmail(key), verified: true, is_admin: admin,
        password: 'seed-test-password-1', passwordConfirm: 'seed-test-password-1' })
    });
    if (!create.ok) throw new Error(`Seed user failed: ${create.status} ${await create.text()}`);
    user = await create.json();
  } else if (admin && !user.is_admin) {
    await fetch(`${PB}/api/collections/users/records/${user.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: su }, body: JSON.stringify({ is_admin: true }) });
  }
  // Explicit and long: some suites move the clock months ahead. These tokens are not refreshable.
  const impersonate = await fetch(`${PB}/api/collections/users/impersonate/${user.id}`, {
    method: 'POST', headers: { Authorization: su, 'content-type': 'application/json' }, body: JSON.stringify({ duration: 400 * 86400 }) });
  if (!impersonate.ok) throw new Error(`Impersonate failed: ${impersonate.status}`);
  return { token: (await impersonate.json()).token, id: user.id };
}
```

- [ ] **Step 7: Move the old login test to the rehearsal pass**

1. Delete `web/tests/hooks/login.test.ts`.
2. Create `web/tests/hooks/rehearsalLogin.test.ts`. It runs only in the SIM pass:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, CREW_PASSWORD, deleteUserByName, post } from './setup';

const names: string[] = [];
const name = (prefix: string) => { const v = `${prefix} ${Math.floor(Math.random() * 1e6)}`; names.push(v); return v; };
const login = (n: string, password = CREW_PASSWORD) => post('/api/crawl/login', { name: n, password });

describe.skipIf(process.env.SIM !== '1')('rehearsal login (SIM=1 only)', () => {
  afterAll(async () => { for (const n of names) await deleteUserByName(n); });

  it('creates the identity with a rehearsal email and reuses it case-insensitively', async () => {
    const n = name('Gui');
    const a = await (await login(`  ${n}  `)).json();
    expect(a.record).toMatchObject({ name: n, is_admin: false });
    const b = await (await login(n.toUpperCase())).json();
    expect(b.record.id).toBe(a.record.id);
  });

  it('never hands a Conductor name to the crew password', async () => {
    const n = name('Boss');
    expect((await (await login(n, ADMIN_LOGIN_PASSWORD)).json()).record.is_admin).toBe(true);
    const crew = await login(n);
    expect(crew.status).toBe(403);
    expect((await crew.json()).message).toContain('Conductor password');
  });

  it('rejects wrong passwords', async () => {
    expect((await login(name('Rider'), 'nope')).status).toBe(401);
  });
});
```

3. In `scripts/test-hooks.mjs`, change the SIM pass's vitest args to
   `['exec', '--', 'vitest', 'run', 'tests/hooks/simulationEvents.test.ts', 'tests/hooks/rehearsalLogin.test.ts']`.

- [ ] **Step 7b: `GET /api/crawl/me`, and `requireUser` stops refreshing tokens**

Impersonation tokens cannot be refreshed, and nothing needs a new token just to learn who is
calling. Write the test first, `web/tests/hooks/session.test.ts`:

```ts
import { expect, it } from 'vitest';
import { PB, get, loginToken, superuserToken } from './setup';

it('names the caller without minting a token, and refuses blocked or missing sessions', async () => {
  const { token, id } = await loginToken(`Me ${Math.floor(Math.random() * 1e6)}`);
  const me = await get('/api/crawl/me', token);
  expect(me.status).toBe(200);
  const body = await me.json();
  expect(body.record.id).toBe(id);
  expect(body.token).toBeUndefined();
  expect((await get('/api/crawl/me')).status).toBe(401);
  await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH',
    headers: { Authorization: await superuserToken(), 'content-type': 'application/json' }, body: JSON.stringify({ blocked: true }) });
  expect((await get('/api/crawl/me', token)).status).toBe(403);
});
```

`pocketbase/pb_hooks/session.pb.js`:

```js
// GET /api/crawl/me — who this token belongs to, without minting a token. The app checks it on
// every open and the web server's requireUser uses it: impersonated test sessions are not
// refreshable, and a check must never write anything but last_seen (one column, no stale save).
routerAdd('GET', '/api/crawl/me', (e) => {
  const u = e.auth
  if (!u || u.collection().name !== 'users') return e.json(401, { message: 'Sign in first.' })
  if (u.getBool('blocked')) return e.json(403, { message: 'Your seat was taken away. Ask the Conductor.' })
  const seen = u.getDateTime('last_seen')
  if (seen.isZero() || Date.now() / 1000 - seen.unix() > 600) {
    $app.db().newQuery('UPDATE users SET last_seen = {:t} WHERE id = {:id}').bind({ t: new Date().toISOString().replace('T', ' '), id: u.id }).execute()
  }
  return e.json(200, { record: u })
})
```

In `web/src/lib/server/pb.ts`, `requireUser` changes its fetch to:

```ts
  const res = await fetch(`${serverEnv.pbUrl}/api/crawl/me`, { headers: { Authorization: token } });
```

Its error message, cache and the `record` read stay the same.

- [ ] **Step 8: Switch the e2e helper to minted sessions**

In `web/tests/e2e/helpers.ts`, replace the body of `login` and add `sessionFor`. Everything after
the `Promise.any` wait stays as it is.

```ts
const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const BASE = 'http://127.0.0.1:15173';
const COOKIE = process.env.PUBLIC_SIM === '1' ? 'pb_auth_rehearsal' : 'pb_auth';

/** Superuser find-or-create plus impersonation: a real session without the sign-in UI. */
export async function sessionFor(name: string, admin = false): Promise<{ token: string; record: Record<string, unknown> }> {
  const su = await superuserToken();
  const display = name.trim().replace(/\s+/g, ' '), key = display.toLowerCase();
  const query = new URLSearchParams({ filter: `name_key=${JSON.stringify(key)}` });
  let user = (await (await fetch(`${PB}/api/collections/users/records?${query}`, { headers: { Authorization: su } })).json()).items?.[0];
  if (!user) user = await create('users', { name: display, name_key: key, email: `${Buffer.from(key).toString('hex')}@test.invalid`,
    verified: true, is_admin: admin, password: 'seed-test-password-1', passwordConfirm: 'seed-test-password-1' }, su);
  else if (admin && !user.is_admin) await fetch(`${PB}/api/collections/users/records/${user.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: su }, body: JSON.stringify({ is_admin: true }) });
  // 400 days: several specs move the browser clock to December 2026, past a 30-day token.
  const res = await fetch(`${PB}/api/collections/users/impersonate/${user.id}`, {
    method: 'POST', headers: { Authorization: su, 'content-type': 'application/json' }, body: JSON.stringify({ duration: 400 * 86400 }) });
  if (!res.ok) throw new Error(`Impersonate failed: ${res.status}`);
  return res.json();
}

export async function login(page: Page, name: string, password: string) {
  const { token, record } = await sessionFor(name, password === ADMIN);
  await page.context().addCookies([{ name: COOKIE, value: encodeURIComponent(JSON.stringify({ token, record })), url: BASE }]);
  await page.goto('/');
  // …the existing Promise.any visibility wait, unchanged…
}
```

`create` is defined lower in the file. Move it above `sessionFor`, or turn it into a function
declaration so it hoists.

- [ ] **Step 9: Rewrite the e2e specs that typed into the password form**

- **`layout.spec.ts` and `planning.spec.ts`:** delete the local `login` functions and import
  `login` from `./helpers`.
  - `layout.spec.ts` calls become `await login(page, 'E2E Desk', CREW)`.
  - `planning.spec.ts`'s existing calls already pass `(page, name, password)`.
  - Remove the now-unused `CREW`/`ADMIN` constants only where nothing else uses them.
- **`web/tests/e2e/login.spec.ts`:** replace with the session-and-logout behaviour. The new sign-in
  UI is covered in Task 7.

```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('a signed-out visitor lands on /login; a session persists in a cookie until logout', async ({ page, context }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await login(page, 'E2E Rider', 'crew-test-password');
  expect((await context.cookies()).find((c) => c.name === 'pb_auth')?.value).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId('name')).toHaveText('E2E Rider');
  await page.getByTestId('menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).find((c) => c.name === 'pb_auth')).toBeUndefined();
});
```

- [ ] **Step 10: Run everything**

Run: `bash scripts/test-hooks.sh && cd web && npm test && npm run check && npm run test:e2e`
Expected: PASS. `npm run check` will flag any import of the removed `login` export from
`web/tests/hooks/setup.ts`; replace it with `loginToken`.

- [ ] **Step 11: Commit**

```bash
git add pocketbase/pb_migrations/1758900000_crew_access.js pocketbase/pb_hooks/login.pb.js pocketbase/pb_hooks/session.pb.js web/src/lib/server/pb.ts web/tests/hooks/session.test.ts web/tests/hooks/setup.ts web/tests/hooks/migrations.test.ts web/tests/hooks/rehearsalLogin.test.ts web/tests/e2e/helpers.ts web/tests/e2e/login.spec.ts web/tests/e2e/layout.spec.ts web/tests/e2e/planning.spec.ts scripts/test-hooks.mjs
git rm web/tests/hooks/login.test.ts
git status --short
git commit -m "feat(access): crew-access migration — email identity, Conductor from env, wipe; rehearsal-only password login

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rehearsal plumbing

**Files:**
- Modify:
  - `compose.sim.yml`;
  - `web/src/lib/sim/config.ts` (export the constant);
  - `web/src/lib/server/sim/seed.ts`, `web/scripts/sim.mjs`;
  - `web/tests/unit/simSeed.test.ts`, `web/tests/sim/setup.ts` (no change expected; verify);
  - `docs/OPERATIONS.md` (rehearsal note).

**Interfaces:**
- **Produces:** `REHEARSAL_CONDUCTOR_EMAIL = 'conductor@rehearsal.invalid'` from
  `web/src/lib/sim/config.ts`.
- **Produces:** `seedTimetable(request, clock, scenario, passwords, conductorEmail)`, with a new
  final parameter.

- [ ] **Step 1: Write the failing unit tests**

In `web/tests/unit/simSeed.test.ts`:
- Pass `REHEARSAL_CONDUCTOR_EMAIL` as the new last argument in the existing calls.
- Make the existing mock answer the users probe with the Conductor, and add two tests:

```ts
import { REHEARSAL_CONDUCTOR_EMAIL } from '../../src/lib/sim/config';
// In the first test's mock: if (method === 'GET' && path.includes('/users/records')) return { totalItems: 1, items: [{ id: 'c', email: REHEARSAL_CONDUCTOR_EMAIL }] };

it('allows exactly the minted rehearsal Conductor in the users table', async () => {
  const request = vi.fn(async (method: string, path: string) => {
    if (method === 'GET' && path.includes('/users/records')) return { totalItems: 1, items: [{ id: 'c', email: REHEARSAL_CONDUCTOR_EMAIL }] };
    if (method === 'GET') return { totalItems: 0, items: [] };
    if (path === '/api/crawl/login') return { record: { id: 'u' } };
    return { id: 'r' };
  });
  await expect(seedTimetable(request, clock, scenario, { crew: 'crew', conductor: 'boss' }, REHEARSAL_CONDUCTOR_EMAIL)).resolves.toBeTruthy();
});

it('still refuses any other user', async () => {
  const request = vi.fn(async (method: string, path: string) => {
    if (method === 'GET' && path.includes('/users/records')) return { totalItems: 1, items: [{ id: 'x', email: 'someone@else.invalid' }] };
    return { totalItems: 0, items: [] };
  });
  await expect(seedTimetable(request, clock, scenario, { crew: 'crew', conductor: 'boss' }, REHEARSAL_CONDUCTOR_EMAIL)).rejects.toThrow();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run tests/unit/simSeed.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **`web/src/lib/sim/config.ts`:**
  `export const REHEARSAL_CONDUCTOR_EMAIL = 'conductor@rehearsal.invalid';`
- **`seed.ts`:** add the `conductorEmail: string` parameter and replace the guard loop:

```ts
  for (const collection of ['simulation_clock', 'users', 'itineraries', 'stops', 'checkins', 'drink_entries', 'broadcasts', 'media']) {
    const rows = await request('GET', `/api/collections/${collection}/records?perPage=2`);
    // The crew-access migration always mints the rehearsal Conductor; nothing else may exist.
    const allowed = collection === 'users' && rows.totalItems === 1 && rows.items?.[0]?.email === conductorEmail;
    if (rows.totalItems !== 0 && !allowed) throw new Error(simSetup.notEmpty);
  }
```

- **`web/scripts/sim.mjs`:** pass `REHEARSAL_CONDUCTOR_EMAIL`, imported from
  `../src/lib/sim/config.ts`, as the last `seedTimetable` argument.
- **`compose.sim.yml`:** under `pocketbase.environment` add
  `CONDUCTOR_EMAIL: conductor@rehearsal.invalid` and `PB_RATE_LIMITS: "off"`. Rehearsals drive many
  phones from one LAN IP.
- **`docs/OPERATIONS.md`:** under "Shakedown Run" add "After upgrading to crew access, delete
  existing `.simulations/<run>` folders and start fresh runs: the migration wipes their users while
  their marker still says ready."

- [ ] **Step 4: Run the gate**

Run: `cd web && npm test && npm run check && cd .. && bash scripts/test-hooks.sh`
Expected: PASS. Then run `cd web && npm run test:sim` once to confirm the rehearsal browser suite
still seeds. It uses `tests/sim/setup.ts`, which checks other collections and logs in through the
SIM route.

- [ ] **Step 5: Commit**

```bash
git add compose.sim.yml web/src/lib/sim/config.ts web/src/lib/server/sim/seed.ts web/scripts/sim.mjs web/tests/unit/simSeed.test.ts docs/OPERATIONS.md
git status --short
git commit -m "feat(sim): rehearsals mint their own Conductor and the seed guard allows exactly it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared crew module, serve-time config, sign-in guards, tunnel middleware, headers

**Files:**
- Create: `pocketbase/pb_hooks/crew.js`, `pocketbase/pb_hooks/config.pb.js`,
  `pocketbase/pb_hooks/access.pb.js`, `pocketbase/pb_hooks/edge.pb.js`
- Modify: `web/src/hooks.server.ts`
- Test: `web/tests/unit/oauthDecision.test.ts`, `web/tests/hooks/access.test.ts`,
  `web/tests/hooks/edge.test.ts`, `web/tests/e2e/layout.spec.ts` (headers)

**Interfaces:**
- **Produces, from `crew.js`:**
  - `clientInfo(e) → {ip, country, city, user_agent}`;
  - `hash(s) → string`;
  - `normalizeEmail(x) → string | null`;
  - `logEvent(app, fields, info?)`;
  - `sendMail(app, {to: string[], subject, text, html?})`, which throws on failure;
  - `ensureConductor(app, email) → Record | null`;
  - `oauthDecision({isNewRecord, hasName, blocked, recordEmail, oauthEmail, oauthEmailVerified})
    → 'refuse_unverified' | 'request' | 'refuse_new' | 'refuse_blocked' | 'refuse_mismatch' | 'continue'`;
  - `signInGuard(app, record, method, info) → null | {status: number, message: string}`;
  - `METHODS = {otp: 'email', oauth2: 'google', rehearsal: 'rehearsal'}`.
- **Produces:** `access_log` rows `signed_in`, `sign_in_refused` and `code_sent`.

- [ ] **Step 1: Write the failing pure-policy test**

`web/tests/unit/oauthDecision.test.ts`:

```ts
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const { oauthDecision } = createRequire(import.meta.url)('../../../pocketbase/pb_hooks/crew.js');
const base = { isNewRecord: false, hasName: false, blocked: false, recordEmail: 'bob@example.com', oauthEmail: 'Bob@Example.com', oauthEmailVerified: true };

describe('oauthDecision (spec §2.5)', () => {
  it('refuses an unverified Google email first', () => expect(oauthDecision({ ...base, oauthEmailVerified: false })).toBe('refuse_unverified'));
  it('files a request for a new identity from the join page', () => expect(oauthDecision({ ...base, isNewRecord: true, hasName: true, recordEmail: '' })).toBe('request'));
  it('refuses a new identity from the login page', () => expect(oauthDecision({ ...base, isNewRecord: true, recordEmail: '' })).toBe('refuse_new'));
  it('refuses a blocked account', () => expect(oauthDecision({ ...base, blocked: true })).toBe('refuse_blocked'));
  it('refuses linking a different email (crew token + other Google account)', () =>
    expect(oauthDecision({ ...base, recordEmail: 'alice@example.com' })).toBe('refuse_mismatch'));
  it('continues for the matching email, ignoring case', () => expect(oauthDecision(base)).toBe('continue'));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run tests/unit/oauthDecision.test.ts`
Expected: FAIL: cannot find `crew.js`.

- [ ] **Step 3: Write `crew.js`**

`pocketbase/pb_hooks/crew.js`:

```js
// Shared crew-access helpers. Everything is a function so this file loads outside PocketBase too
// (web/tests/unit/oauthDecision.test.ts); nothing touches $app or a global at load time.
const DENIALS = ['rate_limited', 'turnstile_failed', 'sign_in_refused']

exports.METHODS = { otp: 'email', oauth2: 'google', rehearsal: 'rehearsal' }

exports.clientInfo = function (e) {
  const h = (k) => String(e.request.header.get(k) || '')
  return { ip: e.realIP(), country: h('CF-IPCountry').slice(0, 8), city: h('CF-IPCity').slice(0, 80), user_agent: h('User-Agent').slice(0, 300) }
}

exports.hash = function (s) { return $security.sha256(String(s)) }

exports.normalizeEmail = function (x) {
  if (typeof x !== 'string') return null
  const v = x.trim().toLowerCase()
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null
}

// Denials are throttled per IP and event, so a flood writes one row per 15 min, not one per hit.
// Never call this with a denial event inside a transaction: limits.consume opens its own.
exports.logEvent = function (app, fields, info) {
  info = info || {}
  if (DENIALS.indexOf(fields.event) >= 0) {
    const limits = require(`${__hooks}/limits.js`)
    if (!limits.consume('log:' + fields.event + ':' + (info.ip || ''), 1, 900)) return
  }
  const r = new Record(app.findCollectionByNameOrId('access_log'))
  for (const k of ['event', 'method', 'name', 'email', 'user', 'actor', 'request', 'detail']) if (fields[k]) r.set(k, String(fields[k]).slice(0, 300))
  for (const k of ['ip', 'country', 'city', 'user_agent']) if (info[k]) r.set(k, info[k])
  app.save(r)
}

exports.sendMail = function (app, m) {
  const meta = app.settings().meta
  const message = new MailerMessage({
    from: { address: meta.senderAddress, name: meta.senderName || 'Chug-a-Lug' },
    to: m.to.map((address) => ({ address })),
    subject: m.subject, text: m.text, html: m.html || ''
  })
  app.newMailClient().send(message)
}

// The single Conductor path at serve time; the migration carries an identical copy (it must run
// with an empty hooks directory). Idempotent: reuse by email, else mint under the first free name.
exports.ensureConductor = function (app, raw) {
  const email = exports.normalizeEmail(raw)
  if (!email) return null
  let c = null
  try { c = app.findAuthRecordByEmail('users', email) } catch (_) {}
  if (!c) {
    let name = 'Conductor'
    for (let n = 2; ; n++) {
      try { app.findFirstRecordByData('users', 'name_key', name.toLowerCase()) } catch (_) { break }
      name = 'Conductor ' + n
    }
    c = new Record(app.findCollectionByNameOrId('users'))
    c.set('name', name)
    c.set('name_key', name.toLowerCase())
    c.setEmail(email)
    c.setPassword($security.randomString(40))
  }
  if (c.getBool('is_admin') && c.verified() && !c.getBool('blocked') && c.id) return c
  c.setVerified(true)
  c.set('is_admin', true)
  c.set('blocked', false)
  app.save(c)
  return c
}

// Spec §2.5. Pure. PocketBase resolves `record` by existing link, then by the *authenticated
// caller*, then by email, so an existing record does not imply a matching email.
exports.oauthDecision = function (x) {
  if (!x.oauthEmailVerified) return 'refuse_unverified'
  if (x.isNewRecord) return x.hasName ? 'request' : 'refuse_new'
  if (x.blocked) return 'refuse_blocked'
  if (String(x.recordEmail || '').toLowerCase() !== String(x.oauthEmail || '').toLowerCase()) return 'refuse_mismatch'
  return 'continue'
}

// Every way a session is issued passes here (spec §2.8).
exports.signInGuard = function (app, record, method, info) {
  if (record.getBool('blocked')) {
    exports.logEvent(app, { event: 'sign_in_refused', method, user: record.id, email: record.email(), detail: 'blocked' }, info)
    return { status: 403, message: 'Your seat was taken away. Ask the Conductor.' }
  }
  // One column by SQL: saving the loaded record could write back a stale blocked flag or token key.
  app.db().newQuery('UPDATE users SET last_seen = {:t} WHERE id = {:id}').bind({ t: new Date().toISOString().replace('T', ' '), id: record.id }).execute()
  exports.logEvent(app, { event: 'signed_in', method, user: record.id, name: record.getString('name'), email: record.email() }, info)
  return null
}
```

Run: `cd web && npx vitest run tests/unit/oauthDecision.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing access and edge hook tests**

`web/tests/hooks/access.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { PB, clearMails, codeFor, loginToken, mails, post, superuserToken } from './setup';

const emailOf = (key: string) => `${Buffer.from(key).toString('hex')}@test.invalid`;
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
async function logRows(filter: string) {
  const q = new URLSearchParams({ filter, sort: '-created' });
  return (await (await fetch(`${PB}/api/collections/access_log/records?${q}`, { headers: await su() })).json()).items as any[];
}

describe('sign-in by email code and the guards', () => {
  beforeEach(clearMails);

  it('a member signs in with an emailed code, and it is logged', async () => {
    const name = `Coder ${Math.floor(Math.random() * 1e6)}`;
    const { id } = await loginToken(name);
    const email = emailOf(name.toLowerCase());
    // Case-folding is the client's job (requestCode lowercases); PocketBase sees the stored form.
    const { otpId } = await (await post('/api/collections/users/request-otp', { email })).json();
    const auth = await post('/api/collections/users/auth-with-otp', { otpId, password: await codeFor(email) });
    expect(auth.status).toBe(200);
    expect((await auth.json()).record.id).toBe(id);
    expect((await logRows(`user = "${id}" && event = "signed_in" && method = "email"`)).length).toBe(1);
  });

  it('a non-member asks for a code and nothing is sent', async () => {
    const res = await post('/api/collections/users/request-otp', { email: 'nobody@test.invalid' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 500));
    expect(await mails('nobody@test.invalid')).toEqual([]);
  });

  it('a blocked member cannot sign in or refresh, and a refresh never logs a sign-in', async () => {
    // A real OTP session: impersonation tokens (loginToken) are not refreshable at all.
    const name = `Blocked ${Math.floor(Math.random() * 1e6)}`;
    const { id } = await loginToken(name);
    const email = emailOf(name.toLowerCase());
    const otp = async () => {
      await clearMails();
      const { otpId } = await (await post('/api/collections/users/request-otp', { email })).json();
      return post('/api/collections/users/auth-with-otp', { otpId, password: await codeFor(email) });
    };
    const { token } = await (await otp()).json();
    expect((await post('/api/collections/users/auth-refresh', {}, token)).status).toBe(200);
    expect((await logRows(`user = "${id}" && event = "signed_in"`)).length).toBe(1); // the OTP sign-in only
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ blocked: true }) });
    expect((await post('/api/collections/users/auth-refresh', {}, token)).status).toBe(403);
    expect((await otp()).status).toBe(403);
  });

  it('the Conductor exists from CONDUCTOR_EMAIL with is_admin', async () => {
    const q = new URLSearchParams({ filter: 'email = "conductor@test.invalid"' });
    const rows = (await (await fetch(`${PB}/api/collections/users/records?${q}`, { headers: await su() })).json()).items;
    expect(rows).toHaveLength(1);
    expect(rows[0].is_admin).toBe(true);
  });

  it('users cannot change their own privileges, email or bookkeeping', async () => {
    const { id, token } = await loginToken(`Self ${Math.floor(Math.random() * 1e6)}`);
    for (const body of [{ is_admin: true }, { blocked: true }, { email: 'x@test.invalid' }, { approved_by: id }, { last_seen: '2020-01-01 00:00:00.000Z' }, { name_key: 'x' }]) {
      const res = await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: { Authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(res.status, JSON.stringify(body)).toBe(404);
    }
  });
});
```

`web/tests/hooks/edge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PB, post, superuserToken } from './setup';

const viaTunnel = { 'CF-Connecting-IP': '203.0.113.9' };
const creds = JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL ?? 'tests@chugalug.invalid', password: process.env.PB_ADMIN_PASSWORD ?? 'local-test-password-only' });

describe('the tunnel cannot reach the superuser surface (spec §3)', () => {
  it('blocks /_/ and superuser auth by name and by id when CF-Connecting-IP is present', async () => {
    const token = await superuserToken();
    const id = (await (await fetch(`${PB}/api/collections/_superusers`, { headers: { Authorization: token } })).json()).id;
    expect((await fetch(`${PB}/_/`, { headers: viaTunnel })).status).toBe(404);
    for (const c of ['_superusers', id]) {
      const res = await fetch(`${PB}/api/collections/${c}/auth-with-password`, { method: 'POST', headers: { ...viaTunnel, 'content-type': 'application/json' }, body: creds });
      expect(res.status, c).toBe(404);
    }
  });

  it('still serves both without the header (the box and the web container)', async () => {
    expect((await fetch(`${PB}/_/`)).status).toBe(200);
    expect((await post('/api/collections/_superusers/auth-with-password', JSON.parse(creds))).status).toBe(200);
  });

  it('has no password login in production mode', async () => {
    expect((await post('/api/crawl/login', { name: 'Anyone', password: 'x' })).status).toBe(404);
  });
});
```

Run: `bash scripts/test-hooks.sh`
Expected: FAIL: no sign-in log rows, refresh not blocked, `/_/` reachable through the tunnel.

- [ ] **Step 5: Implement the hooks**

`pocketbase/pb_hooks/config.pb.js`:

```js
// The environment becomes settings once the application migrations have run (onServe, never
// onBootstrap: bootstrap runs before them and also during `superuser upsert`). Idempotent.
onServe((e) => {
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
  const users = $app.findCollectionByNameOrId('users')
  const id = env('GOOGLE_CLIENT_ID'), secret = env('GOOGLE_CLIENT_SECRET')
  users.oauth2.providers = id && secret ? [{ name: 'google', clientId: id, clientSecret: secret }] : []
  users.oauth2.enabled = !!(id && secret)
  $app.save(users)
  require(`${__hooks}/crew.js`).ensureConductor($app, env('CONDUCTOR_EMAIL'))
})
```

`pocketbase/pb_hooks/access.pb.js`. Task 6 adds more to this file.

```js
// Sign-in guards (spec §2.8). A refresh also fires onRecordAuthRequest with an empty authMethod,
// so only real sign-ins are guarded and logged here; refreshes have their own hook.
onRecordAuthRequest((e) => {
  const crew = require(`${__hooks}/crew.js`)
  const method = crew.METHODS[e.authMethod]
  if (method) {
    const refused = crew.signInGuard($app, e.record, method, crew.clientInfo(e))
    if (refused) return e.json(refused.status, { message: refused.message })
  }
  e.next()
}, 'users')

onRecordAuthRefreshRequest((e) => {
  if (e.record.getBool('blocked')) return e.json(403, { message: 'Your seat was taken away. Ask the Conductor.' })
  const seen = e.record.getDateTime('last_seen')
  if (seen.isZero() || Date.now() / 1000 - seen.unix() > 600) {
    $app.db().newQuery('UPDATE users SET last_seen = {:t} WHERE id = {:id}').bind({ t: new Date().toISOString().replace('T', ' '), id: e.record.id }).execute()
  }
  e.next()
}, 'users')

// PocketBase sends OTP mail after replying, so success is logged only once the send returns.
onMailerRecordOTPSend((e) => {
  e.next()
  require(`${__hooks}/crew.js`).logEvent($app, { event: 'code_sent', method: 'email', user: e.record.id, email: e.record.email() })
}, 'users')
```

`pocketbase/pb_hooks/edge.pb.js`:

```js
// Requests through the tunnel always carry CF-Connecting-IP (Cloudflare sets it; nothing else
// reaches PocketBase, see compose.yml). Those never see the admin UI or any superuser endpoint,
// whether the URL names the collection or uses its id. The box and the web container are unaffected.
routerUse((e) => {
  if (e.request.header.get('CF-Connecting-IP')) {
    const path = e.request.url.path
    if (path === '/_' || path.indexOf('/_/') === 0) return e.json(404, { message: 'Not found.' })
    const m = /^\/api\/collections\/([^/]+)/.exec(path)
    if (m) {
      let name = ''
      try { name = $app.findCollectionByNameOrId(decodeURIComponent(m[1])).name } catch (_) {}
      if (name === '_superusers') return e.json(404, { message: 'Not found.' })
    }
  }
  return e.next()
})
```

**If `e.authMethod` for OTP is not `otp`** (Task 1 spike), fix the keys of `crew.METHODS`.

- [ ] **Step 6: Add the security headers (test first)**

Add to `web/tests/e2e/layout.spec.ts`:

```ts
test('every page carries the security headers', async ({ request }) => {
  const res = await request.get('/login');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(res.headers()['content-security-policy']).toBe("frame-ancestors 'none'");
});
```

Then in `web/src/hooks.server.ts`:

```ts
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  // HSTS is Cloudflare's job (OPERATIONS.md checklist), so a typo here cannot pin a broken policy.
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  return response;
};
```

- [ ] **Step 7: Run the gate**

Run: `bash scripts/test-hooks.sh && cd web && npm test && npm run check && npm run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add pocketbase/pb_hooks/crew.js pocketbase/pb_hooks/config.pb.js pocketbase/pb_hooks/access.pb.js pocketbase/pb_hooks/edge.pb.js web/src/hooks.server.ts web/tests/unit/oauthDecision.test.ts web/tests/hooks/access.test.ts web/tests/hooks/edge.test.ts web/tests/e2e/layout.spec.ts
git status --short
git commit -m "feat(access): sign-in guards, serve-time mail/OAuth config, tunnel blocks the superuser surface

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Boarding: guest endpoints, decoys, Google requests, sweeps

**Files:**
- Create: `pocketbase/pb_hooks/boarding.js`, `pocketbase/pb_hooks/boarding.pb.js`
- Test: `web/tests/hooks/boarding.test.ts`, `web/tests/hooks/oauth.test.ts`. The latter drives the
  real OAuth2 hook through PocketBase's generic `oidc` provider pointed at the fake on 12528.

**Interfaces:**
- **Consumes:** everything `crew.js` produces, plus `limits.consume` and `names.js`.
- **Produces, routes:**
  - `POST /api/crawl/join {name, email, turnstile}` → 200 `{request_id, secret}`;
  - `POST /api/crawl/join/verify {request_id, secret, code}` → 200 `{status: 'waiting'}`;
  - `POST /api/crawl/join/status {request_id, secret}` → `{status}`;
  - `POST /api/crawl/join/resend {request_id, secret}` → 200 `{}`.
- **Produces:** OAuth2 sign-ups answer 202 `{pending: true, request_id, secret}`.
- **Produces, crons:** `boarding_sweep` (`*/5 * * * *`) and `crew_access_daily` (`17 3 * * *`).
- **Produces, from `boarding.js`:** `notifyConductors(app)` and `sweep(app)`, used by Task 6.

- [ ] **Step 1: Write the failing tests**

`web/tests/hooks/boarding.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { PB, clearMails, codeFor, loginToken, mailMode, mails, postFrom, randomIp, runCron, superuserToken, truncate, turnstileToken, waitFor } from './setup';

const uid = () => Math.floor(Math.random() * 1e6);
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
const join = (ip: string, body: Record<string, unknown>) => postFrom(ip, '/api/crawl/join', { turnstile: turnstileToken(), ...body });
/** Requests written directly by the superuser, to reach the global caps without 20 IPs of joins. */
async function seedRequests(count: number, status: 'unverified' | 'waiting') {
  for (let i = 0; i < count; i++) await fetch(`${PB}/api/collections/boarding_requests/records`, { method: 'POST', headers: await su(),
    body: JSON.stringify({ name: `Seed ${uid()}`, name_key: `seed ${uid()}`, email: `seed${uid()}@test.invalid`, method: 'email', status,
      ip: randomIp(), status_at: new Date().toISOString().replace('T', ' '), code_sent_at: new Date().toISOString().replace('T', ' ') }) });
}
async function verified(ip: string, name = `Waiter ${uid()}`) {
  const email = `v${uid()}@test.invalid`;
  const r = await (await join(ip, { name, email })).json();
  return postFrom(ip, '/api/crawl/join/verify', { ...r, code: await codeFor(email) });
}
async function row(id: string) { return (await fetch(`${PB}/api/collections/boarding_requests/records/${id}`, { headers: await su() })).json(); }
async function backdate(id: string, field: 'status_at' | 'code_sent_at', minutes: number) {
  await fetch(`${PB}/api/collections/boarding_requests/records/${id}`, { method: 'PATCH', headers: await su(),
    body: JSON.stringify({ [field]: new Date(Date.now() - minutes * 60e3).toISOString().replace('T', ' ') }) });
}

describe('joining by email (spec §2.1–2.4)', () => {
  // The global caps (10 unverified, 20 waiting) would otherwise fill up across tests.
  beforeEach(async () => { await mailMode('ok'); await clearMails(); await truncate('boarding_requests'); });

  it('sends a code, verifies it once, and the request waits; replay is refused', async () => {
    const ip = randomIp(), email = `new${uid()}@test.invalid`;
    const res = await join(ip, { name: `Newbie ${uid()}`, email: `  ${email.toUpperCase()}  ` });
    expect(res.status).toBe(200);
    const { request_id, secret } = await res.json();
    const code = await codeFor(email);
    expect((await postFrom(ip, '/api/crawl/join/status', { request_id, secret }).then((r) => r.json())).status).toBe('unverified');
    expect((await postFrom(ip, '/api/crawl/join/verify', { request_id, secret, code })).status).toBe(200);
    expect((await row(request_id)).status).toBe('waiting');
    expect((await postFrom(ip, '/api/crawl/join/verify', { request_id, secret, code })).status).toBe(410);
    expect((await row(request_id)).status).toBe('waiting');
  });

  it('refuses a failed Turnstile, a bad name and a bad email', async () => {
    const ip = randomIp();
    expect((await join(ip, { name: 'Robot', email: `r${uid()}@test.invalid`, turnstile: 'nope' })).status).toBe(400);
    expect((await join(ip, { name: 'x', email: `r${uid()}@test.invalid` })).status).toBe(400);
    expect((await join(ip, { name: 'Fine Name', email: 'not-an-email' })).status).toBe(400);
  });

  it('refuses a name that differs from a member only by case and spacing', async () => {
    const n = uid();
    await loginToken(`Bob Smith${n}`);
    expect((await join(randomIp(), { name: `  bob   SMITH${n} `, email: `b${n}@test.invalid` })).status).toBe(409);
  });

  it('limits one IP to 5 joins an hour and 2 open unverified requests', async () => {
    const ip = randomIp();
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await join(ip, { name: `Flood ${uid()}`, email: `f${uid()}@test.invalid` })).status);
    expect(statuses.slice(0, 2)).toEqual([200, 200]);
    expect(statuses[2]).toBe(429); // unverified cap per IP
    expect(statuses[5]).toBe(429); // hourly join limit
  });

  it('wrong codes count; the sixth try and an expired code are refused', async () => {
    const ip = randomIp(), email = `w${uid()}@test.invalid`;
    const { request_id, secret } = await (await join(ip, { name: `Wrong ${uid()}`, email })).json();
    for (let i = 0; i < 5; i++) expect((await postFrom(ip, '/api/crawl/join/verify', { request_id, secret, code: '000000' })).status).toBe(400);
    expect((await postFrom(ip, '/api/crawl/join/verify', { request_id, secret, code: await codeFor(email) })).status).toBe(410);
    const second = await (await join(randomIp(), { name: `Late ${uid()}`, email: `l${uid()}@test.invalid` })).json();
    await backdate(second.request_id, 'code_sent_at', 16);
    expect((await postFrom(ip, '/api/crawl/join/verify', { ...second, code: '123456' })).status).toBe(410);
  });

  it('a wrong secret is a 404 everywhere', async () => {
    const ip = randomIp();
    const { request_id } = await (await join(ip, { name: `Secret ${uid()}`, email: `s${uid()}@test.invalid` })).json();
    for (const path of ['status', 'verify', 'resend']) expect((await postFrom(ip, `/api/crawl/join/${path}`, { request_id, secret: 'x', code: '1' })).status).toBe(404);
  });

  it('resend is throttled to once a minute, then rotates the code', async () => {
    const ip = randomIp(), email = `a${uid()}@test.invalid`;
    const r = await (await join(ip, { name: `Again ${uid()}`, email })).json();
    expect((await postFrom(ip, '/api/crawl/join/resend', r)).status).toBe(429);
    const old = await codeFor(email);
    await backdate(r.request_id, 'code_sent_at', 2);
    expect((await postFrom(ip, '/api/crawl/join/resend', r)).status).toBe(200);
    const fresh = await waitFor(async () => { const c = await codeFor(email); return c !== old && c; });
    expect((await postFrom(ip, '/api/crawl/join/verify', { ...r, code: old })).status).toBe(400);
    expect((await postFrom(ip, '/api/crawl/join/verify', { ...r, code: fresh })).status).toBe(200);
  });

  it('concurrent joins from one IP cannot beat the unverified cap', async () => {
    const ip = randomIp();
    const statuses = await Promise.all([1, 2, 3, 4].map(() => join(ip, { name: `Race ${uid()}`, email: `race${uid()}@test.invalid` }).then((r) => r.status)));
    expect(statuses.filter((x) => x === 200)).toHaveLength(2);
  });

  it('the global caps hold: 10 unverified at join, 20 waiting at verify', async () => {
    await seedRequests(10, 'unverified');
    expect((await join(randomIp(), { name: `Late ${uid()}`, email: `l${uid()}@test.invalid` })).status).toBe(429);
    await truncate('boarding_requests');
    await seedRequests(20, 'waiting');
    expect((await verified(randomIp())).status).toBe(429);
  });

  it('one IP keeps at most 3 requests waiting', async () => {
    const ip = randomIp();
    for (let i = 0; i < 3; i++) expect((await verified(ip)).status).toBe(200);
    expect((await verified(ip)).status).toBe(429);
  });

  it('an unverified request holds no name; the second to verify a shared name loses it', async () => {
    const shared = `Twin ${uid()}`, ip1 = randomIp(), ip2 = randomIp(), e1 = `t1${uid()}@test.invalid`, e2 = `t2${uid()}@test.invalid`;
    const a = await (await join(ip1, { name: shared, email: e1 })).json();
    const b = await join(ip2, { name: shared, email: e2 });
    expect(b.status).toBe(200);
    expect((await postFrom(ip1, '/api/crawl/join/verify', { ...a, code: await codeFor(e1) })).status).toBe(200);
    expect((await postFrom(ip2, '/api/crawl/join/verify', { ...(await b.json()), code: await codeFor(e2) })).status).toBe(409);
  });

  it('repeat sign-ups return the same request id, for a member address and a fresh one alike', async () => {
    const n = uid();
    await loginToken(`Repeat ${n}`);
    const memberEmail = `${Buffer.from(`repeat ${n}`).toString('hex')}@test.invalid`, freshEmail = `fresh2${n}@test.invalid`;
    for (const email of [memberEmail, freshEmail]) {
      const one = await (await join(randomIp(), { name: `One ${uid()}`, email })).json();
      const two = await (await join(randomIp(), { name: `Two ${uid()}`, email })).json();
      expect(two.request_id, email).toBe(one.request_id);
    }
  });

  it('a member email gets a decoy that behaves like a real request, and a "you have a seat" mail', async () => {
    const n = uid();
    await loginToken(`Member ${n}`);
    const memberEmail = `${Buffer.from(`member ${n}`).toString('hex')}@test.invalid`;
    const ip = randomIp();
    const decoy = await join(ip, { name: `Other ${n}`, email: memberEmail }); // repeat-id parity is its own test above
    const fresh = await join(randomIp(), { name: `Fresh ${n}`, email: `fresh${n}@test.invalid` });
    expect(decoy.status).toBe(fresh.status);
    const d = await decoy.json(), f = await fresh.json();
    expect(Object.keys(d).sort()).toEqual(Object.keys(f).sort());
    expect((await postFrom(ip, '/api/crawl/join/status', d).then((r) => r.json())).status).toBe('unverified');
    expect((await postFrom(ip, '/api/crawl/join/verify', { ...d, code: '123456' })).status).toBe(400);
    expect((await mails(memberEmail)).at(-1)?.text).toContain('already have a seat');
    const crew = await loginToken(`Viewer ${n}`);
    const list = await (await fetch(`${PB}/api/collections/boarding_requests/records?perPage=200`, { headers: { Authorization: crew.token } })).json();
    expect(list.items.some((x: { id: string }) => x.id === d.request_id)).toBe(false);
  });

  it('a second sign-up for a waiting email leaves the waiting request untouched', async () => {
    const ip = randomIp(), email = `twice${uid()}@test.invalid`;
    const first = await (await join(ip, { name: `Twice ${uid()}`, email })).json();
    await postFrom(ip, '/api/crawl/join/verify', { ...first, code: await codeFor(email) });
    await clearMails();
    const again = await join(randomIp(), { name: `Twice Again ${uid()}`, email });
    expect(again.status).toBe(200);
    expect((await row(first.request_id)).status).toBe('waiting');
    expect((await mails(email)).at(-1)?.text).toContain('already waiting');
  });

  it('a mail failure answers 502 and expires the request', async () => {
    await mailMode('fail');
    const res = await join(randomIp(), { name: `NoMail ${uid()}`, email: `nomail${uid()}@test.invalid` });
    expect(res.status).toBe(502);
    await mailMode('ok');
  });

  it('the sweep expires unverified requests after 30 min', async () => {
    const r = await (await join(randomIp(), { name: `Stale ${uid()}`, email: `stale${uid()}@test.invalid` })).json();
    await backdate(r.request_id, 'status_at', 31);
    await runCron('boarding_sweep');
    await waitFor(async () => (await row(r.request_id)).status === 'expired');
  });
});
```

`web/tests/hooks/oauth.test.ts` exercises the real `onRecordAuthWithOAuth2Request` hook at runtime.
PocketBase's generic `oidc` provider is pointed at the fake on 12528, so no Google is needed:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PB, loginToken, oidcCode, post, superuserToken, truncate } from './setup';

const uid = () => Math.floor(Math.random() * 1e6);
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
const hexEmail = (name: string) => `${Buffer.from(name.toLowerCase()).toString('hex')}@test.invalid`;
const oauth = (code: string, extra: Record<string, unknown> = {}, token?: string) => post('/api/collections/users/auth-with-oauth2',
  { provider: 'oidc', code, codeVerifier: 'v'.repeat(43), redirectURL: 'http://127.0.0.1:15173/auth/google', ...extra }, token);
async function count(collection: string, filter: string) {
  const q = new URLSearchParams({ filter, perPage: '1' });
  return (await (await fetch(`${PB}/api/collections/${collection}/records?${q}`, { headers: await su() })).json()).totalItems as number;
}

describe('the OAuth2 hook (spec §2.5), at runtime', () => {
  beforeAll(async () => {
    const res = await fetch(`${PB}/api/collections/users`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ oauth2: { enabled: true, providers: [{
      name: 'oidc', clientId: 'fake', clientSecret: 'fake', displayName: 'Fake', authURL: 'http://127.0.0.1:12528/auth',
      tokenURL: 'http://127.0.0.1:12528/token', userInfoURL: 'http://127.0.0.1:12528/userinfo' }] } }) });
    expect(res.status).toBe(200);
  });
  afterAll(async () => {
    await fetch(`${PB}/api/collections/users`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ oauth2: { enabled: false, providers: [] } }) });
  });
  beforeEach(() => truncate('boarding_requests'));

  it('a new identity from the join page becomes a waiting request: no user, no link', async () => {
    const email = `g${uid()}@test.invalid`, sub = `s${uid()}`;
    const res = await oauth(oidcCode({ sub, email }), { createData: { name: `Googler ${uid()}` } });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ pending: true });
    expect(await count('users', `email = "${email}"`)).toBe(0);
    expect(await count('_externalAuths', `providerId = "${sub}"`)).toBe(0);
    expect(await count('boarding_requests', `email = "${email}" && status = "waiting" && method = "google"`)).toBe(1);
  });

  it('a new identity from the login page is refused', async () => {
    const res = await oauth(oidcCode({ sub: `s${uid()}`, email: `nobody${uid()}@test.invalid` }));
    expect(res.status).toBe(403);
  });

  it('a member signs in with the matching email', async () => {
    const name = `Linked ${uid()}`;
    const { id } = await loginToken(name);
    const res = await oauth(oidcCode({ sub: `s${uid()}`, email: hexEmail(name) }));
    expect(res.status).toBe(200);
    expect((await res.json()).record.id).toBe(id);
  });

  it('a crew session cannot attach a Google identity with another email', async () => {
    const name = `Hijack ${uid()}`;
    const { id, token } = await loginToken(name);
    const res = await oauth(oidcCode({ sub: `s${uid()}`, email: `other${uid()}@test.invalid` }), {}, token);
    expect(res.status).toBe(403);
    expect(await count('_externalAuths', `recordRef = "${id}"`)).toBe(0);
  });

  it('refuses blocked members and unverified emails', async () => {
    const name = `Benched ${uid()}`;
    const { id } = await loginToken(name);
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ blocked: true }) });
    expect((await oauth(oidcCode({ sub: `s${uid()}`, email: hexEmail(name) }))).status).toBe(403);
    expect((await oauth(oidcCode({ sub: `s${uid()}`, email: `u${uid()}@test.invalid`, email_verified: false }), { createData: { name: `Unverified ${uid()}` } })).status).toBe(403);
  });
});
```

Run: `bash scripts/test-hooks.sh`
Expected: FAIL: 404 on `/api/crawl/join`, and the OAuth tests fail.

- [ ] **Step 2: Write `boarding.js` (guest half)**

`pocketbase/pb_hooks/boarding.js`:

```js
// Boarding (spec §2): how a stranger becomes crew. Guests file a request; any approved crew
// member decides (decide, Task 6). A decoy is a real row that can never verify, used whenever
// telling the truth would reveal that an email is a member or already waiting.
const OPEN = ['unverified', 'waiting']
const nowIso = () => new Date().toISOString()
const ago = (minutes) => new Date(Date.now() - minutes * 60e3).toISOString().replace('T', ' ')

exports.turnstileOk = function (secret, token, ip) {
  if (!token) return false
  try {
    const res = $http.send({
      url: $os.getenv('TURNSTILE_VERIFY_URL') || 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      method: 'POST', timeout: 10,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'secret=' + encodeURIComponent(secret) + '&response=' + encodeURIComponent(token) + '&remoteip=' + encodeURIComponent(ip)
    })
    return res.statusCode === 200 && !!(res.json && res.json.success)
  } catch (_) { return false }
}

exports.findRequest = function (body) {
  const crew = require(`${__hooks}/crew.js`)
  if (typeof body.request_id !== 'string' || typeof body.secret !== 'string') return null
  let r
  try { r = $app.findRecordById('boarding_requests', body.request_id) } catch (_) { return null }
  return $security.equal(r.getString('secret_hash'), crew.hash(body.secret)) ? r : null
}

// Shared by email sign-up (join) and Google sign-up (the OAuth2 hook). Returns [status, json].
// Every check and the write share one transaction: PocketBase serialises write transactions, so
// two concurrent joins cannot both pass a cap or both claim a name.
exports.fileRequest = function (e, x) {
  const crew = require(`${__hooks}/crew.js`)
  const { name, email, method, info } = x
  const ip = info.ip
  const secret = $security.randomString(43)
  const code = $security.randomStringWithAlphabet(6, '0123456789')
  let outcome = '', record = null, member = false, decoy = false
  $app.runInTransaction((tx) => {
    const n = (filter, params) => tx.findRecordsByFilter('boarding_requests', filter, '', 0, 0, params || {}).length
    const unverifiedFull = n("status = 'unverified' && ip = {:ip}", { ip }) >= 2 || n("status = 'unverified'") >= 10
    const waitingFull = n("status = 'waiting' && ip = {:ip}", { ip }) >= 3 || n("status = 'waiting'") >= 20
    if ((method === 'email' && unverifiedFull) || waitingFull) { outcome = 'full'; return }
    // A name is held by users and waiting requests only, and is checked by name alone. Unverified
    // requests hold nothing (verify re-checks), so no answer here depends on the email.
    let taken = false
    try { tx.findFirstRecordByData('users', 'name_key', name.key); taken = true } catch (_) {}
    if (!taken) taken = n("name_key = {:k} && decoy = false && status = 'waiting'", { k: name.key }) > 0
    if (taken) { outcome = 'taken'; return }
    try { tx.findAuthRecordByEmail('users', email); member = true } catch (_) {}
    decoy = member || n("email = {:e} && status = 'waiting' && decoy = false", { e: email }) > 0
    // A repeat sign-up updates the open unverified request for this email in place, decoy or not,
    // so every address answers a second sign-up with the same request id.
    const open = tx.findRecordsByFilter('boarding_requests', "email = {:e} && status = 'unverified' && decoy = " + (decoy ? 'true' : 'false'), '-created', 1, 0, { e: email })
    record = open.length ? open[0] : new Record(tx.findCollectionByNameOrId('boarding_requests'))
    record.set('name', name.display)
    record.set('name_key', name.key)
    record.set('email', email)
    record.set('method', method)
    record.set('decoy', decoy)
    record.set('status', decoy || method === 'email' ? 'unverified' : 'waiting')
    record.set('status_at', nowIso())
    record.set('secret_hash', crew.hash(secret))
    record.set('code_hash', decoy ? crew.hash($security.randomString(32)) : (method === 'email' ? crew.hash(code) : ''))
    record.set('code_attempts', 0)
    record.set('code_sent_at', nowIso())
    for (const k of ['ip', 'country', 'city', 'user_agent']) record.set(k, info[k])
    tx.save(record)
    outcome = 'ok'
  })
  if (outcome === 'full') {
    crew.logEvent($app, { event: 'rate_limited', detail: 'boarding caps', name: name.display }, info)
    return [429, { message: 'Too many people are waiting to board. Try again later.' }]
  }
  if (outcome === 'taken') return [409, { message: 'That name is taken. Add an initial?' }]
  try {
    if (decoy) crew.sendMail($app, member
      ? { to: [email], subject: 'You already have a seat', text: `Someone tried to board the Chug-a-Lug with this address. You already have a seat: sign in at ${$app.settings().meta.appURL}/login` }
      : { to: [email], subject: 'Your boarding request is already waiting', text: 'Your boarding request is already waiting for the crew. Nothing else to do: you will get an email when you are aboard.' })
    else if (method === 'email') crew.sendMail($app, { to: [email], subject: 'Your Chug-a-Lug boarding code', text: `Your Chug-a-Lug boarding code: ${code}\n\nIt works for 15 minutes.` })
  } catch (err) {
    // Expire only the version written above: a concurrent re-signup may already have replaced it.
    $app.runInTransaction((tx) => {
      const r = tx.findRecordById('boarding_requests', record.id)
      if (r.getString('secret_hash') === crew.hash(secret) && OPEN.indexOf(r.getString('status')) >= 0) { r.set('status', 'expired'); r.set('status_at', nowIso()); tx.save(r) }
    })
    crew.logEvent($app, { event: 'mail_failed', email, request: record.id, detail: String(err).slice(0, 200) }, info)
    return [502, { message: "Couldn't send the email. Try Google or try later." }]
  }
  crew.logEvent($app, { event: 'boarding_requested', method, name: name.display, email, request: record.id }, info)
  if (!decoy && method === 'google') exports.notifyConductors($app)
  return [method === 'google' ? 202 : 200, method === 'google' ? { pending: true, request_id: record.id, secret } : { request_id: record.id, secret }]
}

exports.join = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const limits = require(`${__hooks}/limits.js`)
  const normalizeName = require(`${__hooks}/names.js`)
  const info = crew.clientInfo(e)
  const body = e.requestInfo().body
  if (!limits.consume('join:' + info.ip, 5, 3600)) {
    crew.logEvent($app, { event: 'rate_limited', detail: 'join' }, info)
    return e.json(429, { message: 'Too many attempts. Try again in an hour.' })
  }
  const secret = $os.getenv('TURNSTILE_SECRET')
  if (!secret) return e.json(503, { message: 'Boarding is not configured on the server.' })
  if (!exports.turnstileOk(secret, typeof body.turnstile === 'string' ? body.turnstile : '', info.ip)) {
    crew.logEvent($app, { event: 'turnstile_failed' }, info)
    return e.json(400, { message: "Couldn't confirm you're human. Try again." })
  }
  const name = normalizeName(body.name)
  if (!name) return e.json(400, { message: "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -" })
  const email = crew.normalizeEmail(body.email)
  if (!email) return e.json(400, { message: 'Enter a valid email address.' })
  const [status, json] = exports.fileRequest(e, { name, email, method: 'email', info })
  return e.json(status, json)
}

// The secret, the state, the code and the transition are judged on one transactional read, so a
// concurrent re-signup (new secret) or decision cannot slip between check and write. Promotion to
// waiting re-checks the waiting caps and the name, which unverified requests never held.
exports.verify = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const body = e.requestInfo().body
  if (typeof body.request_id !== 'string' || typeof body.secret !== 'string') return e.json(404, { message: 'Request not found.' })
  let outcome = 'missing', request = null
  $app.runInTransaction((tx) => {
    let r
    try { r = tx.findRecordById('boarding_requests', body.request_id) } catch (_) { return }
    if (!$security.equal(r.getString('secret_hash'), crew.hash(body.secret))) return
    request = r
    const age = Date.now() / 1000 - r.getDateTime('code_sent_at').unix()
    if (r.getString('status') !== 'unverified' || r.getInt('code_attempts') >= 5 || age > 900) { outcome = 'expired'; return }
    r.set('code_attempts', r.getInt('code_attempts') + 1)
    const good = !r.getBool('decoy') && r.getString('code_hash') !== '' && $security.equal(r.getString('code_hash'), crew.hash(String(body.code || '')))
    const n = (filter, params) => tx.findRecordsByFilter('boarding_requests', filter, '', 0, 0, params || {}).length
    if (!good) outcome = 'wrong'
    else if (n("status = 'waiting' && ip = {:ip}", { ip: r.getString('ip') }) >= 3 || n("status = 'waiting'") >= 20) outcome = 'full'
    else {
      let taken = false
      try { tx.findFirstRecordByData('users', 'name_key', r.getString('name_key')); taken = true } catch (_) {}
      if (!taken) taken = n("name_key = {:k} && decoy = false && status = 'waiting'", { k: r.getString('name_key') }) > 0
      if (taken) outcome = 'taken'
      else { r.set('code_hash', ''); r.set('status', 'waiting'); r.set('status_at', nowIso()); outcome = 'ok' }
    }
    tx.save(r)
  })
  if (outcome === 'missing') return e.json(404, { message: 'Request not found.' })
  if (outcome === 'expired') return e.json(410, { message: 'That code expired. Start again.' })
  if (outcome === 'wrong') return e.json(400, { message: "That code isn't right." })
  if (outcome === 'full') return e.json(429, { message: 'Too many people are waiting to board. Try again later.' })
  if (outcome === 'taken') return e.json(409, { message: 'That name was just taken. Board again with another.' })
  crew.logEvent($app, { event: 'boarding_verified', method: 'email', email: request.getString('email'), name: request.getString('name'), request: request.id }, crew.clientInfo(e))
  try { exports.notifyConductors($app) } catch (_) { /* the sweep retries */ }
  return e.json(200, { status: 'waiting' })
}

exports.status = function (e) {
  const r = exports.findRequest(e.requestInfo().body)
  if (!r) return e.json(404, { message: 'Request not found.' })
  return e.json(200, { status: r.getString('status') })
}

// Transactional for the same reason as verify. The once-a-minute rule lives in code_sent_at, so
// tests can backdate it.
exports.resend = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const body = e.requestInfo().body
  if (typeof body.request_id !== 'string' || typeof body.secret !== 'string') return e.json(404, { message: 'Request not found.' })
  const code = $security.randomStringWithAlphabet(6, '0123456789')
  let outcome = 'missing', email = '', decoy = false
  $app.runInTransaction((tx) => {
    let r
    try { r = tx.findRecordById('boarding_requests', body.request_id) } catch (_) { return }
    if (!$security.equal(r.getString('secret_hash'), crew.hash(body.secret))) return
    if (r.getString('status') !== 'unverified') { outcome = 'closed'; return }
    if (Date.now() / 1000 - r.getDateTime('code_sent_at').unix() < 60) { outcome = 'early'; return }
    decoy = r.getBool('decoy')
    if (!decoy) r.set('code_hash', crew.hash(code))
    r.set('code_attempts', 0)
    r.set('code_sent_at', nowIso())
    tx.save(r)
    email = r.getString('email')
    outcome = 'ok'
  })
  if (outcome === 'missing') return e.json(404, { message: 'Request not found.' })
  if (outcome === 'closed') return e.json(410, { message: 'That request is no longer open.' })
  if (outcome === 'early') return e.json(429, { message: 'Wait a minute before asking again.' })
  try {
    if (decoy) crew.sendMail($app, { to: [email], subject: 'You already have a seat', text: `You already have a seat: sign in at ${$app.settings().meta.appURL}/login` })
    else crew.sendMail($app, { to: [email], subject: 'Your Chug-a-Lug boarding code', text: `Your Chug-a-Lug boarding code: ${code}\n\nIt works for 15 minutes.` })
  } catch (_) { return e.json(502, { message: "Couldn't send the email. Try later." }) }
  return e.json(200, {})
}

// Spec §2.5: called from onRecordAuthWithOAuth2Request. Returns true when it answered the request.
exports.googleRequest = function (e) {
  const crew = require(`${__hooks}/crew.js`)
  const limits = require(`${__hooks}/limits.js`)
  const normalizeName = require(`${__hooks}/names.js`)
  const info = crew.clientInfo(e)
  const u = e.oAuth2User
  const raw = (u && u.rawUser) || {}
  const decision = crew.oauthDecision({
    isNewRecord: e.isNewRecord, hasName: !!(e.createData && e.createData.name), blocked: !!(e.record && e.record.getBool('blocked')),
    recordEmail: e.record ? e.record.email() : '', oauthEmail: (u && u.email) || '', oauthEmailVerified: raw.email_verified === true || raw.verified_email === true
  })
  const refuse = (message, detail) => { crew.logEvent($app, { event: 'sign_in_refused', method: 'google', email: (u && u.email) || '', detail }, info); e.json(403, { message }); return true }
  if (decision === 'continue') return false
  if (decision === 'refuse_unverified') return refuse("Google hasn't verified this email.", 'unverified google email')
  if (decision === 'refuse_new') return refuse('No seat for this Google account yet. Board first.', 'no account')
  if (decision === 'refuse_blocked') return refuse('Your seat was taken away. Ask the Conductor.', 'blocked')
  if (decision === 'refuse_mismatch') return refuse("This Google account's email doesn't match your seat. Use an email code.", 'email mismatch')
  // decision === 'request'
  if (!limits.consume('join:' + info.ip, 5, 3600)) { crew.logEvent($app, { event: 'rate_limited', detail: 'join' }, info); e.json(429, { message: 'Too many attempts. Try again in an hour.' }); return true }
  const name = normalizeName(e.createData.name)
  if (!name) { e.json(400, { message: "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -" }); return true }
  const email = crew.normalizeEmail(u.email)
  if (!email) { e.json(400, { message: "Google didn't share an email address." }); return true }
  const [status, json] = exports.fileRequest(e, { name, email, method: 'google', info })
  e.json(status, json)
  return true
}

exports.sweep = function (app) {
  for (const r of app.findRecordsByFilter('boarding_requests', "status = 'unverified' && status_at < {:t}", '', 0, 0, { t: ago(30) })
    .concat(app.findRecordsByFilter('boarding_requests', "status = 'waiting' && status_at < {:t}", '', 0, 0, { t: ago(72 * 60) }))) {
    r.set('status', 'expired'); r.set('status_at', nowIso()); app.save(r)
  }
  exports.notifyConductors(app)
}

exports.daily = function (app) {
  app.db().newQuery('DELETE FROM access_log WHERE created < {:t}').bind({ t: ago(90 * 24 * 60) }).execute()
  app.db().newQuery('DELETE FROM access_log WHERE id NOT IN (SELECT id FROM access_log ORDER BY created DESC LIMIT 10000)').execute()
}

// Task 6 replaces this stub with the real batched mail.
exports.notifyConductors = function (app) {}
```

- [ ] **Step 3: Register the routes, the OAuth2 hook and the crons**

`pocketbase/pb_hooks/boarding.pb.js`:

```js
// Boarding routes (spec §2). Guests only need the request id and secret they were handed.
routerAdd('POST', '/api/crawl/join', (e) => require(`${__hooks}/boarding.js`).join(e))
routerAdd('POST', '/api/crawl/join/verify', (e) => require(`${__hooks}/boarding.js`).verify(e))
routerAdd('POST', '/api/crawl/join/status', (e) => require(`${__hooks}/boarding.js`).status(e))
routerAdd('POST', '/api/crawl/join/resend', (e) => require(`${__hooks}/boarding.js`).resend(e))

// Google: a new identity becomes a boarding request, never a user; an existing one must match
// its seat's email. Skipping e.next() means PocketBase creates no record and no link.
onRecordAuthWithOAuth2Request((e) => {
  if (require(`${__hooks}/boarding.js`).googleRequest(e)) return
  e.next()
}, 'users')

cronAdd('boarding_sweep', '*/5 * * * *', () => require(`${__hooks}/boarding.js`).sweep($app))
cronAdd('crew_access_daily', '17 3 * * *', () => require(`${__hooks}/boarding.js`).daily($app))
```

- [ ] **Step 4: Run the hooks suite**

Run: `bash scripts/test-hooks.sh`
Expected: PASS for `boarding.test.ts` and `oauth.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add pocketbase/pb_hooks/boarding.js pocketbase/pb_hooks/boarding.pb.js web/tests/hooks/boarding.test.ts web/tests/hooks/oauth.test.ts
git status --short
git commit -m "feat(access): boarding requests — email codes, decoys, caps, Google sign-up, sweeps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Decisions, Conductor notifications, put off, manifest, name changes

**Files:**
- Create: `pocketbase/pb_hooks/access.js`
- Modify: `pocketbase/pb_hooks/boarding.js` (`decide`, the real `notifyConductors`),
  `pocketbase/pb_hooks/boarding.pb.js`, `pocketbase/pb_hooks/access.pb.js`
- Test: `web/tests/hooks/decisions.test.ts`

**Interfaces:**
- **Produces, routes:**
  - `POST /api/crawl/boarding/{id}/let-aboard` → 200 `{user_id}`; 409 when already answered;
  - `POST /api/crawl/boarding/{id}/turn-away` → 200 `{}`;
  - `POST /api/crawl/users/{id}/put-off` and `/let-back-on` → 200 `{}`;
  - `GET /api/crawl/manifest` → `{people: Person[], requests: Req[], log: LogRow[]}`.
- **Produces, response shapes:**
  - `Person = {id, name, email, is_admin, blocked, approved_by, last_seen, created}`;
  - `Req = {id, name, email, method, status, country, city, user_agent, created, decided_by}`;
  - `LogRow = {id, created, event, method, name, email, user, actor, ip, country, city, user_agent, detail}`.

  `user`, `actor`, `decided_by` and `approved_by` are **names**.

- [ ] **Step 1: Write the failing tests**

`web/tests/hooks/decisions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, clearMails, codeFor, loginToken, mailMode, mails, post, postFrom, randomIp, runCron, superuserToken, truncate, turnstileToken, waitFor } from './setup';

const uid = () => Math.floor(Math.random() * 1e6);
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
async function waitingRequest(name = `Guest ${uid()}`) {
  const ip = randomIp(), email = `g${uid()}@test.invalid`;
  const r = await (await postFrom(ip, '/api/crawl/join', { name, email, turnstile: turnstileToken() })).json();
  await postFrom(ip, '/api/crawl/join/verify', { ...r, code: await codeFor(email) });
  return { ...r, email, name, ip };
}
const decide = (id: string, verdict: 'let-aboard' | 'turn-away', token?: string) => post(`/api/crawl/boarding/${id}/${verdict}`, {}, token);

describe('deciding boarding requests (spec §2.6–2.7)', () => {
  beforeEach(async () => { await mailMode('ok'); await clearMails(); await truncate('boarding_requests'); });
  afterEach(() => mailMode('ok'));

  it('any crew member lets a guest aboard; the guest then signs in by code', async () => {
    const crew = await loginToken(`Voucher ${uid()}`);
    const g = await waitingRequest();
    const res = await decide(g.request_id, 'let-aboard', crew.token);
    expect(res.status).toBe(200);
    const user = await (await fetch(`${PB}/api/collections/users/records/${(await res.json()).user_id}`, { headers: await su() })).json();
    expect(user).toMatchObject({ email: g.email, verified: true, approved_by: crew.id, name: g.name });
    expect((await mails(g.email)).at(-1)?.subject).toContain('aboard');
    expect((await postFrom(g.ip, '/api/crawl/join/status', g).then((r) => r.json())).status).toBe('aboard');
    await clearMails();
    const { otpId } = await (await post('/api/collections/users/request-otp', { email: g.email })).json();
    expect((await post('/api/collections/users/auth-with-otp', { otpId, password: await codeFor(g.email) })).status).toBe(200);
  });

  it('a double decision gets one 200 and one 409, even when sent together', async () => {
    const a = await loginToken(`Fast ${uid()}`), b = await loginToken(`Slow ${uid()}`);
    const g = await waitingRequest();
    const statuses = (await Promise.all([decide(g.request_id, 'let-aboard', a.token), decide(g.request_id, 'turn-away', b.token)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('guests and blocked crew cannot decide', async () => {
    const g = await waitingRequest();
    expect((await decide(g.request_id, 'let-aboard')).status).toBe(401);
    const blocked = await loginToken(`Benched ${uid()}`);
    await fetch(`${PB}/api/collections/users/records/${blocked.id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ blocked: true }) });
    expect((await decide(g.request_id, 'let-aboard', blocked.token)).status).toBe(401);
  });

  it('crew see waiting and recently decided requests only; guests see none', async () => {
    const crew = await loginToken(`Reader ${uid()}`);
    const g = await waitingRequest();
    const list = async (token?: string) => (await (await fetch(`${PB}/api/collections/boarding_requests/records?perPage=500`, { headers: token ? { Authorization: token } : {} })).json()).items as any[];
    expect((await list()).length).toBe(0);
    expect((await list(crew.token)).some((x) => x.id === g.request_id && x.status === 'waiting')).toBe(true);
    await decide(g.request_id, 'turn-away', crew.token);
    expect((await list(crew.token)).some((x) => x.id === g.request_id && x.status === 'turned_away')).toBe(true);
  });

  it('a Conductor notice that fails to send is retried by the sweep', async () => {
    // The code must reach the guest first; only the notice at verify time should fail.
    const ip = randomIp(), email = `n${uid()}@test.invalid`;
    const r = await (await postFrom(ip, '/api/crawl/join', { name: `Notice ${uid()}`, email, turnstile: turnstileToken() })).json();
    const code = await codeFor(email);
    await mailMode('fail');
    expect((await postFrom(ip, '/api/crawl/join/verify', { ...r, code })).status).toBe(200); // the decision path never fails on mail
    await mailMode('ok');
    await clearMails();
    await runCron('boarding_sweep');
    await waitFor(async () => (await mails('conductor@test.invalid')).some((m) => m.text.includes(email)), 10_000);
  });

  it('a failed "you are aboard" email still lets the guest aboard', async () => {
    const crew = await loginToken(`Mailless ${uid()}`);
    const g = await waitingRequest();
    await mailMode('fail');
    expect((await decide(g.request_id, 'let-aboard', crew.token)).status).toBe(200);
  });
});

describe('put off, manifest and names (spec §2.9–2.11)', () => {
  it('only a Conductor puts someone off; their token dies; no self put-off', async () => {
    const boss = await loginToken(`Chief ${uid()}`, ADMIN_LOGIN_PASSWORD);
    const rider = await loginToken(`Rider ${uid()}`);
    expect((await post(`/api/crawl/users/${boss.id}/put-off`, {}, rider.token)).status).toBe(403);
    expect((await post(`/api/crawl/users/${boss.id}/put-off`, {}, boss.token)).status).toBe(400);
    expect((await post(`/api/crawl/users/${rider.id}/put-off`, {}, boss.token)).status).toBe(200);
    expect((await fetch(`${PB}/api/collections/users/records`, { headers: { Authorization: rider.token } })).status).toBe(401);
    expect((await post(`/api/crawl/users/${rider.id}/let-back-on`, {}, boss.token)).status).toBe(200);
  });

  it('the manifest shows emails to Conductors only', async () => {
    const boss = await loginToken(`Lister ${uid()}`, ADMIN_LOGIN_PASSWORD);
    const rider = await loginToken(`Peeker ${uid()}`);
    expect((await fetch(`${PB}/api/crawl/manifest`, { headers: { Authorization: rider.token } })).status).toBe(403);
    const m = await (await fetch(`${PB}/api/crawl/manifest`, { headers: { Authorization: boss.token } })).json();
    expect(m.people.find((p: { id: string }) => p.id === rider.id).email).toMatch(/@test\.invalid$/);
    expect(Array.isArray(m.log)).toBe(true);
  });

  it('a name change is normalised, unique and logged', async () => {
    const n = uid();
    const a = await loginToken(`Alpha ${n}`);
    await loginToken(`Taken ${n}`);
    const rename = (name: string) => fetch(`${PB}/api/collections/users/records/${a.id}`, { method: 'PATCH', headers: { Authorization: a.token, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    expect((await rename(`  taken   ${n} `)).status).toBe(409);
    expect((await rename('x')).status).toBe(400);
    const ok = await rename(`  Omega   ${n} `);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ name: `Omega ${n}`, name_key: `omega ${n}` });
  });
});
```

Run: `bash scripts/test-hooks.sh`
Expected: FAIL: 404 on the decision routes.

- [ ] **Step 2: Implement `decide` and the real `notifyConductors` in `boarding.js`**

Replace the `notifyConductors` stub and append `decide`:

```js
exports.notifyConductors = function (app) {
  const crew = require(`${__hooks}/crew.js`)
  const limits = require(`${__hooks}/limits.js`)
  const pending = app.findRecordsByFilter('boarding_requests', "status = 'waiting' && decoy = false && notified_at = ''", 'created', 50, 0)
  if (!pending.length) return
  const to = app.findRecordsByFilter('users', 'is_admin = true && verified = true && blocked = false', '', 20, 0).map((u) => u.email()).filter(Boolean)
  const interval = parseInt($os.getenv('NOTIFY_INTERVAL_SECONDS'), 10)
  if (!to.length || !limits.consume('notify', 1, isNaN(interval) ? 600 : interval)) return
  const lines = pending.map((r) => `• ${r.getString('name')} <${r.getString('email')}> — ${r.getString('user_agent').slice(0, 60)} · ${r.getString('country') || '??'} · ${r.getString('created')}`)
  try {
    crew.sendMail(app, { to, subject: `${pending.length} waiting to board the Chug-a-Lug`, text: `${lines.join('\n')}\n\nOpen the Crew Board to let them aboard: ${app.settings().meta.appURL}/crew` })
  } catch (err) {
    crew.logEvent(app, { event: 'mail_failed', detail: 'conductor notice: ' + String(err).slice(0, 180) })
    app.db().newQuery("DELETE FROM _crawl_limits WHERE key = 'notify'").execute() // let the sweep retry now
    return
  }
  for (const r of pending) { r.set('notified_at', new Date().toISOString()); app.save(r) }
}

exports.decide = function (e, verdict) {
  const crew = require(`${__hooks}/crew.js`)
  const auth = e.auth
  if (!auth || auth.collection().name !== 'users' || auth.getBool('blocked')) return e.json(401, { message: 'Sign in first.' })
  const id = e.request.pathValue('id')
  let result = null, user = null, request = null
  $app.runInTransaction((tx) => {
    try { request = tx.findRecordById('boarding_requests', id) } catch (_) { result = [404, 'Request not found.']; return }
    if (request.getBool('decoy') || request.getString('status') !== 'waiting') { result = [409, 'Someone already answered this one.']; return }
    if (verdict === 'aboard') {
      let clash = false
      try { tx.findFirstRecordByData('users', 'name_key', request.getString('name_key')); clash = true } catch (_) {}
      try { tx.findAuthRecordByEmail('users', request.getString('email')); clash = true } catch (_) {}
      if (clash) { result = [409, 'That name or email now belongs to someone aboard. Turn this one away.']; return }
      user = new Record(tx.findCollectionByNameOrId('users'))
      user.set('name', request.getString('name'))
      user.set('name_key', request.getString('name_key'))
      user.setEmail(request.getString('email'))
      user.setVerified(true)
      user.setPassword($security.randomString(40))
      user.set('approved_by', auth.id)
      tx.save(user)
      request.set('user', user.id)
    }
    request.set('status', verdict === 'aboard' ? 'aboard' : 'turned_away')
    request.set('status_at', new Date().toISOString())
    request.set('decided_by', auth.id)
    request.set('decided_at', new Date().toISOString())
    tx.save(request)
    crew.logEvent(tx, { event: verdict === 'aboard' ? 'let_aboard' : 'turned_away', actor: auth.id, user: user ? user.id : '', name: request.getString('name'), email: request.getString('email'), request: request.id }, crew.clientInfo(e))
  })
  if (result) return e.json(result[0], { message: result[1] })
  if (user) {
    try { crew.sendMail($app, { to: [user.email()], subject: "You're aboard the Chug-a-Lug", text: `You're aboard! Sign in at ${$app.settings().meta.appURL}/login with this email address or Google.` }) }
    catch (err) { crew.logEvent($app, { event: 'mail_failed', user: user.id, detail: 'aboard notice: ' + String(err).slice(0, 180) }) }
    return e.json(200, { user_id: user.id })
  }
  return e.json(200, {})
}
```

Append to `boarding.pb.js`:

```js
routerAdd('POST', '/api/crawl/boarding/{id}/let-aboard', (e) => require(`${__hooks}/boarding.js`).decide(e, 'aboard'))
routerAdd('POST', '/api/crawl/boarding/{id}/turn-away', (e) => require(`${__hooks}/boarding.js`).decide(e, 'away'))
```

- [ ] **Step 3: Implement `access.js` and register its routes and the name hook**

`pocketbase/pb_hooks/access.js`:

```js
// Conductor-only access controls (spec §2.9–2.10).
const isConductor = (e) => !!e.auth && e.auth.collection().name === 'users' && e.auth.getBool('is_admin') && !e.auth.getBool('blocked')

exports.setBlocked = function (e, blocked) {
  const crew = require(`${__hooks}/crew.js`)
  if (!isConductor(e)) return e.json(403, { message: 'Only the Conductor can do that.' })
  const id = e.request.pathValue('id')
  if (blocked && id === e.auth.id) return e.json(400, { message: "You can't put yourself off." })
  // Refetched inside the transaction: a concurrent sign-in or put-off cannot be written back stale.
  let u = null
  $app.runInTransaction((tx) => {
    try { u = tx.findRecordById('users', id) } catch (_) { return }
    u.set('blocked', blocked)
    if (blocked) u.refreshTokenKey() // every token dies once saved; realtime auth drops too
    tx.save(u)
  })
  if (!u) return e.json(404, { message: 'Not found.' })
  crew.logEvent($app, { event: blocked ? 'put_off' : 'let_back_on', actor: e.auth.id, user: u.id, name: u.getString('name'), email: u.email() }, crew.clientInfo(e))
  return e.json(200, {})
}

exports.manifest = function (e) {
  if (!isConductor(e)) return e.json(403, { message: 'Only the Conductor can do that.' })
  const users = $app.findRecordsByFilter('users', "id != ''", 'name', 0, 0)
  const names = {}
  for (const u of users) names[u.id] = u.getString('name')
  const s = (r, k) => r.getString(k)
  return e.json(200, {
    people: users.map((u) => ({ id: u.id, name: s(u, 'name'), email: u.email(), is_admin: u.getBool('is_admin'), blocked: u.getBool('blocked'),
      approved_by: names[s(u, 'approved_by')] || '', last_seen: s(u, 'last_seen'), created: s(u, 'created') })),
    requests: $app.findRecordsByFilter('boarding_requests', 'decoy = false', '-created', 50, 0).map((r) => ({ id: r.id, name: s(r, 'name'), email: s(r, 'email'),
      method: s(r, 'method'), status: s(r, 'status'), country: s(r, 'country'), city: s(r, 'city'), user_agent: s(r, 'user_agent'), created: s(r, 'created'),
      decided_by: names[s(r, 'decided_by')] || '' })),
    log: $app.findRecordsByFilter('access_log', "id != ''", '-created', 200, 0).map((r) => ({ id: r.id, created: s(r, 'created'), event: s(r, 'event'),
      method: s(r, 'method'), name: s(r, 'name'), email: s(r, 'email'), user: names[s(r, 'user')] || '', actor: names[s(r, 'actor')] || '',
      ip: s(r, 'ip'), country: s(r, 'country'), city: s(r, 'city'), user_agent: s(r, 'user_agent'), detail: s(r, 'detail') }))
  })
}
```

Append to `access.pb.js`:

```js
routerAdd('POST', '/api/crawl/users/{id}/put-off', (e) => require(`${__hooks}/access.js`).setBlocked(e, true))
routerAdd('POST', '/api/crawl/users/{id}/let-back-on', (e) => require(`${__hooks}/access.js`).setBlocked(e, false))
routerAdd('GET', '/api/crawl/manifest', (e) => require(`${__hooks}/access.js`).manifest(e))

// Names (spec §2.11): normalised and kept unique for every editor, the admin UI included.
onRecordUpdateRequest((e) => {
  const before = e.record.original().getString('name')
  if (e.record.getString('name') === before) return e.next()
  const n = require(`${__hooks}/names.js`)(e.record.getString('name'))
  if (!n) return e.json(400, { message: "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -" })
  try { if ($app.findFirstRecordByData('users', 'name_key', n.key).id !== e.record.id) return e.json(409, { message: 'That name is taken.' }) } catch (_) {}
  e.record.set('name', n.display)
  e.record.set('name_key', n.key)
  e.next()
  const crew = require(`${__hooks}/crew.js`)
  crew.logEvent($app, { event: 'name_changed', user: e.record.id, actor: e.auth ? e.auth.id : '', name: n.display, detail: 'was ' + before }, crew.clientInfo(e))
}, 'users')
```

The harness runs with `NOTIFY_INTERVAL_SECONDS=0`, so the 10-minute batching is **not** proven
by these tests. It is a manual acceptance item (Task 9, OPERATIONS checklist): two sign-ups a
minute apart give the Conductor one email.

`decide` answers 401 for a blocked user. A blocked user's token is already dead after put-off, and
the remaining case is a superuser-set flag. The test expects 401 in both.

- [ ] **Step 4: Run the hooks suite**

Run: `bash scripts/test-hooks.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pocketbase/pb_hooks/access.js pocketbase/pb_hooks/access.pb.js pocketbase/pb_hooks/boarding.js pocketbase/pb_hooks/boarding.pb.js web/tests/hooks/decisions.test.ts
git status --short
git commit -m "feat(access): peer decisions, Conductor notices, put off, manifest, name changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Client: sign-in, boarding pages, Google redirect

**Files:**
- Create:
  - `web/src/lib/boarding.ts`, `web/src/lib/google.ts`;
  - `web/src/lib/components/Turnstile.svelte`;
  - `web/src/routes/join/+page.svelte`, `web/src/routes/auth/google/+page.svelte`.
- Modify: `web/src/lib/pb.ts`, `web/src/routes/login/+page.svelte`, `web/src/lib/labels.ts`,
  `web/src/lib/types.ts`
- Test: `web/tests/unit/boarding.test.ts`, `web/tests/unit/google.test.ts`,
  `web/tests/e2e/boarding.spec.ts`, `web/tests/e2e/helpers.ts` (`codeFor`, `clearMails`)

**Interfaces:**
- **Produces, from `boarding.ts`:**
  - `type StoredBoarding = {requestId: string; secret: string; name: string; email: string; savedAt: number}`;
  - `BOARDING_KEY: string`;
  - `loadBoarding(store: Pick<Storage, 'getItem'>, now: number): StoredBoarding | null`, which drops
    entries older than 72 h;
  - `saveBoarding(store, b)`, `clearBoarding(store)`;
  - `stepFor(status: string): 'code' | 'waiting' | 'aboard' | 'turned_away' | 'expired'`.
- **Produces, from `google.ts`:**
  - `GOOGLE_KEY`;
  - `type GoogleState = {mode: 'join' | 'login'; name: string; state: string; codeVerifier: string; redirectUrl: string}`;
  - `buildAuthUrl(authURL: string, redirectUrl: string): string`;
  - `readReturn(url: URL, stored: GoogleState | null): {ok: true; code: string} | {ok: false}`.
- **Produces, from `pb.ts`:**
  - `requestCode(email): Promise<string>` returning the otpId;
  - `signInWithCode(otpId, code): Promise<void>`;
  - `joinCrew(name, email, turnstile)`, `verifyJoin(id, secret, code)`, `joinStatus(id, secret)`,
    `resendJoin(id, secret)`;
  - `refreshSession(): Promise<'ok' | 'signed_out' | 'offline'>`;
  - `rehearsalLogin(name, password)`, the old `login`, renamed.
- **Produces, in `UserRecord`:** `email?: string; blocked: boolean; approved_by: string; last_seen: string`.

- [ ] **Step 1: Write the failing unit tests**

`web/tests/unit/boarding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BOARDING_KEY, clearBoarding, loadBoarding, saveBoarding, stepFor } from '../../src/lib/boarding';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const b = { requestId: 'r', secret: 's', name: 'Bob', email: 'bob@example.com', savedAt: 1_000 };

describe('stored boarding requests', () => {
  it('round-trips and resumes within 72 h', () => {
    const s = mem(); saveBoarding(s, b);
    expect(loadBoarding(s, 1_000 + 71 * 3600e3)).toEqual(b);
  });
  it('forgets after 72 h and on clear', () => {
    const s = mem(); saveBoarding(s, b);
    expect(loadBoarding(s, 1_000 + 73 * 3600e3)).toBeNull();
    saveBoarding(s, b); clearBoarding(s);
    expect(s.getItem(BOARDING_KEY)).toBeNull();
  });
  it('survives garbage', () => { const s = mem(); s.setItem(BOARDING_KEY, '{nope'); expect(loadBoarding(s, 0)).toBeNull(); });
  it('maps server status to a step, an expired resume included', () => {
    expect(stepFor('unverified')).toBe('code');
    expect(stepFor('waiting')).toBe('waiting');
    expect(stepFor('aboard')).toBe('aboard');
    expect(stepFor('turned_away')).toBe('turned_away');
    expect(stepFor('expired')).toBe('expired');
    expect(stepFor('anything else')).toBe('expired');
  });
});
```

`web/tests/unit/google.test.ts`:

```ts
import { expect, it } from 'vitest';
import { buildAuthUrl, readReturn } from '../../src/lib/google';
const stored = { mode: 'join' as const, name: 'Bob', state: 'abc', codeVerifier: 'v', redirectUrl: 'https://chugalug.app/auth/google' };
it('appends the redirect uri PocketBase leaves open', () =>
  expect(buildAuthUrl('https://accounts.google.com/o?x=1&redirect_uri=', stored.redirectUrl)).toBe('https://accounts.google.com/o?x=1&redirect_uri=https%3A%2F%2Fchugalug.app%2Fauth%2Fgoogle'));
it('accepts only a matching state with a code', () => {
  expect(readReturn(new URL('https://x/auth/google?state=abc&code=c1'), stored)).toEqual({ ok: true, code: 'c1' });
  expect(readReturn(new URL('https://x/auth/google?state=evil&code=c1'), stored)).toEqual({ ok: false });
  expect(readReturn(new URL('https://x/auth/google?state=abc'), stored)).toEqual({ ok: false });
  expect(readReturn(new URL('https://x/auth/google?state=abc&code=c1'), null)).toEqual({ ok: false });
});
```

Run: `cd web && npx vitest run tests/unit/boarding.test.ts tests/unit/google.test.ts`
Expected: FAIL: the modules don't exist.

- [ ] **Step 2: Implement the helpers**

`web/src/lib/boarding.ts`:

```ts
// A boarding request outlives the tab: reopening /join resumes it (spec §5), for up to 72 h.
import { env } from '$env/dynamic/public';

export type StoredBoarding = { requestId: string; secret: string; name: string; email: string; savedAt: number };
export const BOARDING_KEY = env.PUBLIC_SIM === '1' ? 'chugalug_boarding_rehearsal' : 'chugalug_boarding';
const TTL = 72 * 3600e3;

export function loadBoarding(store: Pick<Storage, 'getItem'>, now: number): StoredBoarding | null {
  try {
    const b = JSON.parse(store.getItem(BOARDING_KEY) ?? 'null') as StoredBoarding | null;
    return b && typeof b.requestId === 'string' && now - b.savedAt < TTL ? b : null;
  } catch { return null; }
}
export function saveBoarding(store: Pick<Storage, 'setItem'>, b: StoredBoarding): void {
  try { store.setItem(BOARDING_KEY, JSON.stringify(b)); } catch { /* private mode: the page still works this session */ }
}
export function clearBoarding(store: Pick<Storage, 'removeItem'>): void {
  try { store.removeItem(BOARDING_KEY); } catch { /* nothing to clear */ }
}
export function stepFor(status: string): 'code' | 'waiting' | 'aboard' | 'turned_away' | 'expired' {
  return status === 'unverified' ? 'code' : status === 'waiting' || status === 'aboard' || status === 'turned_away' ? status : 'expired';
}
```

`web/src/lib/google.ts`:

```ts
// The manual OAuth2 code flow (spec §5): popups are unreliable in installed iOS web apps.
export const GOOGLE_KEY = 'chugalug_google';
export type GoogleState = { mode: 'join' | 'login'; name: string; state: string; codeVerifier: string; redirectUrl: string };
export const buildAuthUrl = (authURL: string, redirectUrl: string) => authURL + encodeURIComponent(redirectUrl);
export function readReturn(url: URL, stored: GoogleState | null): { ok: true; code: string } | { ok: false } {
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  return stored && code && state && state === stored.state ? { ok: true, code } : { ok: false };
}
```

Run: `cd web && npx vitest run tests/unit/boarding.test.ts tests/unit/google.test.ts`
Expected: PASS.

- [ ] **Step 3: Extend `pb.ts` and the types**

In `web/src/lib/pb.ts`:
- rename `login` to `rehearsalLogin`, and update its one caller, the login page;
- import `getTokenPayload` alongside `PocketBase` from `'pocketbase'`;
- add:

```ts
/** Email code sign-in (PocketBase OTP). The SDK saves the session into the cookie store. */
export async function requestCode(email: string): Promise<string> {
  return (await pb.collection('users').requestOTP(email.trim().toLowerCase())).otpId;
}
export async function signInWithCode(otpId: string, code: string): Promise<void> {
  await pb.collection('users').authWithOTP(otpId, code.trim());
}
export const joinCrew = (name: string, email: string, turnstile: string) =>
  pb.send<{ request_id: string; secret: string }>('/api/crawl/join', { method: 'POST', body: { name, email, turnstile } });
export const verifyJoin = (request_id: string, secret: string, code: string) =>
  pb.send('/api/crawl/join/verify', { method: 'POST', body: { request_id, secret, code } });
export const joinStatus = (request_id: string, secret: string) =>
  pb.send<{ status: string }>('/api/crawl/join/status', { method: 'POST', body: { request_id, secret } });
export const resendJoin = (request_id: string, secret: string) =>
  pb.send('/api/crawl/join/resend', { method: 'POST', body: { request_id, secret } });
/**
 * Spec §5, on every app open: ask who we are (GET /api/crawl/me, which mints nothing), and renew
 * the token only in its last week. Only a 401/403 ends the session; no signal keeps it (offline
 * event day). Impersonated test sessions are long-lived and never reach the renewal branch.
 */
export async function refreshSession(): Promise<'ok' | 'signed_out' | 'offline'> {
  if (!pb.authStore.isValid) return 'signed_out';
  try {
    await pb.send('/api/crawl/me', { method: 'GET' });
    const exp = Number(getTokenPayload(pb.authStore.token).exp ?? 0) * 1000;
    if (exp - Date.now() < 7 * 86400e3) await pb.collection('users').authRefresh();
    return 'ok';
  } catch (e) {
    const status = (e as { status?: number }).status ?? 0;
    return status === 401 || status === 403 ? 'signed_out' : 'offline';
  }
}
```

Extend `UserRecord` in `web/src/lib/types.ts` with
`email?: string; blocked: boolean; approved_by: string; last_seen: string;`.

- [ ] **Step 4: Add the labels**

In `web/src/lib/labels.ts`:
- `labels` gets `boardPage: 'Board'`, `boardingRequest: 'Boarding request'`,
  `manifest: 'Manifest'` and `yourTicket: 'Your ticket'`;
- `copy` gets the strings below. Remove `loginIntro`'s crew-password wording; keep `passwordError`
  for the rehearsal form.

```ts
  loginIntro: 'Sign in with Google or with a code we email you.',
  rehearsalIntro: 'Shakedown Run: your name and the rehearsal password.',
  continueGoogle: 'Continue with Google',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  emailMeCode: 'Email me a code',
  codeLabel: '6-digit code',
  codeSentTo: 'We sent a code to',
  noCodeHint: 'No code after a minute? Send it again, or use Google.',
  sendAgain: 'Send it again',
  signIn: 'Sign in',
  newHereBoard: 'New here? Board the Chug-a-Lug',
  haveSeatSignIn: 'Already aboard? Sign in',
  boardTitle: 'Board the Chug-a-Lug',
  boardIntro: 'Pick the name the crew knows you by. Someone in the crew lets you aboard.',
  orEmail: 'or use your email',
  sendCode: 'Send my code',
  requestSent: 'Request sent. Waiting for someone in the crew to let you aboard.',
  requestSentHint: 'You can close this page. We email you when you are aboard.',
  youreAboard: "You're aboard!",
  turnedAway: 'The crew turned this request away.',
  requestExpired: 'This request expired. Board again.',
  boardAgain: 'Board again',
  emailError: 'Enter a valid email address.',
  codeError: 'Enter the 6-digit code.',
  humanCheck: 'Checking you are human…',
```

- [ ] **Step 5: The Turnstile component**

`web/src/lib/components/Turnstile.svelte`:

```svelte
<script lang="ts">
  // Cloudflare Turnstile, explicit render. No site key → no widget, and the server refuses the join.
  // A token is single-use: the page calls reset() after every submit, whatever the answer.
  import { env } from '$env/dynamic/public';
  let { ontoken }: { ontoken: (token: string) => void } = $props();
  let box: HTMLDivElement;
  let widget = '';
  type TurnstileApi = { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void; reset: (id: string) => void };
  export function reset() {
    ontoken('');
    if (widget) (window as unknown as { turnstile?: TurnstileApi }).turnstile?.reset(widget);
  }
  $effect(() => {
    const sitekey = env.PUBLIC_TURNSTILE_SITE_KEY;
    if (!sitekey) return;
    let id = '', gone = false;
    const render = () => {
      const t = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (t && !gone) widget = id = t.render(box, { sitekey, callback: ontoken, 'expired-callback': () => ontoken('') });
    };
    if ((window as unknown as { turnstile?: TurnstileApi }).turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = render;
      document.head.appendChild(s);
    }
    return () => { gone = true; if (id) (window as unknown as { turnstile?: TurnstileApi }).turnstile?.remove(id); };
  });
</script>
<div bind:this={box} data-testid="turnstile"></div>
```

- [ ] **Step 6: The login page**

Replace `web/src/routes/login/+page.svelte`. Keep the existing form styling classes; the old file
has no `<style>`, so the global styles apply.

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import { ClientResponseError } from 'pocketbase';
  import { auth, pb, rehearsalLogin, requestCode, signInWithCode } from '$lib/pb';
  import { GOOGLE_KEY, buildAuthUrl } from '$lib/google';
  import { copy } from '$lib/labels';

  const rehearsal = env.PUBLIC_SIM === '1';
  const google = env.PUBLIC_GOOGLE_ENABLED === '1';
  let email = $state(''), code = $state(''), otpId = $state(''), name = $state(''), password = $state('');
  let error = $state(''), busy = $state(false);
  $effect(() => { if ($auth.user) void goto('/', { replaceState: true }); });
  const message = (e: unknown) => e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;

  async function run(action: () => Promise<void>) {
    if (busy) return; error = ''; busy = true;
    try { await action(); } catch (e) { error = message(e); } finally { busy = false; }
  }
  const sendCode = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    void run(async () => { otpId = await requestCode(email); }); };
  const checkCode = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { error = copy.codeError; return; }
    void run(() => signInWithCode(otpId, code)); };
  const withGoogle = () => void run(async () => {
    pb.authStore.clear();
    const methods = await pb.collection('users').listAuthMethods();
    const p = methods.oauth2.providers.find((x) => x.name === 'google');
    if (!p) throw new Error('google');
    const redirectUrl = `${location.origin}/auth/google`;
    sessionStorage.setItem(GOOGLE_KEY, JSON.stringify({ mode: 'login', name: '', state: p.state, codeVerifier: p.codeVerifier, redirectUrl }));
    location.href = buildAuthUrl(p.authURL, redirectUrl);
  });
  const rehearse = (ev: SubmitEvent) => { ev.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > 32) { error = copy.nameError; return; }
    if (!password) { error = copy.passwordError; return; }
    void run(() => rehearsalLogin(n, password)); };
</script>

<h1>{copy.loginTitle}</h1>
{#if rehearsal}
  <p>{copy.rehearsalIntro}</p>
  <form onsubmit={rehearse} aria-busy={busy}>
    <label for="name">{copy.name}</label>
    <input id="name" type="text" autocomplete="nickname" bind:value={name} data-testid="name-input" disabled={busy} />
    <label for="password">{copy.password}</label>
    <input id="password" type="password" autocomplete="current-password" bind:value={password} data-testid="password" disabled={busy} />
    <button type="submit" disabled={busy} data-testid="login">{busy ? copy.working : copy.login}</button>
  </form>
{:else}
  <p>{copy.loginIntro}</p>
  {#if google}<button type="button" onclick={withGoogle} disabled={busy} data-testid="google">{copy.continueGoogle}</button>{/if}
  {#if !otpId}
    <form onsubmit={sendCode} aria-busy={busy}>
      <label for="email">{copy.emailLabel}</label>
      <input id="email" type="email" autocomplete="email" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} />
      <button type="submit" disabled={busy} data-testid="send-code">{busy ? copy.working : copy.emailMeCode}</button>
    </form>
  {:else}
    <form onsubmit={checkCode} aria-busy={busy}>
      <p>{copy.codeSentTo} {email.trim().toLowerCase()}</p>
      <label for="code">{copy.codeLabel}</label>
      <input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" bind:value={code} data-testid="code-input" disabled={busy} />
      <button type="submit" disabled={busy} data-testid="sign-in">{busy ? copy.working : copy.signIn}</button>
      <p class="hint">{copy.noCodeHint} <button type="button" class="link" onclick={() => { otpId = ''; code = ''; }}>{copy.sendAgain}</button></p>
    </form>
  {/if}
  <p><a href="/join" data-testid="to-join">{copy.newHereBoard}</a></p>
{/if}
{#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
```

- [ ] **Step 7: The join page and the Google return page**

`web/src/routes/join/+page.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import { ClientResponseError } from 'pocketbase';
  import { auth, joinCrew, joinStatus, pb, resendJoin, verifyJoin } from '$lib/pb';
  import { clearBoarding, loadBoarding, saveBoarding, stepFor, type StoredBoarding } from '$lib/boarding';
  import { GOOGLE_KEY, buildAuthUrl } from '$lib/google';
  import { copy } from '$lib/labels';
  import Turnstile from '$lib/components/Turnstile.svelte';
  import { onMount } from 'svelte';

  const google = env.PUBLIC_GOOGLE_ENABLED === '1';
  let turnstile: Turnstile;
  let offline = $state(false);
  let step = $state<'start' | 'code' | 'waiting' | 'aboard' | 'turned_away' | 'expired'>('start');
  let name = $state(''), email = $state(''), code = $state(''), token = $state('');
  let error = $state(''), busy = $state(false);
  let current = $state<StoredBoarding | null>(null);
  $effect(() => { if ($auth.user) void goto('/', { replaceState: true }); });
  const message = (e: unknown) => e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;
  const cleanName = () => name.trim().replace(/\s+/g, ' ');

  // Resume a stored request once (spec §5). onMount, not $effect: check() reads `current`, and an
  // effect that both writes and reads it would re-run itself.
  onMount(() => {
    const stored = loadBoarding(localStorage, Date.now());
    if (stored) { current = stored; step = 'waiting'; void check(); }
  });
  // Poll while a request is open. Only `step` is tracked; check() runs inside the timer callback.
  $effect(() => {
    if (step !== 'waiting' && step !== 'code') return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 5000);
    return () => clearInterval(timer);
  });
  // A 404 is definitive (unknown request or wrong secret); anything else is "try again later", and
  // the stored request is kept so a dead zone never costs someone their place in line.
  async function check() {
    const mine = current;
    if (!mine) return;
    try {
      const next = stepFor((await joinStatus(mine.requestId, mine.secret)).status);
      if (current !== mine) return;
      offline = false;
      step = next;
      if (next !== 'code' && next !== 'waiting') clearBoarding(localStorage);
    } catch (e) {
      if ((e as { status?: number }).status === 404) { step = 'expired'; clearBoarding(localStorage); }
      else offline = true;
    }
  }
  async function run(action: () => Promise<void>) {
    if (busy) return; error = ''; busy = true;
    try { await action(); } catch (e) { error = message(e); } finally { busy = false; }
  }
  const start = (ev: SubmitEvent) => { ev.preventDefault();
    if (cleanName().length < 2 || cleanName().length > 32) { error = copy.nameError; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    void run(async () => {
      try {
        const r = await joinCrew(cleanName(), email.trim(), token);
        current = { requestId: r.request_id, secret: r.secret, name: cleanName(), email: email.trim().toLowerCase(), savedAt: Date.now() };
        saveBoarding(localStorage, current); step = 'code';
      } finally { turnstile?.reset(); } // the token is spent either way
    }); };
  const verify = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { error = copy.codeError; return; }
    void run(async () => { await verifyJoin(current!.requestId, current!.secret, code.trim()); step = 'waiting'; }); };
  const again = () => void run(() => resendJoin(current!.requestId, current!.secret).then(() => {}));
  const withGoogle = () => {
    if (cleanName().length < 2 || cleanName().length > 32) { error = copy.nameError; return; }
    void run(async () => {
      pb.authStore.clear();
      const p = (await pb.collection('users').listAuthMethods()).oauth2.providers.find((x) => x.name === 'google');
      if (!p) throw new Error('google');
      const redirectUrl = `${location.origin}/auth/google`;
      sessionStorage.setItem(GOOGLE_KEY, JSON.stringify({ mode: 'join', name: cleanName(), state: p.state, codeVerifier: p.codeVerifier, redirectUrl }));
      location.href = buildAuthUrl(p.authURL, redirectUrl);
    });
  };
  const restart = () => { clearBoarding(localStorage); current = null; step = 'start'; code = ''; };
</script>

<h1>{copy.boardTitle}</h1>
{#if step === 'start'}
  <p>{copy.boardIntro}</p>
  <form onsubmit={start} aria-busy={busy}>
    <label for="name">{copy.name}</label>
    <input id="name" type="text" autocomplete="nickname" placeholder={copy.namePlaceholder} bind:value={name} data-testid="name-input" maxlength="32" disabled={busy} />
    {#if google}<button type="button" onclick={withGoogle} disabled={busy} data-testid="google">{copy.continueGoogle}</button><p>{copy.orEmail}</p>{/if}
    <label for="email">{copy.emailLabel}</label>
    <input id="email" type="email" autocomplete="email" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} />
    <Turnstile bind:this={turnstile} ontoken={(t) => (token = t)} />
    <button type="submit" disabled={busy || !token} data-testid="send-code">{busy ? copy.working : token ? copy.sendCode : copy.humanCheck}</button>
  </form>
  <p><a href="/login">{copy.haveSeatSignIn}</a></p>
{:else if step === 'code'}
  <form onsubmit={verify} aria-busy={busy}>
    <p>{copy.codeSentTo} {current?.email}</p>
    <label for="code">{copy.codeLabel}</label>
    <input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" bind:value={code} data-testid="code-input" disabled={busy} />
    <button type="submit" disabled={busy} data-testid="verify">{busy ? copy.working : copy.signIn}</button>
    <p class="hint">{copy.noCodeHint} <button type="button" class="link" onclick={again}>{copy.sendAgain}</button></p>
  </form>
{:else if step === 'waiting'}
  <p data-testid="waiting">{copy.requestSent}</p><p class="hint">{copy.requestSentHint}</p>
  {#if offline}<p class="hint" data-testid="join-offline">{copy.noSignal}</p>{/if}
{:else if step === 'aboard'}
  <p data-testid="aboard">{copy.youreAboard}</p><a class="button" href="/login" data-testid="go-sign-in">{copy.signIn}</a>
{:else if step === 'turned_away'}
  <p data-testid="turned-away">{copy.turnedAway}</p>
{:else}
  <p data-testid="expired">{copy.requestExpired}</p><button type="button" onclick={restart}>{copy.boardAgain}</button>
{/if}
{#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
```

`web/src/routes/auth/google/+page.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ClientResponseError } from 'pocketbase';
  import { pb } from '$lib/pb';
  import { GOOGLE_KEY, readReturn, type GoogleState } from '$lib/google';
  import { saveBoarding } from '$lib/boarding';
  import { copy } from '$lib/labels';
  let error = $state('');
  $effect(() => {
    let stored: GoogleState | null = null;
    try { stored = JSON.parse(sessionStorage.getItem(GOOGLE_KEY) ?? 'null'); } catch { stored = null; }
    sessionStorage.removeItem(GOOGLE_KEY);
    const back = readReturn(page.url, stored);
    if (!back.ok || !stored) { error = copy.genericError; return; }
    const s = stored;
    void (async () => {
      try {
        const res = await pb.send<{ token?: string; record?: Record<string, unknown>; pending?: boolean; request_id?: string; secret?: string }>(
          '/api/collections/users/auth-with-oauth2', { method: 'POST', headers: { Authorization: '' },
            body: { provider: 'google', code: back.code, codeVerifier: s.codeVerifier, redirectURL: s.redirectUrl, ...(s.mode === 'join' ? { createData: { name: s.name } } : {}) } });
        if (res.pending && res.request_id && res.secret) {
          saveBoarding(localStorage, { requestId: res.request_id, secret: res.secret, name: s.name, email: '', savedAt: Date.now() });
          await goto('/join', { replaceState: true });
        } else if (res.token && res.record) {
          pb.authStore.save(res.token, res.record as never);
          await goto('/', { replaceState: true });
        }
      } catch (e) { error = e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError; }
    })();
  });
</script>
{#if error}<p class="error" role="alert">{error}</p><p><a href="/login">{copy.signIn}</a> · <a href="/join">{copy.boardTitle}</a></p>{:else}<p>{copy.working}</p>{/if}
```

- [ ] **Step 8: Run unit and type checks**

Run: `cd web && npm test && npm run check`
Expected: PASS.

- [ ] **Step 9: Write the e2e boarding spec, sign-in half**

Add to `web/tests/e2e/helpers.ts`:

```ts
const MAIL = process.env.MAIL_SINK_URL ?? 'http://127.0.0.1:12526';
export async function clearMails() { await fetch(`${MAIL}/messages`, { method: 'DELETE' }); }
export async function codeFor(to: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const all = (await (await fetch(`${MAIL}/messages`)).json()) as { to: string[]; text: string }[];
    const code = all.filter((m) => m.to.includes(to.toLowerCase())).map((m) => /\b(\d{6})\b/.exec(m.text)?.[1]).filter(Boolean).at(-1);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No code mailed to ${to}`);
}
/** Turnstile without the network: the widget script is replaced by one that passes at once. */
export async function stubTurnstile(page: Page) {
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({ contentType: 'text/javascript',
    body: "(function(){var n=0,cb=null;function fresh(){setTimeout(function(){cb('ok-e2e-'+Date.now()+'-'+(++n))})}" +
      "window.turnstile={render:function(el,o){cb=o.callback;fresh();return 'w'},reset:function(){fresh()},remove:function(){}}})();" }));
}
```

`web/tests/e2e/boarding.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { clearMails, codeFor, sessionFor, stubTurnstile } from './helpers';

test('a visitor boards by email, waits, is let aboard and signs in with a code', async ({ page }) => {
  const n = Math.floor(Math.random() * 1e6), email = `visitor${n}@test.invalid`;
  await clearMails(); await stubTurnstile(page);
  await page.goto('/login');
  await page.getByTestId('to-join').click();
  await page.getByTestId('name-input').fill(`Visitor ${n}`);
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('send-code').click();
  await page.getByTestId('code-input').fill(await codeFor(email));
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('waiting')).toBeVisible();

  // Reopening the page resumes the wait (Review Focus 3), even with no signal.
  await page.reload();
  await expect(page.getByTestId('waiting')).toBeVisible();
  await page.route('**/api/crawl/join/status', (route) => route.abort());
  await page.reload();
  await expect(page.getByTestId('join-offline')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('waiting')).toBeVisible();
  await page.unroute('**/api/crawl/join/status');

  // A crew member answers through the API here; the popup UI is Task 8's spec.
  const crew = await sessionFor(`E2E Voucher ${n}`);
  const pb = process.env.PB_URL ?? 'http://127.0.0.1:18093';
  const list = await (await fetch(`${pb}/api/collections/boarding_requests/records?filter=${encodeURIComponent(`email="${email}"`)}`, { headers: { Authorization: crew.token } })).json();
  expect((await fetch(`${pb}/api/crawl/boarding/${list.items[0].id}/let-aboard`, { method: 'POST', headers: { Authorization: crew.token } })).status).toBe(200);

  await expect(page.getByTestId('aboard')).toBeVisible({ timeout: 10_000 });
  await clearMails();
  await page.getByTestId('go-sign-in').click();
  await page.getByTestId('email-input').fill(email.toUpperCase());
  await page.getByTestId('send-code').click();
  await page.getByTestId('code-input').fill(await codeFor(email));
  await page.getByTestId('sign-in').click();
  await expect(page.getByTestId('name')).toHaveText(`Visitor ${n}`);
});
```

Run: `cd web && npm run test:e2e`
Expected: PASS, the whole e2e suite.

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/boarding.ts web/src/lib/google.ts web/src/lib/components/Turnstile.svelte web/src/routes/join/+page.svelte web/src/routes/auth/google/+page.svelte web/src/routes/login/+page.svelte web/src/lib/pb.ts web/src/lib/labels.ts web/src/lib/types.ts web/tests/unit/boarding.test.ts web/tests/unit/google.test.ts web/tests/e2e/boarding.spec.ts web/tests/e2e/helpers.ts
git status --short
git commit -m "feat(web): sign in by email code or Google; board the crew by peer approval

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Client: boarding queue, popups, Crew Board, Manifest, Your ticket, refresh on open

**Files:**
- Create:
  - `web/src/lib/live/boardingQueue.svelte.ts`;
  - `web/src/lib/components/BoardingPopup.svelte`, `web/src/lib/components/WaitingList.svelte`;
  - `web/src/routes/(app)/crew/access/+page.svelte`, `web/src/routes/(app)/account/+page.svelte`.
- Modify: `web/src/routes/(app)/+layout.svelte`, `web/src/routes/+layout.svelte`,
  `web/src/lib/components/AppMenu.svelte`, `web/src/routes/(app)/crew/+page.svelte`,
  `web/src/lib/labels.ts`
- Test: `web/tests/unit/boardingQueue.test.ts`, `web/tests/unit/refreshSession.test.ts`,
  `web/tests/e2e/boarding.spec.ts` (popup + put off)

**Interfaces:**
- **Produces:** `type WaitingRequest = {id, name, email, user_agent, country, created, status}`.
- **Produces:**
  `visibleRequests(fetched: WaitingRequest[], hidden: ReadonlySet<string>): WaitingRequest[]`.
  It keeps `status === 'waiting'` rows not in `hidden`, oldest first.
- **Produces:** `outcomeOf(status: number): 'done' | 'answered' | 'error'`, where 200 → done and
  409 → answered.
- **Produces, the `boardingQueue` singleton:**
  - `requests` (`$state`), `count` (derived), `hidden`;
  - `start(): () => void`;
  - `refetch()`;
  - `decide(id, verdict: 'let-aboard' | 'turn-away'): Promise<'done' | 'answered' | 'error'>`;
  - `later(id)`.
- **Consumes:** `refreshSession` (Task 7) and the routes from Task 6.

- [ ] **Step 1: Write the failing unit tests**

`web/tests/unit/boardingQueue.test.ts`:

```ts
import { expect, it } from 'vitest';
import { outcomeOf, visibleRequests } from '../../src/lib/live/boardingQueue.svelte';
const r = (id: string, status: string, created: string) => ({ id, name: id, email: `${id}@x`, user_agent: '', country: '', created, status });

it('shows waiting requests, oldest first, minus the ones put off till later', () => {
  const rows = [r('b', 'waiting', '2026-10-03 10:02'), r('a', 'waiting', '2026-10-03 10:01'), r('c', 'aboard', '2026-10-03 10:00')];
  expect(visibleRequests(rows, new Set()).map((x) => x.id)).toEqual(['a', 'b']);
  expect(visibleRequests(rows, new Set(['a'])).map((x) => x.id)).toEqual(['b']);
});
it('a request another approver answered disappears on the next fetch', () => {
  expect(visibleRequests([r('a', 'turned_away', '2026-10-03 10:01')], new Set())).toEqual([]);
});
it('treats 409 as already answered, not an error (Review Focus 4)', () => {
  expect(outcomeOf(200)).toBe('done');
  expect(outcomeOf(409)).toBe('answered');
  expect(outcomeOf(500)).toBe('error');
});
```

`web/tests/unit/refreshSession.test.ts` covers Review Focus 5 by mocking `pb.send`, which
`/api/crawl/me` goes through:

```ts
import { afterEach, expect, it, vi } from 'vitest';
import { pb, refreshSession } from '../../src/lib/pb';

const token = (expInDays: number) => 'h.' + btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expInDays * 86400 })) + '.s';
afterEach(() => { vi.restoreAllMocks(); pb.authStore.clear(); });

it('keeps the session with no signal, ends it on 401/403, and renews only in the last week', async () => {
  pb.authStore.save(token(30), { id: 'u' } as never);
  const send = vi.spyOn(pb, 'send');
  const refresh = vi.spyOn(pb.collection('users'), 'authRefresh').mockResolvedValue({} as never);
  send.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
  expect(await refreshSession()).toBe('offline');
  send.mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 403 }));
  expect(await refreshSession()).toBe('signed_out');
  send.mockResolvedValueOnce({ record: { id: 'u' } });
  expect(await refreshSession()).toBe('ok');
  expect(refresh).not.toHaveBeenCalled();
  pb.authStore.save(token(3), { id: 'u' } as never);
  send.mockResolvedValueOnce({ record: { id: 'u' } });
  expect(await refreshSession()).toBe('ok');
  expect(refresh).toHaveBeenCalledOnce();
});
```

Run: `cd web && npx vitest run tests/unit/boardingQueue.test.ts tests/unit/refreshSession.test.ts`
Expected: FAIL: the module is missing.

- [ ] **Step 2: The queue**

`web/src/lib/live/boardingQueue.svelte.ts`:

```ts
// Who is waiting to board, owned by the app layout (spec §5). It reconciles from the server
// instead of trusting events: realtime only tells it something changed.
import { pb, subscribe } from '$lib/pb';

export type WaitingRequest = { id: string; name: string; email: string; user_agent: string; country: string; created: string; status: string };
export const visibleRequests = (fetched: WaitingRequest[], hidden: ReadonlySet<string>) =>
  fetched.filter((x) => x.status === 'waiting' && !hidden.has(x.id)).sort((a, b) => a.created.localeCompare(b.created));
export const outcomeOf = (status: number): 'done' | 'answered' | 'error' => status === 200 ? 'done' : status === 409 ? 'answered' : 'error';

class BoardingQueue {
  fetched = $state<WaitingRequest[]>([]);
  hidden = $state<Set<string>>(new Set());
  requests = $derived(visibleRequests(this.fetched, this.hidden));
  count = $derived(this.requests.length);
  private version = 0;

  async refetch() {
    const mine = ++this.version;
    try {
      const rows = await pb.collection('boarding_requests').getFullList<WaitingRequest>({ filter: "status = 'waiting'", sort: 'created' });
      if (mine === this.version) this.fetched = rows;
    } catch { /* offline: keep the last list */ }
  }
  start(): () => void {
    void this.refetch();
    const unsub = subscribe('boarding_requests', '', () => void this.refetch());
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void this.refetch(); }, 30_000);
    return () => { unsub(); clearInterval(timer); this.version++; this.fetched = []; this.hidden = new Set(); };
  }
  async decide(id: string, verdict: 'let-aboard' | 'turn-away') {
    let status = 0;
    try { await pb.send(`/api/crawl/boarding/${id}/${verdict}`, { method: 'POST' }); status = 200; }
    catch (e) { status = (e as { status?: number }).status ?? 0; }
    await this.refetch();
    return outcomeOf(status);
  }
  later(id: string) { this.hidden = new Set([...this.hidden, id]); }
}
export const boardingQueue = new BoardingQueue();
```

Run the Step 1 tests.
Expected: PASS.

- [ ] **Step 3: The popup and the waiting list**

`web/src/lib/components/WaitingList.svelte`:

```svelte
<script lang="ts">
  import { boardingQueue, type WaitingRequest } from '$lib/live/boardingQueue.svelte';
  import { copy } from '$lib/labels';
  import { fmtDateTime } from '$lib/time';
  let { items, showLater = false }: { items: WaitingRequest[]; showLater?: boolean } = $props();
  let note = $state('');
  async function act(id: string, verdict: 'let-aboard' | 'turn-away') {
    const outcome = await boardingQueue.decide(id, verdict);
    note = outcome === 'answered' ? copy.alreadyAnswered : outcome === 'error' ? copy.noSignal : '';
  }
</script>
{#each items as r (r.id)}
  <div class="req" data-testid="boarding-request">
    <strong>{r.name}</strong> <span class="email">{r.email}</span>
    <small>{r.user_agent.slice(0, 40)} · {r.country || '—'} · {fmtDateTime(r.created)}</small>
    <div class="actions">
      <button type="button" onclick={() => void act(r.id, 'let-aboard')} data-testid="let-aboard">{copy.letAboard}</button>
      <button type="button" class="secondary" onclick={() => void act(r.id, 'turn-away')} data-testid="turn-away">{copy.turnAway}</button>
      {#if showLater}<button type="button" class="link" onclick={() => boardingQueue.later(r.id)} data-testid="later">{copy.later}</button>{/if}
    </div>
  </div>
{/each}
{#if note}<p role="status">{note}</p>{/if}
<style>
  .req { padding: 12px 0; border-bottom: 1px solid #2a2a2a; display: grid; gap: 4px; }
  .email { color: #bbb; word-break: break-all; }
  small { color: #9a9a9a; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
```

Check `web/src/lib/time.ts`. If `fmtDateTime` takes an ISO string, PocketBase's `'YYYY-MM-DD
HH:MM:SS.sssZ'` may need `.replace(' ', 'T')`. Follow how `notifications/+page.svelte` calls it.

`web/src/lib/components/BoardingPopup.svelte`:

```svelte
<script lang="ts">
  // One waiting request at a time over any screen (spec §5).
  import { boardingQueue } from '$lib/live/boardingQueue.svelte';
  import { copy } from '$lib/labels';
  import WaitingList from './WaitingList.svelte';
  const first = $derived(boardingQueue.requests.slice(0, 1));
</script>
{#if first.length}
  <div class="popup" role="dialog" aria-label={copy.waitingToBoard} data-testid="boarding-popup">
    <p class="title">{copy.waitingToBoard}</p>
    <WaitingList items={first} showLater />
  </div>
{/if}
<style>
  .popup { position: fixed; left: 12px; right: 12px; bottom: 84px; z-index: 30; max-width: 520px; margin: 0 auto;
    background: #1f1f1f; border: 1px solid #ffb400; border-radius: 12px; padding: 12px 16px; box-shadow: 0 8px 30px rgba(0,0,0,.6); }
  .title { margin: 0; font-weight: 700; color: #ffb400; }
</style>
```

- [ ] **Step 4: Wire the layout, the menu, the Crew Board and the new pages**

Add labels:
- `copy`:
  - `waitingToBoard: 'Waiting to board'`, `letAboard: 'Let aboard'`, `turnAway: 'Turn away'`,
    `later: 'Later'`, `alreadyAnswered: 'Someone already answered this one.'`;
  - `putOff: 'Put off'`, `letBackOn: 'Let back on'`;
  - `approvedBy: 'Let aboard by'`, `lastSeen: 'Last seen'`, `never: 'never'`, `accessLog: 'Access log'`,
    `recentRequests: 'Recent boarding requests'`, `allEvents: 'All events'`;
  - `yourName: 'Your name'`, `save: 'Save'`, `saved: 'Saved'`.
- `labels` already has `manifest` and `yourTicket` from Task 7.

**`web/src/routes/(app)/+layout.svelte`:**
- Import `refreshSession` and `logout` from `$lib/pb`, `boardingQueue` from
  `$lib/live/boardingQueue.svelte`, and `BoardingPopup`.
- **Key every session-scoped effect on the user id, not the record.** `authStore.save` publishes a
  fresh record (a renewal, a name change), and an effect that reads `$auth.user` would re-run, so
  it would restart the live day, the queue and the refresh itself, in a loop. Add
  `const userId = $derived($auth.user?.id ?? '');` and change the existing live-day owner effect to
  start with `const id = userId; if (!id) return;` instead of `if (!$auth.user) return;`.
- Add, next to it:

```ts
  // Spec §5: once per session per app open. A put-off session ends; no signal keeps it. A late
  // answer for a session that has since logged out (or switched user) is ignored.
  let checkedFor = '';
  $effect(() => {
    const id = userId;
    if (!id || id === checkedFor) return;
    checkedFor = id;
    void refreshSession().then((r) => { if (r === 'signed_out' && pb.authStore.record?.id === id) logout(); });
  });
  // The layout owns the boarding queue; logout disposes it (CLAUDE.md clock-ownership rule).
  $effect(() => { if (userId) return boardingQueue.start(); });
```

  `checkedFor` is a plain `let`, not `$state`: it must not be tracked.

- Render `<BoardingPopup />` next to `<Lightbox />`.

**`web/src/routes/+layout.svelte`:**
- import `boardingQueue`;
- add it to the header dot: `const unread = $derived(alertsUnread + bulletinUnread + boardingQueue.count);`;
- pass `waiting={boardingQueue.count}` to `AppMenu`.

**`AppMenu.svelte`:**
- accept `waiting: number`;
- show `{#if waiting}<span class="badge">{waiting}</span>{/if}` in the Crew Board item;
- add before logout:

```svelte
    <button type="button" class="item" onclick={() => go('/account')} data-testid="menu-account"><span class="label">{labels.yourTicket}</span></button>
    {#if $auth.user?.is_admin}
      <button type="button" class="item" onclick={() => go('/crew/access')} data-testid="menu-manifest"><span class="label">{labels.manifest}</span></button>
    {/if}
```

**`crew/+page.svelte`:** above the board rows:

```svelte
{#if boardingQueue.requests.length}
  <h2>{copy.waitingToBoard}</h2>
  <WaitingList items={boardingQueue.requests} />
{/if}
```

**`web/src/routes/(app)/account/+page.svelte`:**

```svelte
<script lang="ts">
  import { ClientResponseError } from 'pocketbase';
  import { auth, logout, pb } from '$lib/pb';
  import { copy, labels } from '$lib/labels';
  let name = $state($auth.user?.name ?? '');
  let note = $state(''), busy = $state(false);
  async function save(ev: SubmitEvent) {
    ev.preventDefault(); if (busy || !$auth.user) return; busy = true; note = '';
    try { const r = await pb.collection('users').update($auth.user.id, { name: name.trim().replace(/\s+/g, ' ') }); pb.authStore.save(pb.authStore.token, r); note = copy.saved; }
    catch (e) { note = e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError; }
    finally { busy = false; }
  }
</script>
<svelte:head><title>{labels.yourTicket}</title></svelte:head>
<h1>{labels.yourTicket}</h1>
<form onsubmit={save}>
  <label for="name">{copy.yourName}</label>
  <input id="name" bind:value={name} maxlength="32" data-testid="account-name" />
  <button type="submit" disabled={busy} data-testid="account-save">{copy.save}</button>
</form>
<p>{copy.emailLabel}: <span data-testid="account-email">{$auth.user?.email}</span></p>
{#if note}<p role="status" data-testid="account-note">{note}</p>{/if}
<button type="button" class="secondary" onclick={logout}>{copy.logout}</button>
```

**`web/src/routes/(app)/crew/access/+page.svelte`:**

```svelte
<script lang="ts">
  import { auth, pb } from '$lib/pb';
  import { copy, labels } from '$lib/labels';
  import { fmtDateTime } from '$lib/time';
  type Person = { id: string; name: string; email: string; is_admin: boolean; blocked: boolean; approved_by: string; last_seen: string; created: string };
  type Req = { id: string; name: string; email: string; method: string; status: string; country: string; city: string; user_agent: string; created: string; decided_by: string };
  type Row = { id: string; created: string; event: string; method: string; name: string; email: string; user: string; actor: string; ip: string; country: string; city: string; user_agent: string; detail: string };
  let data = $state<{ people: Person[]; requests: Req[]; log: Row[] } | null>(null);
  let filter = $state(''), error = $state('');
  const load = async () => { try { data = await pb.send('/api/crawl/manifest', {}); error = ''; } catch { error = copy.loadError; } };
  $effect(() => { if ($auth.user?.is_admin) void load(); });
  async function block(id: string, off: boolean) { await pb.send(`/api/crawl/users/${id}/${off ? 'put-off' : 'let-back-on'}`, { method: 'POST' }).catch(() => (error = copy.noSignal)); await load(); }
  const rows = $derived((data?.log ?? []).filter((r) => !filter || r.event === filter));
  const when = (s: string) => (s ? fmtDateTime(s) : copy.never);
</script>
<svelte:head><title>{labels.manifest}</title></svelte:head>
<h1>{labels.manifest}</h1>
{#if !$auth.user?.is_admin}<p>{copy.conductorOnly ?? copy.genericError}</p>
{:else if error}<p class="error" role="alert">{error}</p>
{:else if data}
  {#each data.people as p (p.id)}
    <div class="row" data-testid="manifest-person">
      <strong>{p.name}{#if p.is_admin}<small> · {labels.admin}</small>{/if}</strong>
      <span class="email">{p.email}</span>
      <small>{copy.approvedBy}: {p.approved_by || '—'} · {copy.lastSeen}: {when(p.last_seen)}</small>
      {#if !p.is_admin}<button type="button" class="secondary" onclick={() => void block(p.id, !p.blocked)} data-testid="toggle-block">{p.blocked ? copy.letBackOn : copy.putOff}</button>{/if}
    </div>
  {/each}
  <h2>{copy.recentRequests}</h2>
  {#each data.requests as r (r.id)}<div class="row"><strong>{r.name}</strong> <span class="email">{r.email}</span> <small>{r.status} · {r.method} · {r.country} {r.city} · {when(r.created)}{r.decided_by ? ` · ${r.decided_by}` : ''}</small></div>{/each}
  <h2>{copy.accessLog}</h2>
  <select bind:value={filter} data-testid="log-filter"><option value="">{copy.allEvents}</option>{#each [...new Set(data.log.map((r) => r.event))] as ev}<option value={ev}>{ev}</option>{/each}</select>
  {#each rows as r (r.id)}<div class="row log"><small>{when(r.created)} · {r.event}{r.method ? ` (${r.method})` : ''} · {r.name || r.user || r.email} · {r.ip} {r.country} {r.city}{r.actor ? ` · by ${r.actor}` : ''}{r.detail ? ` · ${r.detail}` : ''}</small></div>{/each}
{/if}
<style>
  .row { padding: 10px 0; border-bottom: 1px solid #2a2a2a; display: grid; gap: 4px; }
  .email { color: #bbb; word-break: break-all; }
  small { color: #9a9a9a; }
</style>
```

Add `conductorOnly: 'Only the Conductor can see this.'` to `copy`, and drop the `??` fallback
above once it exists.

- [ ] **Step 5: E2E for the popup, cross-browser clearing and put off**

Append to `web/tests/e2e/boarding.spec.ts`:

```ts
test('crew get a popup; when one approver answers, the other popup clears; put off ends a session', async ({ browser }) => {
  // Realtime normally delivers in a second or two; the queue's 30 s reconciliation is the fallback,
  // so every popup wait allows 35 s.
  test.setTimeout(150_000);
  const n = Math.floor(Math.random() * 1e6), email = `popup${n}@test.invalid`;
  const boss = await browser.newContext(), mate = await browser.newContext(), guest = await browser.newContext();
  const [b, m, g] = await Promise.all([boss.newPage(), mate.newPage(), guest.newPage()]);
  await login(b, `E2E Chief ${n}`, 'admin-test-password');
  await login(m, `E2E Mate ${n}`, 'crew-test-password');

  await clearMails(); await stubTurnstile(g);
  await g.goto('/join');
  await g.getByTestId('name-input').fill(`Popup ${n}`);
  await g.getByTestId('email-input').fill(email);
  await g.getByTestId('send-code').click();
  await g.getByTestId('code-input').fill(await codeFor(email));
  await g.getByTestId('verify').click();

  await expect(b.getByTestId('boarding-popup')).toContainText(`Popup ${n}`, { timeout: 35_000 });
  await expect(m.getByTestId('boarding-popup')).toContainText(`Popup ${n}`, { timeout: 35_000 });
  await b.getByTestId('boarding-popup').getByTestId('let-aboard').click();
  await expect(m.getByTestId('boarding-popup')).toHaveCount(0, { timeout: 35_000 });
  await expect(g.getByTestId('aboard')).toBeVisible({ timeout: 10_000 });

  await b.goto('/crew/access');
  await b.getByTestId('manifest-person').filter({ hasText: `E2E Mate ${n}` }).getByTestId('toggle-block').click();
  await m.reload();
  await expect(m).toHaveURL(/\/login$/);
  await Promise.all([boss.close(), mate.close(), guest.close()]);
});
```

Import `login` alongside the other helpers at the top of the file.

Run: `cd web && npm test && npm run check && npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/live/boardingQueue.svelte.ts web/src/lib/components/BoardingPopup.svelte web/src/lib/components/WaitingList.svelte "web/src/routes/(app)/crew/access/+page.svelte" "web/src/routes/(app)/account/+page.svelte" "web/src/routes/(app)/+layout.svelte" web/src/routes/+layout.svelte web/src/lib/components/AppMenu.svelte "web/src/routes/(app)/crew/+page.svelte" web/src/lib/labels.ts web/tests/unit/boardingQueue.test.ts web/tests/unit/refreshSession.test.ts web/tests/e2e/boarding.spec.ts
git status --short
git commit -m "feat(web): boarding popups for the crew, the Conductor's Manifest, Your ticket, refresh on open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Configuration and documentation

**Files:**
- Modify: `.env.example`, `compose.yml`, `README.md`, `docs/OPERATIONS.md`, `CLAUDE.md`
- Test: the full gate (docs only, plus a compose config check)

- [ ] **Step 1: `.env.example` and `compose.yml`**

In `.env.example`, replace the "Shared passwords" block with:

```bash
# Crew access (docs/OPERATIONS.md "Deploying crew access"). The Conductor account is minted from
# CONDUCTOR_EMAIL on every start; PocketBase refuses to migrate without it.
CONDUCTOR_EMAIL=
APP_URL=https://chugalug.app
MAIL_FROM=no-reply@chugalug.app
# Resend SMTP: host smtp.resend.com, port 465 with SMTP_TLS=1, username "resend", password = API key.
SMTP_HOST=
SMTP_PORT=465
SMTP_TLS=1
SMTP_USERNAME=resend
SMTP_PASSWORD=
# Google sign-in (optional). Redirect URI: https://chugalug.app/auth/google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
PUBLIC_GOOGLE_ENABLED=0
# Cloudflare Turnstile for /join.
TURNSTILE_SECRET=
PUBLIC_TURNSTILE_SITE_KEY=
```

In `compose.yml`, under `web.build.args` and `web.environment`, add
`PUBLIC_TURNSTILE_SITE_KEY: ${PUBLIC_TURNSTILE_SITE_KEY:-}` and
`PUBLIC_GOOGLE_ENABLED: ${PUBLIC_GOOGLE_ENABLED:-0}`. Check `web/Dockerfile`: if it declares
`ARG PUBLIC_PB_URL` before the build, add matching `ARG` lines for the two new keys.

Run: `docker compose config >/dev/null && echo ok`
Expected: `ok`. It reads `.env`; this validates syntax only and starts nothing.

- [ ] **Step 2: README**

- Rewrite the "Private." ground rule:
  > **Private.** Everyone has their own account, keyed by email. A newcomer asks to board at
  > `/join`, any approved crew member lets them aboard, and from then on they sign in with Google or
  > an emailed code. No shared password.
- Rewrite the Auth bullet in the stack section the same way (email/OTP, Google, peer approval).
- Replace Decision 6 with the peer-approved boarding decision and its trade-off: the crew can let
  anyone aboard, and only the Conductor can put someone off.
- Add the six glossary rows from spec "UI glossary additions".

- [ ] **Step 3: OPERATIONS**

Rewrite "## Crew access" and add "## Deploying crew access" and "## Cloudflare checklist", with the
exact contents of spec §7. Update "## Rotate a secret" to list `SMTP_PASSWORD`, `GOOGLE_CLIENT_*`,
`TURNSTILE_SECRET` (`--force-recreate pocketbase`) and `PUBLIC_*` (needs `just up`, a rebuild).
Add a **manual acceptance** list for what the harness cannot prove:
- the real Google round trip;
- Conductor-email batching (two sign-ups a minute apart produce one email; tests run with
  `NOTIFY_INTERVAL_SECONDS=0`);
- the daily access-log retention.

Include:
- "Conductor without mail: on the box, open http://127.0.0.1:8090/_/ → users → your record →
  Impersonate, or temporarily enable password auth for the users collection."
- "Never publish port 8090 anywhere but the tunnel and the Docker network: PocketBase trusts
  `CF-Connecting-IP`."

- [ ] **Step 4: CLAUDE.md**

- Under "One test run at a time", add "**12525–12528** for the SMTP sink, its control API, the
  Turnstile fake and the fake OIDC provider (`web/scripts/test-fakes.mjs`)".
- Add a trap: "**Users are keyed by email.** Production signs in only by OTP or Google, and every
  session passes `crew.signInGuard`; boarding requests are not users, and a decoy request must stay
  indistinguishable from a real one. Tests mint sessions by impersonation (`loginToken`,
  `sessionFor`), never through a backdoor route."

- [ ] **Step 5: Run the full gate and commit**

Run: `cd web && npm test && npm run check && npm run test:e2e && cd .. && bash scripts/test-hooks.sh`
Expected: PASS.

```bash
git add .env.example compose.yml README.md docs/OPERATIONS.md CLAUDE.md
git status --short
git commit -m "docs: crew access — deploy steps, Cloudflare checklist, new env keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage check

| Spec section | Tasks |
|---|---|
| §1 data model, settings, migration | 2 |
| §1 expiry, log bounds | 5 (`sweep`, `daily`), 4 (`logEvent` throttle) |
| §2.1–2.5 | 5 |
| §2.6–2.7 | 6 |
| §2.8 | 4 |
| §2.9–2.11 | 6 |
| §2.12 | 2 |
| §3 | 4 |
| §4 | 4 |
| §5 | 7 and 8 |
| §6 harness | 1 and 2 |
| §6 rehearsal | 3 |
| §7 | 9 |
| §8 failure rows | tested in 5 (mail at join), 6 (mail after a decision, notification retry), 7/8 (offline refresh) |
| §9 | the post-deploy manual checklist in OPERATIONS (Task 9) |
