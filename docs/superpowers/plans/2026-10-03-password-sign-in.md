# Password Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The crew can sign in with email and a password, reset it by an emailed link, and choose one when they board, alongside today's email code and Google.

**Architecture:**
- PocketBase's built-in password auth and password reset do the work. A migration switches them on, and hooks add per-address throttles, the blocked-seat refusals and race-safe saves.
- `/join` hashes the chosen password into the boarding request. Let aboard copies the hash onto the new user by SQL.
- The SvelteKit pages `/login`, `/login/forgot`, `/reset-password`, `/join` and `/account` gain the forms.

**Tech Stack:** PocketBase 0.40.4 JS hooks and migrations (goja), SvelteKit 2 + Svelte 5, vitest (unit and hook tests), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-10-03-password-sign-in-design.md` (committed ece393c). Read it with this plan; the spec wins any conflict.

## Global Constraints

- Work only in `/home/garamizo/chug-a-lug/.worktrees/password-sign-in` on branch `feat/password-sign-in`.
- Stage explicit paths. Never `git add -A` or `git add .`. Never `--no-verify`. Read `git status --short` before every commit.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never start anything on ports 8090 or 3000. The test harnesses own 15173, 18093, 18090 and 12525–12528. No other worktree may run tests at the same time.
- User-visible strings live only in `web/src/lib/labels.ts`. Hook error messages stay inline in the hooks, as today.
- Tests come before the code they cover. Each task ends green: `cd web && npm test && npm run check && npm run test:e2e`, then `bash scripts/test-hooks.sh` from the worktree root.
- Password rule (spec §3.2): 8 to 64 Unicode code points and at most 72 UTF-8 bytes. The message is exactly `Pick a password of 8 to 64 characters.`
- Throttles: 10 password tries per address per 900 s (`password:<address>`); 3 reset mails per address per 3600 s (`reset:<address>`). PocketBase IP rules: `users:authWithPassword` 20/600, `users:requestPasswordReset` 5/600, `users:confirmPasswordReset` 10/600.
- The reset link is `{APP_URL}/reset-password#{TOKEN}`; the token always rides in the fragment.
- Every test-seeded user (`loginToken`, `sessionFor`) has the password `seed-test-password-1` and the email `<hex of name_key>@test.invalid`.

## Review Focus

These are the five likeliest ways real use breaks something no task's test exercises naturally. Each is pinned in the task named after it.

1. **A sign-up with a member's address must never change that member's password**, the decoy path included. *Pinned in Task 4.*
2. **An edit saved after a reset must not bring the old password back.** That covers a name change, and a superuser setting a password in the admin UI must still work. *Pinned in Task 3.*
3. **Emoji and accented passwords** must be judged identically by `/join` (where the hash is installed by SQL), by reset (PocketBase field validation) and by the browser. *Pinned in Task 1, with a `/join` case in Task 4.*
4. **A reset link opened twice, or after a put-off,** is refused and never revives a session. *Pinned in Task 3.*
5. **A boarding request filed before the deploy** (no hash) still gets a usable aboard notice. *Pinned in Task 4.*

---

### Task 1: Password rule, reset-token reader and the password field

**Files:**
- Modify: `pocketbase/pb_hooks/crew.js` (add `passwordProblem`)
- Create: `web/src/lib/password.ts`
- Create: `web/src/lib/components/PasswordInput.svelte`
- Modify: `web/src/lib/labels.ts` (copy keys below)
- Test: `web/tests/unit/password.test.ts`, `web/tests/unit/passwordInput.test.ts`

**Interfaces:**
- Produces, in `crew.js`: `passwordProblem(p: unknown): string | null`. It returns `null`, or `'Pick a password of 8 to 64 characters.'`.
- Produces, in `$lib/password.ts`: `passwordProblem(p: unknown): string | null` (returns `copy.passwordRule` or `null`) and `resetTokenEmail(token: string): string | null`.
- Produces `PasswordInput.svelte`, with props `{ value = $bindable(''), id: string, autocomplete: 'current-password' | 'new-password', testid?: string, disabled?: boolean }`. The toggle's test id is `${testid}-show`.
- Produces these `copy` keys: `passwordRule`, `passwordField`, `newPasswordField`, `passwordHint`, `showPassword`, `hidePassword`.

- [ ] **Step 1: Write the failing tests**

`web/tests/unit/password.test.ts`:

```ts
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { passwordProblem, resetTokenEmail } from '../../src/lib/password';
import { copy } from '../../src/lib/labels';
const server = createRequire(import.meta.url)('../../../pocketbase/pb_hooks/crew.js');

// Spec §3.2: code points (as PocketBase's password field counts) and bcrypt's 72 bytes. The server
// and the browser must agree, because /join installs the hash by SQL, skipping field validation.
const cases: Array<[string, unknown, boolean]> = [
  ['7 letters', 'a'.repeat(7), false],
  ['8 letters', 'a'.repeat(8), true],
  ['64 letters', 'a'.repeat(64), true],
  ['65 letters', 'a'.repeat(65), false],
  ['4 emoji: 8 UTF-16 units but 4 code points', '😀'.repeat(4), false],
  ['8 emoji: 32 bytes', '😀'.repeat(8), true],
  ['36 é: 72 bytes', 'é'.repeat(36), true],
  ['36 é and a letter: 73 bytes', 'é'.repeat(36) + 'a', false],
  ['24 €: 72 bytes', '€'.repeat(24), true],
  ['not a string', 12345678, false]
];

describe('passwordProblem (spec §3.2)', () => {
  for (const [what, p, ok] of cases) {
    it(`${what} → ${ok ? 'accepted' : 'refused'} by browser and server alike`, () => {
      expect(passwordProblem(p)).toBe(ok ? null : copy.passwordRule);
      expect(server.passwordProblem(p)).toBe(ok ? null : 'Pick a password of 8 to 64 characters.');
    });
  }
  it('the browser shows the server\'s words', () => expect(copy.passwordRule).toBe('Pick a password of 8 to 64 characters.'));
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
describe('resetTokenEmail (spec §2.3)', () => {
  it('reads the email claim', () => expect(resetTokenEmail(`${b64({ alg: 'HS256' })}.${b64({ email: 'rider@example.com', type: 'passwordReset' })}.sig`)).toBe('rider@example.com'));
  it('garbage is null', () => expect(resetTokenEmail('not-a-token')).toBeNull());
  it('no claim is null', () => expect(resetTokenEmail(`${b64({})}.${b64({ id: 'x' })}.sig`)).toBeNull());
});
```

`web/tests/unit/passwordInput.test.ts` follows the server-render style of `web/tests/unit/signInButton.test.ts`, so read that file first for its imports:

```ts
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import PasswordInput from '../../src/lib/components/PasswordInput.svelte';
import { copy } from '../../src/lib/labels';

describe('PasswordInput', () => {
  it('starts hidden, with a Show toggle bound to the input', () => {
    const { body } = render(PasswordInput, { props: { id: 'pw', autocomplete: 'current-password', testid: 'password-input' } });
    expect(body).toContain('type="password"');
    expect(body).toContain('autocomplete="current-password"');
    expect(body).toContain('aria-pressed="false"');
    expect(body).toContain('aria-controls="pw"');
    expect(body).toContain('data-testid="password-input-show"');
    expect(body).toContain(`>${copy.showPassword}<`);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npx vitest run tests/unit/password.test.ts tests/unit/passwordInput.test.ts`
Expected: FAIL, because `src/lib/password` does not exist.

- [ ] **Step 3: Implement**

In `pocketbase/pb_hooks/crew.js`, after `normalizeEmail`:

```js
// Password spec §3.2. Counted in code points, as PocketBase's password field counts min and max, and
// capped at bcrypt's 72 bytes: /join installs its hash by SQL, skipping field validation, so it must
// accept exactly what a reset would. web/src/lib/password.ts mirrors this.
exports.passwordProblem = function (p) {
  const refusal = 'Pick a password of 8 to 64 characters.'
  if (typeof p !== 'string') return refusal
  let points = 0, bytes = 0
  for (const ch of p) {
    const c = ch.codePointAt(0)
    points++
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return points < 8 || points > 64 || bytes > 72 ? refusal : null
}
```

