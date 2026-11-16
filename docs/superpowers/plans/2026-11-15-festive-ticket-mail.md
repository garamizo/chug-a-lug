# Ticket-Style Boarding-Code Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The join link's boarding-code email looks like the app's gold ticket and carries the code in
its subject; the app declares itself dark so phone browsers stop recolouring the header logo.

**Architecture:** A pure CommonJS hook module builds the mail object (`subject`, `text`, `html`);
`join.js` uses it for both sends. The web app gains a `color-scheme: dark` declaration.

**Tech Stack:** PocketBase JSVM hooks (CommonJS, `require(\`${__hooks}/…\`)`), vitest, SvelteKit.

**Spec:** `docs/superpowers/specs/2026-11-15-festive-ticket-mail-design.md`

## Global Constraints

- Subject, exactly: `<code> is your Chug-a-Lug boarding code`.
- Text part, exactly today's wording: `` `Your Chug-a-Lug boarding code: ${code}\n\nIt works for 15 minutes.` ``
- The code is one unbroken six-digit text node, in the element carrying `data-code`; spacing by
  `letter-spacing` only.
- No user- or Conductor-typed text in the email; no external images or fonts.
- Colours: page `#111111`, card `#ffb400`, ink `#1a1406`, tear line `2px dashed #8a6a1c`.
- Copy: kicker `BOARDING CODE · ADMIT ONE`, footer `VALID 15 MIN` and `CHUG-A-LUG CHOO-CHOO`.
- Stage explicit paths only; never `git add -A`. Hooks and e2e harnesses use fixed ports: one run at a time.

## Review Focus

- A code with a leading zero (`012345`) must survive as six characters everywhere (subject, `data-code`,
  preheader, text) → Task 1 tests with `012345`.
- A dropped plain-text part is masked by the sink synthesising `text` from HTML → Task 1 and Task 2
  assert the exact wording.
- Resend must produce the same shape with the *new* code, not the first one → Task 2 asserts on the
  resend mail.
- A ticket wider than a 320px phone → Task 1 asserts `max-width:360px` with `width:100%` on the card.
- Mail failure handling must not change (first-send failure deletes the sign-up; resend failure keeps
  the cooldown) → covered by the existing `join.test.ts` cases; Task 2 must leave them green.

---

### Task 1: Ticket mail module

**Files:**
- Create: `pocketbase/pb_hooks/ticketMail.js`
- Test: `web/tests/unit/ticketMail.test.ts`

**Interfaces:**
- Produces: `codeMail(email: string, code: string) → { to: string[], subject: string, text: string, html: string }`
  exported as `exports.codeMail`. No PocketBase globals, so vitest can load it with
  `createRequire(import.meta.url)('../../../pocketbase/pb_hooks/ticketMail.js')` (as `tests/unit/password.test.ts` does with `crew.js`).

- [ ] **Step 1: Write the failing test** `web/tests/unit/ticketMail.test.ts`, with `const m = codeMail('a@b.invalid', '012345')`:
  - `m.to` equals `['a@b.invalid']`
  - `m.subject` equals `'012345 is your Chug-a-Lug boarding code'`
  - `m.text` equals `'Your Chug-a-Lug boarding code: 012345\n\nIt works for 15 minutes.'`
  - `/data-code[^>]*>([^<]*)</.exec(m.html)?.[1]` equals `'012345'`
  - the preheader (an element with `display:none`) contains `012345`
  - `m.html` contains `BOARDING CODE · ADMIT ONE`, `VALID 15 MIN`, `CHUG-A-LUG CHOO-CHOO`, `#ffb400`,
    `border-radius:0 10px 10px 0` and `border-radius:10px 0 0 10px` (both notches), `max-width:360px`
  - `m.html` has no `<img` and no `http` (no external resources)