`web/src/lib/password.ts`:

```ts
import { getTokenPayload } from 'pocketbase';
import { copy } from '$lib/labels';

/** Mirrors pocketbase/pb_hooks/crew.js passwordProblem: 8–64 code points, at most 72 UTF-8 bytes. */
export function passwordProblem(p: unknown): string | null {
  if (typeof p !== 'string') return copy.passwordRule;
  const points = Array.from(p).length, bytes = new TextEncoder().encode(p).length;
  return points < 8 || points > 64 || bytes > 72 ? copy.passwordRule : null;
}

/** The address a password-reset token was issued for (PocketBase puts it in the `email` claim). */
export function resetTokenEmail(token: string): string | null {
  const email = getTokenPayload(token).email;
  return typeof email === 'string' && email.includes('@') ? email : null;
}
```

`web/src/lib/components/PasswordInput.svelte`:

```svelte
<script lang="ts">
  // A password field with a Show/Hide toggle (password spec §3.3). No maxlength: it counts UTF-16
  // units, and passwordProblem counts code points.
  import { copy } from '$lib/labels';
  let { value = $bindable(''), id, autocomplete, testid, disabled = false }: {
    value?: string; id: string; autocomplete: 'current-password' | 'new-password'; testid?: string; disabled?: boolean;
  } = $props();
  let shown = $state(false);
</script>

<div class="password">
  <input {id} type={shown ? 'text' : 'password'} {autocomplete} bind:value {disabled} data-testid={testid} />
  <button type="button" class="link" aria-pressed={shown} aria-controls={id} onclick={() => (shown = !shown)}
    data-testid={testid ? `${testid}-show` : undefined}>{shown ? copy.hidePassword : copy.showPassword}</button>
</div>

<style>
  .password { display: flex; gap: 8px; align-items: center; }
  .password input { flex: 1; min-width: 0; }
</style>
```

Svelte 5 accepts a dynamic `type` with `bind:value`. If `npm run check` disagrees, use `value={value} oninput={(e) => (value = e.currentTarget.value)}` instead.

In `web/src/lib/labels.ts`, add these to `copy`, beside `password: 'Crew password'`, which stays for rehearsal:

```ts
  /** Password sign-in (password spec). `password` above is the rehearsal crew password. */
  passwordField: 'Password',
  newPasswordField: 'New password',
  passwordHint: 'At least 8 characters',
  passwordRule: 'Pick a password of 8 to 64 characters.',
  showPassword: 'Show',
  hidePassword: 'Hide',
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run tests/unit/password.test.ts tests/unit/passwordInput.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gate, then commit**

```bash
git add pocketbase/pb_hooks/crew.js web/src/lib/password.ts web/src/lib/components/PasswordInput.svelte web/src/lib/labels.ts web/tests/unit/password.test.ts web/tests/unit/passwordInput.test.ts
git commit -m "feat: one password rule for browser and server, and a password field with Show"
```

---

### Task 2: Migration that switches password sign-in on

**Files:**
- Create: `pocketbase/pb_migrations/1759000000_password_sign_in.js`
- Modify: `web/src/lib/labels.ts` (`signInMethodLabels.password`, two `accessEventLabels`)
- Modify: `web/tests/hooks/migrations.test.ts` (the crew-access redo test, plus a new test)
- Modify: `web/tests/unit/labels.test.ts`
- Modify: `web/tests/hooks/users.test.ts:24-25` (password auth is on now)
- Modify: `web/tests/hooks/access.test.ts:73-88` (`finally` restores the setting it found)

**Interfaces:**
- Produces:
  - `users.passwordAuth = { enabled: true, identityFields: ['email'] }`, password field `min 8 / max 64`, and the reset template and token duration.
  - The hidden text field `boarding_requests.password_hash`.
  - `access_log.event` values `password_reset_sent` and `password_set`, and `access_log.method` value `password`.
  - The three IP rules.

- [ ] **Step 1: Write the failing tests**

In `web/tests/hooks/migrations.test.ts`, change the crew-access redo test's middle lines. The new migration is now the last one, so `down 1` would revert it instead:

```ts
    run('up');
    const down = run('down', '2');
    expect(down).toContain('Reverted 1759000000_password_sign_in');
    expect(down).toContain('Reverted 1758900000_crew_access');
    expect(run('up')).toContain('1758900000_crew_access');
```

Append a new test:

```ts
it('password sign-in applies its settings, rolls back keeping history, and applies again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chugalug-password-'));
  try {
    const migrations = join(dir, 'migrations'), hooks = join(dir, 'hooks');
    await mkdir(migrations); await mkdir(hooks);
    for (const name of await readdir('../pocketbase/pb_migrations')) await copyFile(`../pocketbase/pb_migrations/${name}`, join(migrations, name));
    // Runs after the migration under test: checks the up state and leaves one history row behind.
    await writeFile(join(migrations, '1759000001_check_up.js'), `migrate(app => {
      const u = app.findCollectionByNameOrId('users');
      if (!u.passwordAuth.enabled || JSON.stringify(u.passwordAuth.identityFields) !== '["email"]') throw new Error('password auth');
      const f = u.fields.getByName('password');
      if (f.min !== 8 || f.max !== 64) throw new Error('password limits ' + f.min + '/' + f.max);
      if (u.resetPasswordTemplate.body.indexOf('{APP_URL}/reset-password#{TOKEN}') < 0) throw new Error('reset link');
      if (u.passwordResetToken.duration !== 1800) throw new Error('reset duration');
      const h = app.findCollectionByNameOrId('boarding_requests').fields.getByName('password_hash');
      if (!h || !h.hidden) throw new Error('password_hash');
      const labels = app.settings().rateLimits.rules.map((r) => r.label + '=' + r.maxRequests + '/' + r.duration);
      for (const want of ['users:authWithPassword=20/600', 'users:requestPasswordReset=5/600', 'users:confirmPasswordReset=10/600'])
        if (labels.indexOf(want) < 0) throw new Error('rule ' + want);
      const r = new Record(app.findCollectionByNameOrId('access_log'));
      r.set('event', 'password_set'); r.set('method', 'password'); app.save(r);
    }, app => {})`);
    const run = (...args: string[]) => execFileSync(resolve('../pocketbase/pocketbase'), ['migrate', ...args, '--dir', join(dir, 'data'),
      '--migrationsDir', migrations, '--hooksDir', hooks], { encoding: 'utf8', timeout: 15000, input: 'y\n', stdio: 'pipe', env: { ...process.env, CONDUCTOR_EMAIL: 'conductor@test.invalid' } });
    expect(run('up')).toContain('1759000001_check_up');
    expect(run('down', '2')).toContain('Reverted 1759000000_password_sign_in');
    // An older, unapplied file runs first on the next `up`, so it sees the rolled-back state.
    await writeFile(join(migrations, '1758999999_check_down.js'), `migrate(app => {
      const u = app.findCollectionByNameOrId('users');
      if (u.passwordAuth.enabled) throw new Error('password auth still on');
      if (u.resetPasswordTemplate.body.indexOf('/reset-password#') >= 0) throw new Error('template kept');
      if (app.findCollectionByNameOrId('boarding_requests').fields.getByName('password_hash')) throw new Error('password_hash kept');
      if (app.settings().rateLimits.rules.some((r) => r.label === 'users:authWithPassword')) throw new Error('rule kept');
      if (app.findRecordsByFilter('access_log', "method = 'password'", '', 0, 0).length !== 1) throw new Error('history lost');
    }, app => {})`);
    const again = run('up');
    expect(again).toContain('1758999999_check_down');
    expect(again).toContain('1759000000_password_sign_in');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

PocketBase applies any unapplied migration file whatever its timestamp; Codex confirmed this against 0.40.4's runner. That is why the older checker runs on the second `up`.

In `web/tests/unit/labels.test.ts`, add this to the describe block:

```ts
  it('names the sign-in method and events the password migration adds', () => {
    const migration = readFileSync('../pocketbase/pb_migrations/1759000000_password_sign_in.js', 'utf8');
    const added = (field: string) => JSON.parse(new RegExp(`ADDED_${field.toUpperCase()} = (\\[[^\\]]*\\])`).exec(migration)![1].replace(/'/g, '"')) as string[];
    expect(added('event')).toEqual(['password_reset_sent', 'password_set']);
    expect(added('method')).toEqual(['password']);
    for (const v of added('event')) expect(accessEventLabels[v], v).toBeTruthy();
    for (const v of added('method')) expect(signInMethodLabels[v], v).toBeTruthy();
  });
```

In `web/tests/hooks/users.test.ts`, replace the last two lines of that test (the comment and the `auth-with-password` expectation):

```ts
  // Password auth is on (password spec): only the right password signs in.
  const identity = `${Buffer.from(n.toLowerCase()).toString('hex')}@test.invalid`;
  expect((await post('/api/collections/users/auth-with-password', { identity, password: 'wrong-password-1' })).status).toBe(400);
  expect((await post('/api/collections/users/auth-with-password', { identity, password: 'seed-test-password-1' })).status).toBe(200);
```

In `web/tests/hooks/access.test.ts`, in "every sign-in method is guarded", capture the setting before the `try` and restore it in `finally`. Leave the `method = ""` expectation alone; Task 3 changes it.

```ts
    const before = (await (await fetch(`${PB}/api/collections/users`, { headers: await su() })).json()).passwordAuth.enabled as boolean;
    ...
    } finally {
      expect((await collection(before)).status).toBe(200);
    }
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npx vitest run tests/unit/labels.test.ts`, then `bash scripts/test-hooks.sh` from the root.
Expected: FAIL. The migration file is missing, so the labels test and the new migration test fail.

- [ ] **Step 3: Implement the migration**

`pocketbase/pb_migrations/1759000000_password_sign_in.js`:

```js
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
```

In `web/src/lib/labels.ts`: add `password: 'Password'` to `signInMethodLabels`, and to `accessEventLabels` add `password_reset_sent: 'Password link sent'` and `password_set: 'Set a password'`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run tests/unit/labels.test.ts`, then `bash scripts/test-hooks.sh`.
Expected: PASS.

- [ ] **Step 5: Run the full gate, then commit**

```bash
git add pocketbase/pb_migrations/1759000000_password_sign_in.js web/src/lib/labels.ts web/tests/hooks/migrations.test.ts web/tests/unit/labels.test.ts web/tests/hooks/users.test.ts web/tests/hooks/access.test.ts
git commit -m "feat(pb): password sign-in and reset switched on, with their limits and log values"
```

---

### Task 3: Sign-in, reset and race-safe saves (hooks)

**Files:**
- Modify: `pocketbase/pb_hooks/crew.js` (`METHODS.password`)
- Modify: `pocketbase/pb_hooks/access.pb.js` (four new hooks, plus one rule in `onRecordUpdateRequest`)
- Modify: `web/scripts/test-fakes.mjs` (the sink keeps `html`)
- Modify: `web/tests/hooks/setup.ts` (`Mail.html`, `resetLinkFor`)
- Modify: `web/tests/hooks/access.test.ts` (`method = "password"`)
- Create: `web/tests/hooks/password.test.ts`

**Interfaces:**
- Consumes Task 2's settings and log values.
- Produces, in `setup.ts`: `resetLinkFor(to: string): Promise<{ url: string; token: string }>`.

- [ ] **Step 1: Write the failing tests**

In `web/scripts/test-fakes.mjs`, change the push to keep the HTML part:
`messages.push({ to: …, subject: m.subject ?? '', text: m.text ?? '', html: typeof m.html === 'string' ? m.html : '' });`

In `web/tests/hooks/setup.ts`, change the type to `export type Mail = { to: string[]; subject: string; text: string; html: string };` and add:

```ts
/** The last password-reset link mailed to `to` (text or HTML part), polling: PocketBase mails after replying. */
export async function resetLinkFor(to: string): Promise<{ url: string; token: string }> {
  for (let i = 0; i < 50; i++) {
    const hit = (await mails(to)).map((m) => /(https?:\/\/[^\s"<]+\/reset-password#([\w.-]+))/.exec(`${m.text}\n${m.html}`)).filter(Boolean).at(-1);
    if (hit) return { url: hit[1], token: hit[2] };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No reset link mailed to ${to}`);
}
```

In `web/tests/hooks/access.test.ts`, the guard test now expects `method = "password"`, and its title becomes `'a password sign-in is guarded like every other method'`.

`web/tests/hooks/password.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { PB, clearMails, get, loginToken, mails, post, resetLinkFor, superuserToken, waitFor } from './setup';

const uid = () => Math.floor(Math.random() * 1e6);
const emailOf = (name: string) => `${Buffer.from(name.toLowerCase()).toString('hex')}@test.invalid`;
const SEED = 'seed-test-password-1';
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
const signIn = (identity: string, password: string) => post('/api/collections/users/auth-with-password', { identity, password });
const requestReset = (email: string) => post('/api/collections/users/request-password-reset', { email });
const confirm = (token: string, password: string) => post('/api/collections/users/confirm-password-reset', { token, password, passwordConfirm: password });
const block = async (id: string) => fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ blocked: true }) });
async function logRows(filter: string) {
  const q = new URLSearchParams({ filter, sort: '-created' });
  return (await (await fetch(`${PB}/api/collections/access_log/records?${q}`, { headers: await su() })).json()).items as any[];
}
async function member() { const name = `Pw ${uid()}`; const { id, token } = await loginToken(name); return { id, token, name, email: emailOf(name) }; }

describe('password sign-in (spec §3.2)', () => {
  beforeEach(clearMails);

  it('signs in with email and password, through the guard, logged as password', async () => {
    const m = await member();
    const res = await signIn(m.email, SEED);
    expect(res.status).toBe(200);
    expect((await res.json()).record.id).toBe(m.id);
    expect((await logRows(`user = "${m.id}" && event = "signed_in" && method = "password"`)).length).toBe(1);
  });

  it('a wrong password and an unknown address get the same answer', async () => {
    const m = await member();
    const wrong = await signIn(m.email, 'wrong-password-1'), unknown = await signIn(`nobody${uid()}@test.invalid`, 'wrong-password-1');
    expect(wrong.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('the 11th try on one address in 15 minutes is refused, even with the right password', async () => {
    const m = await member();
    for (let i = 0; i < 10; i++) expect((await signIn(m.email, `wrong-password-${i}`)).status).toBe(400);
    const capped = await signIn(m.email, SEED);
    expect(capped.status).toBe(429);
    expect((await capped.json()).message).toContain('email code or Google');
  });

  it('a put-off seat cannot sign in with its password', async () => {
    const m = await member();
    await block(m.id);
    expect((await signIn(m.email, SEED)).status).toBe(403);
  });
});

describe('password reset (spec §3.2)', () => {
  beforeEach(clearMails);

  it('mails a link into the app, with the token in the fragment, and logs it', async () => {
    const m = await member();
    expect((await requestReset(m.email)).status).toBe(204);
    const { url } = await resetLinkFor(m.email);
    expect(url.startsWith('http://127.0.0.1:15173/reset-password#')).toBe(true);
    expect((await mails(m.email)).at(-1)?.subject).toBe('Set your Chug-a-Lug password');
    // Logged only after the send returns, and the sink can publish the message before that.
    await waitFor(async () => (await logRows(`user = "${m.id}" && event = "password_reset_sent"`)).length === 1);
  });

  it('an unknown address and a put-off seat get the same empty 204 and no mail', async () => {
    const m = await member();
    await block(m.id);
    for (const email of [`nobody${uid()}@test.invalid`, m.email]) {
      const res = await requestReset(email);
      expect(res.status, email).toBe(204);
      expect(await res.text(), email).toBe('');
    }
    await new Promise((r) => setTimeout(r, 700));
    expect(await mails(m.email)).toEqual([]);
  });

  it('confirm sets the password, ends old sessions, is logged, and the link works once', async () => {
    const m = await member();
    await requestReset(m.email);
    const { token } = await resetLinkFor(m.email);
    expect((await confirm(token, 'brand-new-pass-1')).status).toBe(204);
    expect((await signIn(m.email, 'brand-new-pass-1')).status).toBe(200);
    expect((await signIn(m.email, SEED)).status).toBe(400);
    expect((await get('/api/crawl/me', m.token)).status).toBe(401);
    expect((await confirm(token, 'another-pass-22')).status).toBe(400);
    expect((await logRows(`user = "${m.id}" && event = "password_set"`)).length).toBe(1);
  });

  it('a link mailed before a put-off is dead', async () => {
    const m = await member();
    await requestReset(m.email);
    const { token } = await resetLinkFor(m.email);
    await block(m.id);
    expect((await confirm(token, 'brand-new-pass-1')).status).toBe(400);
  });

  it('a name change after a reset keeps the new password; a superuser can still set one', async () => {
    const m = await member();
    await requestReset(m.email);
    await confirm((await resetLinkFor(m.email)).token, 'brand-new-pass-1');
    const session = (await (await signIn(m.email, 'brand-new-pass-1')).json()).token;
    const rename = await fetch(`${PB}/api/collections/users/records/${m.id}`, { method: 'PATCH', headers: { Authorization: session, 'content-type': 'application/json' }, body: JSON.stringify({ name: `Pw Renamed ${uid()}` }) });
    expect(rename.status).toBe(200);
    expect((await signIn(m.email, 'brand-new-pass-1')).status).toBe(200);
    const set = await fetch(`${PB}/api/collections/users/records/${m.id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ password: 'admin-set-pass-1', passwordConfirm: 'admin-set-pass-1' }) });
    expect(set.status).toBe(200);
    expect((await signIn(m.email, 'admin-set-pass-1')).status).toBe(200);
  });

  // Spec §6, races: fired together, like decisions.test's double decision. These cannot force an
  // interleaving, but each run gives it a real chance, and every outcome must hold the invariant.
  it('two confirmations of one link sent together: exactly one wins', async () => {
    const m = await member();
    await requestReset(m.email);
    const { token } = await resetLinkFor(m.email);
    const codes = (await Promise.all([confirm(token, 'race-pass-one-1'), confirm(token, 'race-pass-two-2')])).map((r) => r.status).sort();
    expect(codes).toEqual([204, 400]);
  });

  it('a put-off sent together with a confirmation: the seat ends put off and the old session is dead', async () => {
    const m = await member();
    await requestReset(m.email);
    const { token } = await resetLinkFor(m.email);
    await Promise.all([confirm(token, 'race-pass-one-1'), block(m.id)]);
    const user = await (await fetch(`${PB}/api/collections/users/records/${m.id}`, { headers: await su() })).json();
    expect(user.blocked).toBe(true);
    expect((await get('/api/crawl/me', m.token)).status).toBe(401);
    // 403 if the confirmation landed first (guard), 400 if the put-off did (the link died first).
    expect([400, 403]).toContain((await signIn(m.email, 'race-pass-one-1')).status);
  });

  it('a rename sent together with a confirmation never brings the old password back', async () => {
    const m = await member();
    await requestReset(m.email);
    const { token } = await resetLinkFor(m.email);
    const rename = fetch(`${PB}/api/collections/users/records/${m.id}`, { method: 'PATCH', headers: { Authorization: m.token, 'content-type': 'application/json' }, body: JSON.stringify({ name: `Pw Racer ${uid()}` }) });
    const [set] = await Promise.all([confirm(token, 'race-pass-one-1'), rename]);
    expect(set.status).toBe(204);
    expect((await signIn(m.email, 'race-pass-one-1')).status).toBe(200);
    expect((await signIn(m.email, SEED)).status).toBe(400);
  });

  it('confirmation applies PocketBase\'s own rule: code points and 72 bytes, like /join', async () => {
    for (const [password, ok] of [['😀'.repeat(4), false], ['é'.repeat(36) + 'a', false], ['😀'.repeat(8), true]] as const) {
      const m = await member();
      await requestReset(m.email);
      expect((await confirm((await resetLinkFor(m.email)).token, password)).status, password).toBe(ok ? 204 : 400);
    }
  });
});
```

The reset tests use a fresh member each time, because PocketBase ignores a second reset request for one record within two minutes. The 3-per-hour cap cannot be reached inside that cooldown, so it is reviewed rather than tested (spec §6).

- [ ] **Step 2: Run them and watch them fail**

Run: `bash scripts/test-hooks.sh`
Expected: FAIL. `signed_in` is logged with an empty method, the 11th try gets 400 instead of 429, a put-off seat still gets a reset mail, and nothing logs `password_reset_sent` or `password_set`.

- [ ] **Step 3: Implement**

In `crew.js`, change the methods map to `exports.METHODS = { otp: 'email', oauth2: 'google', rehearsal: 'rehearsal', password: 'password' }`.

In `access.pb.js`, add these after `onMailerRecordOTPSend`:

```js
// Password sign-in (password spec §3.2). Every try counts against the typed address, member or not,
// before PocketBase compares the password: the limit reveals nothing, and it holds with
// PB_RATE_LIMITS=off. The person locked out keeps email code and Google.
onRecordAuthWithPasswordRequest((e) => {
  const crew = require(`${__hooks}/crew.js`)
  const identity = String(e.identity || '').trim().toLowerCase()
  if (!require(`${__hooks}/limits.js`).consume('password:' + identity, 10, 900)) {
    crew.logEvent($app, { event: 'rate_limited', method: 'password', detail: 'password' }, crew.clientInfo(e))
    return e.json(429, { message: 'Too many tries for this address. Use an email code or Google, or try again in 15 minutes.' })
  }
  e.next()
}, 'users')