- [ ] **Step 2: Run** `cd web && npx vitest run tests/unit/ticketMail.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement** `pocketbase/pb_hooks/ticketMail.js` per the spec's Email section: a full HTML
  document, tables with inline styles plus `bgcolor`, outer `#111111` table, centred card
  (`width:100%;max-width:360px`, radius 14px), kicker row, code row (`data-code`, 40px, weight 900,
  `letter-spacing:.18em`), tear row (10px notch cells with the two radii above, dashed middle cell),
  footer row. Hidden preheader `Your boarding code: <code>` first in `<body>`. Font stack
  `system-ui,-apple-system,Segoe UI,Roboto,sans-serif`. Header comment points at the spec.

- [ ] **Step 4: Run** the same test — expect PASS. Also `npm test` (all unit tests) green.

- [ ] **Step 5: Commit** `git add pocketbase/pb_hooks/ticketMail.js web/tests/unit/ticketMail.test.ts`,
  message `feat(hooks): boarding-code email as a gold ticket`.

### Task 2: Join sends the ticket

**Files:**
- Modify: `pocketbase/pb_hooks/join.js:17` (drop local `codeMail`), `:126` and `:228` (call sites)
- Test: `web/tests/hooks/join.test.ts`

**Interfaces:**
- Consumes: `require(\`${__hooks}/ticketMail.js\`).codeMail` from Task 1. Require it inside the handler
  functions, the way `join.js` already requires `crew.js` (JSVM handlers do not see module-scope
  bindings from other files reliably; follow the file's existing pattern).

- [ ] **Step 1: Write the failing test** in `join.test.ts`, `it('the code mail is a ticket with the code in the subject, on send and resend')`:
  sign up; take the last mail to the address (`mails(email)`); its `subject` is
  `` `${code} is your Chug-a-Lug boarding code` `` where `code` comes from `/data-code[^>]*>(\d{6})</` on its `html`;
  its `text` equals the exact plain wording with that code. Then backdate `code_sent_at` past the
  resend cooldown (as the existing `resend cooldown and count` test does), `resend`, and assert the
  same three things on the newest mail with its own code, which differs from the first; and
  `verify` with the resent code returns 200.

- [ ] **Step 2: Run** `bash scripts/test-hooks.sh` — expect the new test to FAIL (subject mismatch) and all others to pass.

- [ ] **Step 3: Implement**: replace the two `codeMail(email, code)` calls with the module's, keeping
  them inside the existing `try` blocks so mail-failure handling is unchanged; delete the local helper.

- [ ] **Step 4: Run** `bash scripts/test-hooks.sh` — expect all green.

- [ ] **Step 5: Commit** `git add pocketbase/pb_hooks/join.js web/tests/hooks/join.test.ts`,
  message `feat(hooks): join and resend send the ticket mail`.

### Task 3: The app declares itself dark

**Files:**
- Modify: `web/src/app.html` (add `<meta name="color-scheme" content="dark" />` after `theme-color`)
- Modify: `web/src/routes/+layout.svelte` (`:global(:root)` gains `color-scheme: dark;`)
- Test: `web/tests/unit/colorScheme.test.ts`

- [ ] **Step 1: Write the failing test**: read `web/src/app.html` with `fs` and assert it matches
  `/<meta name="color-scheme" content="dark"/`; read `web/src/routes/+layout.svelte` and assert it
  contains `color-scheme: dark`.

- [ ] **Step 2: Run** `npx vitest run tests/unit/colorScheme.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** the two one-line edits.

- [ ] **Step 4: Run the full gate**: `cd web && npm test && npm run check && npm run test:e2e`, then
  `bash scripts/test-hooks.sh`. All green. (Known one-off e2e flakes: rerun once before investigating.)

- [ ] **Step 5: Commit** `git add web/src/app.html web/src/routes/+layout.svelte web/tests/unit/colorScheme.test.ts`,
  message `fix(web): declare the dark color scheme so phone browsers stop recolouring the logo`.

### Task 4: Look at it

- [ ] Write the Task 1 HTML for code `012345` to the session scratchpad and render it at 360px and 320px
  wide with Playwright (from `web/`); check the notches, tear line and code are visible and nothing
  overflows. Hand the Conductor the remaining manual checks: one real mail in Gmail on Android after
  deploy, and the logo on the phone (installed app and a browser tab), per the spec's acceptance.