// Runs only for an address with a seat, after PocketBase's two-minute cooldown. A put-off seat, or
// a fourth link in an hour, gets the same empty 204 as a sent link, and no mail.
onRecordRequestPasswordResetRequest((e) => {
  if (e.record.getBool('blocked')) return e.noContent(204)
  if (!require(`${__hooks}/limits.js`).consume('reset:' + e.record.email().toLowerCase(), 3, 3600)) return e.noContent(204)
  e.next()
}, 'users')

onMailerRecordPasswordResetSend((e) => {
  if (e.record.getBool('blocked')) return
  e.next()
  require(`${__hooks}/crew.js`).logEvent($app, { event: 'password_reset_sent', method: 'password', user: e.record.id, email: e.record.email() })
}, 'users')

// PocketBase checks the token against a record it loaded earlier and saves that instance after
// e.next(). Judged and saved in one transaction against a fresh read, so a put-off or a second
// confirmation committed in between is never written back stale: a changed token key means the
// link is dead (single-use, also under concurrency); a block refuses.
onRecordConfirmPasswordResetRequest((e) => {
  const app = e.app
  let refusal = null
  try {
    app.runInTransaction((tx) => {
      e.app = tx
      const fresh = tx.findRecordById('users', e.record.id)
      if (fresh.tokenKey() !== e.record.tokenKey()) { refusal = [400, 'That link expired or was already used.']; return }
      if (fresh.getBool('blocked')) { refusal = [403, 'Your seat was taken away. Ask the Conductor.']; return }
      // A reset changes the password and nothing else: every other field comes from the fresh row,
      // preferences included (share_position, home_station, left_early).
      for (const k of e.record.collection().fields.fieldNames()) if (k !== 'password' && k !== 'tokenKey') e.record.setRaw(k, fresh.getRaw(k))
      e.next()
    })
  } finally { e.app = app }
  if (refusal) return e.json(refusal[0], { message: refusal[1] })
  const crew = require(`${__hooks}/crew.js`) // after the commit: logEvent writes with $app
  crew.logEvent($app, { event: 'password_set', method: 'password', user: e.record.id, email: e.record.email() }, crew.clientInfo(e))
}, 'users')
```

In the existing `onRecordUpdateRequest`, add these lines right after the `for (const k of ['blocked', …]) if (!named(k)) …` line:

```js
      // A password this request sets (a superuser in the admin UI) stands; otherwise the stored hash
      // does, so an edit loaded before a reset never writes the old password back (password spec §3.2).
      if (!named('password')) e.record.setRaw('password', fresh.getRaw('password'))
```

If `setRaw` refuses the field-value object, the rename test above fails with "Invalid or unsupported value type". In that case use `e.record.setRaw('password', e.record.collection().fields.getByName('password').prepareValue(e.record, fresh.getRaw('password').hash))`, and ledger the ruling.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `bash scripts/test-hooks.sh`
Expected: PASS, including `access.test.ts` with method `password`.

- [ ] **Step 5: Run the full gate, then commit**

```bash
git add pocketbase/pb_hooks/crew.js pocketbase/pb_hooks/access.pb.js web/scripts/test-fakes.mjs web/tests/hooks/setup.ts web/tests/hooks/access.test.ts web/tests/hooks/password.test.ts
git commit -m "feat(pb): password sign-in and reset, throttled per address, safe against put-off and stale saves"
```

---

### Task 4: Boarding with a password (server and `/join`)

**Files:**
- Modify: `pocketbase/pb_hooks/crew.js` (`hashPassword`)
- Modify: `pocketbase/pb_hooks/boarding.js` (`join`, `fileRequest`, its mail-failure expiry, `decide`, `sweep`, `daily`)
- Modify: `web/src/lib/pb.ts` (`joinCrew` gains `password`)
- Modify: `web/src/routes/join/+page.svelte`
- Modify: `web/tests/hooks/boarding.test.ts`, `web/tests/hooks/decisions.test.ts`, `web/tests/e2e/boarding.spec.ts`

**Interfaces:**
- Consumes `passwordProblem` (Task 1), `password_hash` (Task 2) and `PasswordInput` (Task 1).
- Produces `crew.hashPassword(app, p): string`, a bcrypt hash. Produces `joinCrew(name, email, password, turnstile)`.

- [ ] **Step 1: Write the failing tests**

In `web/tests/hooks/boarding.test.ts`, the `join` helper sends a password unless the test overrides it:
`const join = (ip: string, body: Record<string, unknown>) => postFrom(ip, '/api/crawl/join', { turnstile: turnstileToken(), password: 'boarding-pass-1', ...body });`

In `web/tests/hooks/decisions.test.ts`, add `password: 'boarding-pass-1'` to both `/api/crawl/join` bodies (in `waitingRequest`, and at line 93).

Add these to the `joining by email` describe in `boarding.test.ts`:

```ts
  it('refuses a missing, short or four-emoji password', async () => {
    for (const password of [undefined, 'short1', '😀😀😀😀']) {
      const res = await join(randomIp(), { name: `NoPass ${uid()}`, email: `np${uid()}@test.invalid`, password });
      expect(res.status, String(password)).toBe(400);
      expect((await res.json()).message).toBe('Pick a password of 8 to 64 characters.');
    }
  });

  it('keeps only a bcrypt hash of the chosen password on the request', async () => {
    const r = await (await join(randomIp(), { name: `Hashed ${uid()}`, email: `h${uid()}@test.invalid` })).json();
    const stored = await row(r.request_id);
    expect(stored.password_hash).toMatch(/^\$2a\$10\$.{53}$/);
    expect(JSON.stringify(stored)).not.toContain('boarding-pass-1');
  });

  it('a decoy for a member stores a hash like any request and never touches the member\'s password', async () => {
    const n = uid();
    await loginToken(`Pw Member ${n}`);
    const memberEmail = `${Buffer.from(`pw member ${n}`).toString('hex')}@test.invalid`;
    const d = await (await join(randomIp(), { name: `Pw Taker ${n}`, email: memberEmail, password: 'takeover-pass-1' })).json();
    expect((await row(d.request_id)).password_hash).toMatch(/^\$2a\$/);
    const signIn = (password: string) => postFrom(randomIp(), '/api/collections/users/auth-with-password', { identity: memberEmail, password });
    expect((await signIn('takeover-pass-1')).status).toBe(400);
    expect((await signIn('seed-test-password-1')).status).toBe(200);
  });

  it('a mail failure clears the hash, for a real request and a decoy alike', async () => {
    const n = uid();
    await loginToken(`Fail Member ${n}`);
    await mailMode('fail');
    for (const email of [`nomailpw${n}@test.invalid`, `${Buffer.from(`fail member ${n}`).toString('hex')}@test.invalid`]) {
      expect((await join(randomIp(), { name: `Fail ${uid()}`, email })).status, email).toBe(502);
      const q = new URLSearchParams({ filter: `email = "${email}"` });
      const rows = (await (await fetch(`${PB}/api/collections/boarding_requests/records?${q}`, { headers: await su() })).json()).items;
      expect(rows.map((x: { status: string; password_hash: string }) => [x.status, x.password_hash]), email).toEqual([['expired', '']]);
    }
    await mailMode('ok');
  });
```

In the existing test "the sweep expires unverified requests after 30 min", add after the `waitFor` line:
`expect((await row(r.request_id)).password_hash).toBe('');`

Add these to the `deciding boarding requests` describe in `decisions.test.ts`:

```ts
  it('let aboard installs the chosen password, clears the hash and says so in the mail', async () => {
    const crew = await loginToken(`Pw Voucher ${uid()}`);
    const g = await waitingRequest();
    expect((await decide(g.request_id, 'let-aboard', crew.token)).status).toBe(200);
    expect((await post('/api/collections/users/auth-with-password', { identity: g.email, password: 'boarding-pass-1' })).status).toBe(200);
    const req = await (await fetch(`${PB}/api/collections/boarding_requests/records/${g.request_id}`, { headers: await su() })).json();
    expect(req.password_hash).toBe('');
    expect((await mails(g.email)).at(-1)?.text).toContain('the password you chose');
  });

  it('a request filed before passwords existed is let aboard with the email-or-Google notice', async () => {
    const crew = await loginToken(`Old Voucher ${uid()}`);
    const email = `old${uid()}@test.invalid`, n = uid();
    const seeded = await (await fetch(`${PB}/api/collections/boarding_requests/records`, { method: 'POST', headers: await su(),
      body: JSON.stringify({ name: `Old ${n}`, name_key: `old ${n}`, email, method: 'email', status: 'waiting', ip: randomIp(),
        status_at: new Date().toISOString().replace('T', ' '), code_sent_at: new Date().toISOString().replace('T', ' ') }) })).json();
    expect((await decide(seeded.id, 'let-aboard', crew.token)).status).toBe(200);
    expect((await mails(email)).at(-1)?.text).toContain('this email address or Google');
  });

  it('turning a request away clears its hash', async () => {
    const crew = await loginToken(`Pw Away ${uid()}`);
    const g = await waitingRequest();
    expect((await decide(g.request_id, 'turn-away', crew.token)).status).toBe(200);
    const req = await (await fetch(`${PB}/api/collections/boarding_requests/records/${g.request_id}`, { headers: await su() })).json();
    expect(req.password_hash).toBe('');
  });
```

The hook tests read `password_hash` as superuser. PocketBase 0.40.4 shows hidden fields to superusers, which the spec (§4) accepts. Also add this test, which proves nobody else sees the hash:

```ts
  it('crew and the Conductor never see a request\'s password hash', async () => {
    const ip = randomIp(), email = `seen${uid()}@test.invalid`;
    const r = await (await join(ip, { name: `Seen ${uid()}`, email })).json();
    await postFrom(ip, '/api/crawl/join/verify', { ...r, code: await codeFor(email) });
    for (const who of [await loginToken(`Pw Crew ${uid()}`), await loginToken(`Pw Conductor ${uid()}`, ADMIN_LOGIN_PASSWORD)]) {
      const list = await (await fetch(`${PB}/api/collections/boarding_requests/records?perPage=200`, { headers: { Authorization: who.token } })).json();
      const view = await (await fetch(`${PB}/api/collections/boarding_requests/records/${r.request_id}`, { headers: { Authorization: who.token } })).json();
      expect(list.items.some((x: { id: string }) => x.id === r.request_id)).toBe(true);
      expect(JSON.stringify(list)).not.toContain('password_hash');
      expect(view.id).toBe(r.request_id);
      expect(view).not.toHaveProperty('password_hash');
    }
  });
```

Add `ADMIN_LOGIN_PASSWORD` to `boarding.test.ts`'s import from `./setup`.

In `web/tests/e2e/boarding.spec.ts`, after each `getByTestId('email-input').fill(email)` on a `/join` page (three places: about lines 11, 47 and 91), add:
`await page.getByTestId('password-input').fill('boarding-pass-1');` (use `g.` instead of `page.` in the third). The sign-in at the end of the first test stays on the code path for now; Task 5 changes it.

- [ ] **Step 2: Run them and watch them fail**

Run: `bash scripts/test-hooks.sh`
Expected: FAIL. The new tests fail because `join` ignores the password and `password_hash` stays empty.

- [ ] **Step 3: Implement the server side**

In `crew.js`, after `passwordProblem`:

```js
// The bcrypt hash PocketBase would store for `p`, from a throwaway, unsaved users record. Verified on
// 0.40.4 (2026-10-03): written to users.password by SQL, it validates; setRaw of the string does not.
exports.hashPassword = function (app, p) {
  const r = new Record(app.findCollectionByNameOrId('users'))
  r.setPassword(p)
  return r.getRaw('password').hash
}
```

In `boarding.js`:

- `join`: after the email check, add:
  ```js
  const problem = crew.passwordProblem(body.password)
  if (problem) return e.json(400, { message: problem })
  const [status, json] = exports.fileRequest(e, { name, email, method: 'email', info, passwordHash: crew.hashPassword($app, body.password) })
  ```
  This replaces the existing `fileRequest` call line.
- `fileRequest`: destructure `passwordHash` from `x`, and after `record.set('method', method)` add `record.set('password_hash', passwordHash || '') // decoys too: same cost, same answer; never applied`.
- The mail-failure expiry inside `fileRequest`: next to `r.set('status', 'expired')`, add `r.set('password_hash', '')`.
- `sweep`: `r.set('status', 'expired'); r.set('status_at', nowIso()); r.set('password_hash', ''); tx.save(r)`.
- `daily`: add `app.db().newQuery("UPDATE boarding_requests SET password_hash = '' WHERE password_hash != '' AND status NOT IN ('unverified', 'waiting')").execute()`.
- `decide`: declare `let installed = false, method = ''` beside `result`. Inside the transaction, after the decoy/status check, set `method = request.getString('method')`. In the aboard branch, right after `tx.save(user)`:
  ```js
      // The hash /join stored becomes the password (spec §3.2). SQL, because setRaw rejects a hash.
      const hash = request.getString('password_hash')
      if (hash) {
        tx.db().newQuery('UPDATE users SET password = {:h} WHERE id = {:id}').bind({ h: hash, id: user.id }).execute()
        installed = true
      }
  ```
  Before `tx.save(request)` (both verdicts), set `request.set('password_hash', '')`. Then change the aboard mail text:
  ```js
    const how = installed ? 'with your email and the password you chose' : method === 'google' ? 'with Google' : 'with this email address or Google'
    try { crew.sendMail($app, { to: [user.email()], subject: "You're aboard the Chug-a-Lug", text: `You're aboard! Sign in at ${$app.settings().meta.appURL}/login ${how}.` }) }
  ```

- [ ] **Step 4: Implement the client side**

In `web/src/lib/pb.ts`:

```ts
export const joinCrew = (name: string, email: string, password: string, turnstile: string) =>
  pb.send<{ request_id: string; secret: string }>('/api/crawl/join', { method: 'POST', body: { name, email, password, turnstile } });
```

In `web/src/routes/join/+page.svelte`:
- Import `PasswordInput from '$lib/components/PasswordInput.svelte'` and `{ passwordProblem } from '$lib/password'`.
- Add `password = $state('')` to the `let name = $state('')…` line.
- In `start`, after the email check, add `const problem = passwordProblem(password); if (problem) { error = problem; return; }`, and call `joinCrew(cleanName(), email.trim(), password, token)`.
- After the email input:
  ```svelte
    <label for="join-password">{copy.passwordField}</label>
    <PasswordInput id="join-password" autocomplete="new-password" bind:value={password} disabled={busy} testid="password-input" />
    <small class="hint">{copy.passwordHint}</small>
  ```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `bash scripts/test-hooks.sh`, then `cd web && npm run test:e2e -- boarding`.
Expected: PASS.

- [ ] **Step 6: Run the full gate, then commit**

```bash
git add pocketbase/pb_hooks/crew.js pocketbase/pb_hooks/boarding.js web/src/lib/pb.ts web/src/routes/join/+page.svelte web/tests/hooks/boarding.test.ts web/tests/hooks/decisions.test.ts web/tests/e2e/boarding.spec.ts
git commit -m "feat: choose a password when boarding; let aboard installs it"
```

---

### Task 5: Sign-in, forgot and reset pages

**Files:**
- Modify: `web/src/lib/pb.ts` (`signInWithPassword`, `requestPasswordReset`, `confirmPasswordReset`)
- Create: `web/src/lib/signInEmail.ts`
- Modify: `web/src/routes/login/+page.svelte`
- Create: `web/src/routes/login/forgot/+page.svelte`
- Create: `web/src/routes/reset-password/+page.svelte`
- Modify: `web/src/lib/labels.ts`
- Modify: `web/tests/e2e/helpers.ts` (`resetLinkFor`), `web/tests/e2e/boarding.spec.ts` (sign in with the password)
- Create: `web/tests/e2e/password.spec.ts`
- Test: `web/tests/unit/labels.test.ts`

**Interfaces:**
- Consumes `PasswordInput`, `passwordProblem` and `resetTokenEmail` (Task 1), and the server behavior from Tasks 2–4.
- Produces, in `pb.ts`: `signInWithPassword(email, password): Promise<void>`, `requestPasswordReset(email): Promise<void>`, `confirmPasswordReset(token, password): Promise<void>`.
- Produces, in `signInEmail.ts`: `typedEmail: Writable<string>`.

- [ ] **Step 1: Write the failing tests**

In `web/tests/unit/labels.test.ts`:

```ts
  it('has copy for password sign-in and reset', () => {
    for (const k of ['passwordMismatch', 'passwordMissing', 'forgotPassword', 'useCodeInstead', 'usePasswordInstead', 'forgotTitle', 'forgotIntro',
      'emailMeLink', 'linkMaybeSent', 'backToSignIn', 'resetTitle', 'setPassword', 'passwordSetSignIn', 'resetLinkDead', 'askNewLink']) {
      expect((copy as Record<string, string>)[k], k).toBeTruthy();
    }
    expect(copy.loginIntro).toBe('Sign in with Google or with your email and password.');
  });
```

In `web/tests/e2e/helpers.ts`, beside `codeFor`:

```ts
export async function resetLinkFor(to: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const all = (await (await fetch(`${MAIL}/messages`)).json()) as { to: string[]; text: string; html?: string }[];
    const url = all.filter((m) => m.to.includes(to.toLowerCase())).map((m) => /(https?:\/\/[^\s"<]+\/reset-password#[\w.-]+)/.exec(`${m.text}\n${m.html ?? ''}`)?.[1]).filter(Boolean).at(-1);
    if (url) return url;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No reset link mailed to ${to}`);
}
```

`web/tests/e2e/password.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { clearMails, codeFor, resetLinkFor, sessionFor } from './helpers';
import { copy } from '../../src/lib/labels';

const uid = () => Math.floor(Math.random() * 1e6);
const emailOf = (name: string) => `${Buffer.from(name.toLowerCase()).toString('hex')}@test.invalid`;

test('signs in with email and password; a wrong one says so; Show reveals it', async ({ page }) => {
  const name = `Pw Rider ${uid()}`;
  await sessionFor(name);
  await page.goto('/login');
  await page.getByTestId('email-input').fill(emailOf(name).toUpperCase());
  await page.getByTestId('password-input').fill('wrong-password-1');
  await page.getByTestId('password-sign-in').click();
  await expect(page.getByTestId('error')).toHaveText(copy.passwordMismatch);
  await page.getByTestId('password-input').fill('seed-test-password-1');
  await page.getByTestId('password-input-show').click();
  await expect(page.getByTestId('password-input')).toHaveAttribute('type', 'text');
  await page.getByTestId('password-sign-in').click();
  await expect(page.getByTestId('name')).toHaveText(name);
});

test('forgot password: the link sets a new one and signs in, without leaving the token in the address bar', async ({ page }) => {
  const name = `Pw Forgetful ${uid()}`, email = emailOf(name);
  await sessionFor(name); await clearMails();
  await page.goto('/login');
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('forgot').click();
  await expect(page).toHaveURL(/\/login\/forgot$/);
  await expect(page.getByTestId('email-input')).toHaveValue(email);
  await page.getByTestId('send-link').click();
  await expect(page.getByTestId('link-sent')).toHaveText(copy.linkMaybeSent);
  await page.goto(await resetLinkFor(email));
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByTestId('password-input').fill('brand-new-pass-1');
  await page.getByTestId('set-password').click();
  await expect(page.getByTestId('name')).toHaveText(name);
});

test('a dead reset link says so and offers a new one', async ({ page }) => {
  await page.goto('/reset-password#not-a-real-token');
  await page.getByTestId('password-input').fill('brand-new-pass-1');
  await page.getByTestId('set-password').click();
  await expect(page.getByTestId('reset-dead')).toHaveText(copy.resetLinkDead);
  await expect(page.getByRole('link', { name: copy.askNewLink })).toHaveAttribute('href', '/login/forgot');
});

test('a mangled reset link is dead at once, and the fragment is gone', async ({ page }) => {
  await page.goto('/reset-password#%E0%A4%A');
  await expect(page.getByTestId('reset-dead')).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
});

test('email me a code instead still signs in', async ({ page }) => {
  const name = `Pw Coder ${uid()}`, email = emailOf(name);
  await sessionFor(name); await clearMails();
  await page.goto('/login');
  await page.getByTestId('use-code').click();
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('send-code').click();
  await page.getByTestId('code-input').fill(await codeFor(email));
  await page.getByTestId('sign-in').click();
  await expect(page.getByTestId('name')).toHaveText(name);
});
```

In `web/tests/e2e/boarding.spec.ts`, the first test now ends by signing in with the chosen password. Replace the lines from `await clearMails();` after `aboard` through the end of the test with:

```ts
  await page.getByTestId('go-sign-in').click();
  await page.getByTestId('email-input').fill(email.toUpperCase());
  await page.getByTestId('password-input').fill('boarding-pass-1');
  await page.getByTestId('password-sign-in').click();
  await expect(page.getByTestId('name')).toHaveText(`Visitor ${n}`);
```

Also update its title to `'a visitor boards by email with a password, waits, is let aboard and signs in with it'`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npx vitest run tests/unit/labels.test.ts && npm run test:e2e -- password boarding`
Expected: FAIL. The labels are missing and `password-sign-in` does not exist.

- [ ] **Step 3: Implement**

In `labels.ts` (`copy`), change `loginIntro` and `loginIntroNoGoogle`, and add the rest:

```ts
  loginIntro: 'Sign in with Google or with your email and password.',
  loginIntroNoGoogle: 'Sign in with your email and password.',
  passwordMismatch: "That email and password don't match.",
  passwordMissing: 'Enter your password.',
  forgotPassword: 'Forgot password?',
  useCodeInstead: 'Email me a code instead',
  usePasswordInstead: 'Use a password instead',
  forgotTitle: 'Forgot your password?',
  forgotIntro: 'Enter your email. If it has a seat, we email you a link to set a new password.',
  emailMeLink: 'Email me a link',
  linkMaybeSent: 'If that address has a seat, a link is on its way. It works for 30 minutes.',
  backToSignIn: 'Back to sign in',
  resetTitle: 'Set a new password',
  setPassword: 'Set password',
  passwordSetSignIn: 'Password set. Sign in.',
  resetLinkDead: 'That link expired or was already used.',
  askNewLink: 'Ask for a new link',
```

`web/src/lib/signInEmail.ts`:

```ts
import { writable } from 'svelte/store';
/** The address typed on /login, carried to /login/forgot in memory so it never lands in a URL. */
export const typedEmail = writable('');
```

In `web/src/lib/pb.ts`, after `signInWithCode`:

```ts
/** Email + password sign-in (password spec §2.1). Lowercased like requestCode: addresses are stored lowercased. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  await pb.collection('users').authWithPassword(email.trim().toLowerCase(), password);
}
/** Always resolves the same way for any address (PocketBase answers 204), so nothing is revealed. */
export async function requestPasswordReset(email: string): Promise<void> {
  await pb.collection('users').requestPasswordReset(email.trim().toLowerCase());
}
export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  await pb.collection('users').confirmPasswordReset(token, password, password);
}
```

In `web/src/routes/login/+page.svelte`, keep the rehearsal branch byte for byte. Changes:
- Imports: add `signInWithPassword` to the `$lib/pb` import, plus `import { typedEmail } from '$lib/signInEmail';` and `import PasswordInput from '$lib/components/PasswordInput.svelte';`.
- State: `let email = $state($typedEmail)` (the existing `email` declaration starts from the store), and add `let mode = $state<'password' | 'code'>('password');`.
- Add the handler:
  ```ts
  const withPassword = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    if (!password) { error = copy.passwordMissing; return; }
    void run(async () => {
      try { await signInWithPassword(email, password); }
      catch (e) { if (e instanceof ClientResponseError && e.status === 400) { error = copy.passwordMismatch; return; } throw e; }
    }); };
  const toCode = () => { mode = 'code'; error = ''; };
  const toPassword = () => { mode = 'password'; otpId = ''; code = ''; error = ''; };
  ```
- Replace the non-rehearsal branch with:
  ```svelte
  {:else}
    <p>{google ? copy.loginIntro : copy.loginIntroNoGoogle}</p>
    {#if google}<SignInButton provider="google" label={copy.continueGoogle} onclick={withGoogle} disabled={busy} testid="google" /><p>{copy.orEmail}</p>{/if}
    {#if mode === 'password'}
      <form onsubmit={withPassword} aria-busy={busy}>
        <label for="email">{copy.emailLabel}</label>
        <input id="email" type="email" autocomplete="username" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} />
        <label for="password">{copy.passwordField}</label>
        <PasswordInput id="password" autocomplete="current-password" bind:value={password} disabled={busy} testid="password-input" />
        <SignInButton provider="email" type="submit" label={busy ? copy.working : copy.signIn} disabled={busy} testid="password-sign-in" />
      </form>
      <p class="hint"><a href="/login/forgot" onclick={() => typedEmail.set(email.trim())} data-testid="forgot">{copy.forgotPassword}</a> · <button type="button" class="link" onclick={toCode} data-testid="use-code">{copy.useCodeInstead}</button></p>
    {:else if !otpId}
      <form onsubmit={sendCode} aria-busy={busy}>
        <label for="email">{copy.emailLabel}</label>
        <input id="email" type="email" autocomplete="email" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} />
        <SignInButton provider="email" type="submit" label={busy ? copy.working : copy.emailMeCode} disabled={busy} testid="send-code" />
      </form>
      <p class="hint"><button type="button" class="link" onclick={toPassword} data-testid="use-password">{copy.usePasswordInstead}</button></p>
    {:else}
      <!-- the existing code-entry form, unchanged -->
    {/if}
    <p><a href="/join" data-testid="to-join">{copy.newHereBoard}</a></p>
  {/if}
  ```

`web/src/routes/login/forgot/+page.svelte`:

```svelte
<script lang="ts">
  // Password spec §2.2: the same answer whatever the address.
  import { ClientResponseError } from 'pocketbase';
  import { requestPasswordReset } from '$lib/pb';
  import { typedEmail } from '$lib/signInEmail';
  import { copy } from '$lib/labels';
  let email = $state($typedEmail), sent = $state(false), error = $state(''), busy = $state(false);
  const send = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    if (busy) return; busy = true; error = '';
    requestPasswordReset(email).then(() => { sent = true; },
      (e) => { error = e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError; })
      .finally(() => { busy = false; });
  };
</script>

<h1>{copy.forgotTitle}</h1>
{#if sent}
  <p data-testid="link-sent">{copy.linkMaybeSent}</p>
{:else}
  <p>{copy.forgotIntro}</p>
  <form onsubmit={send} aria-busy={busy}>
    <label for="email">{copy.emailLabel}</label>
    <input id="email" type="email" autocomplete="email" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} />
    <button type="submit" disabled={busy} data-testid="send-link">{busy ? copy.working : copy.emailMeLink}</button>
  </form>
{/if}
{#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
<p><a href="/login">{copy.backToSignIn}</a></p>
```

`web/src/routes/reset-password/+page.svelte`:

```svelte
<script lang="ts">
  // Password spec §2.3. The token rides in the fragment: read once, then wiped from the address bar.
  import { afterNavigate, goto, replaceState } from '$app/navigation';
  import { ClientResponseError } from 'pocketbase';
  import { confirmPasswordReset, signInWithPassword } from '$lib/pb';
  import { passwordProblem, resetTokenEmail } from '$lib/password';
  import { copy } from '$lib/labels';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  let token = '', password = $state(''), error = $state(''), busy = $state(false);
  let state = $state<'form' | 'dead' | 'set'>('form');
  const message = (e: unknown) => e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;
  // afterNavigate, not onMount: it runs once the router is ready (also on the first load), and
  // replaceState throws or misbehaves before that. A fragment that will not decode is a dead link.
  let read = false;
  afterNavigate(() => {
    if (read) return;
    read = true;
    try { token = decodeURIComponent(location.hash.slice(1)); } catch { token = ''; }
    if (location.hash) replaceState(location.pathname, {});
    if (!token) state = 'dead';
  });
  const submit = (ev: SubmitEvent) => { ev.preventDefault();
    const problem = passwordProblem(password);
    if (problem) { error = problem; return; }
    if (busy) return; busy = true; error = '';
    void (async () => {
      try { await confirmPasswordReset(token, password); }
      catch (e) {
        busy = false;
        // A field error (data.password) is about the password; anything else at 400 is the link.
        if (e instanceof ClientResponseError && e.status === 400 && !e.response?.data?.password) state = 'dead';
        else error = message(e);
        return;
      }
      state = 'set';
      const email = resetTokenEmail(token);
      if (!email) { busy = false; return; }
      try { await signInWithPassword(email, password); await goto('/', { replaceState: true }); }
      catch (e) { error = message(e); }
      finally { busy = false; }
    })();
  };
</script>

<h1>{copy.resetTitle}</h1>
{#if state === 'dead'}
  <p data-testid="reset-dead">{copy.resetLinkDead}</p>
  <p><a href="/login/forgot">{copy.askNewLink}</a></p>
{:else if state === 'set'}
  <p data-testid="password-set">{copy.passwordSetSignIn}</p>
  <p><a href="/login">{copy.signIn}</a></p>
{:else}
  <form onsubmit={submit} aria-busy={busy}>
    <label for="new-password">{copy.newPasswordField}</label>
    <PasswordInput id="new-password" autocomplete="new-password" bind:value={password} disabled={busy} testid="password-input" />
    <small class="hint">{copy.passwordHint}</small>
    <button type="submit" disabled={busy} data-testid="set-password">{busy ? copy.working : copy.setPassword}</button>
  </form>
{/if}
{#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
```

`replaceState` from `$app/navigation` is SvelteKit's shallow-routing API. Codex found it unsafe inside `onMount` on these versions, because the router may not be initialised yet; `afterNavigate` runs after it is. Never call `history.replaceState` directly: SvelteKit warns against it. The e2e test opens the link with `page.goto`, a full load, so it exercises the first-load path.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run tests/unit/labels.test.ts && npm run check && npm run test:e2e -- password boarding login`
Expected: PASS.

- [ ] **Step 5: Run the full gate, then commit**

```bash
git add web/src/lib/pb.ts web/src/lib/signInEmail.ts web/src/routes/login/+page.svelte web/src/routes/login/forgot/+page.svelte web/src/routes/reset-password/+page.svelte web/src/lib/labels.ts web/tests/unit/labels.test.ts web/tests/e2e/helpers.ts web/tests/e2e/password.spec.ts web/tests/e2e/boarding.spec.ts
git commit -m "feat(web): sign in with email and password, forgot password, and the reset page"
```

---

### Task 6: Account link and the docs

**Files:**
- Modify: `web/src/routes/(app)/account/+page.svelte`
- Modify: `web/src/lib/labels.ts` (`accountPasswordHint`, `linkSentTo`)
- Modify: `web/tests/e2e/password.spec.ts`
- Modify: `docs/OPERATIONS.md` (Crew access section), `CLAUDE.md` (the "Users are keyed by email" trap), `README.md` (lines ~37 and ~427)

**Interfaces:**
- Consumes `requestPasswordReset` (Task 5) and `resetLinkFor` (e2e helpers, Task 5).

- [ ] **Step 1: Write the failing test**

Append to `web/tests/e2e/password.spec.ts` (add `login` to the helpers import):

```ts
test('Your ticket emails a link to set a password', async ({ page }) => {
  const name = `Pw Ticket ${uid()}`, email = emailOf(name);
  await clearMails();
  await login(page, name, 'crew-test-password');
  await page.goto('/account');
  await page.getByTestId('account-password-link').click();
  await expect(page.getByTestId('account-note')).toHaveText(`${copy.linkSentTo} ${email}`);
  expect(await resetLinkFor(email)).toContain('/reset-password#');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npm run test:e2e -- password`
Expected: FAIL, because `account-password-link` does not exist.

- [ ] **Step 3: Implement**

Labels (`copy`): `accountPasswordHint: 'Set or change your password'`, `linkSentTo: 'Link sent to'`.

In `account/+page.svelte`:
- Import `requestPasswordReset` alongside `auth, logout, pb`.
- Add:
  ```ts
  async function sendLink() {
    if (busy || !$auth.user) return; busy = true; note = '';
    const email = $auth.user.email as string;
    try { await requestPasswordReset(email); note = `${copy.linkSentTo} ${email}`; }
    catch (e) { note = e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError; }
    finally { busy = false; }
  }
  ```
- Under the email paragraph:
  ```svelte
  <p>{copy.passwordField}: {copy.accountPasswordHint}
    <button type="button" class="secondary" onclick={sendLink} disabled={busy} data-testid="account-password-link">{copy.emailMeLink}</button></p>
  ```

Docs:
- `CLAUDE.md`: "Production signs in only by OTP or Google" becomes "Production signs in only by OTP, password or Google".
- `docs/OPERATIONS.md`, Crew access section:
  - "There is no shared password." becomes "There is no shared password; each person may set their own."
  - The boarding bullet: the newcomer also picks a password, and once let aboard signs in with email and that password, an emailed code, or Google.
  - Add a **Passwords** bullet:
    - Forgot password and Your ticket email a link that works once, for 30 minutes.
    - Setting a password signs out every other session.
    - There are 10 tries per address per 15 minutes; when the limit is spent, code and Google still work.
    - People who boarded before passwords existed, or with Google, set one through "Forgot password?".
    - The Conductor should use a long, unique password.
  - Under **Conductor without mail**, remove "Never switch on password auth for `users` to get in." Add a first step: "Sign in with your password, if you set one."
- `README.md` ~37 and ~427: name password sign-in alongside the emailed code and Google; keep "No shared password".

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd web && npm run test:e2e -- password`
Expected: PASS.

- [ ] **Step 5: Run the full gate, then commit**

```bash
git add "web/src/routes/(app)/account/+page.svelte" web/src/lib/labels.ts web/tests/e2e/password.spec.ts docs/OPERATIONS.md CLAUDE.md README.md
git commit -m "feat(web): Your ticket emails a password link; docs for password sign-in"
```
