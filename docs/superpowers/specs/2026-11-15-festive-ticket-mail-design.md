# Boarding-code email as a ticket, and a dark-only app

Short design, approved 2026-11-15.

## Why

The join link's boarding-code email is the first thing a new crew member gets from Chug-a-Lug, and
today it is two plain lines ("Your Chug-a-Lug boarding code: 652354 / It works for 15 minutes.").
The Conductor wants it to feel festive and look like the gold ticket the web app renders on Home
(`web/src/lib/components/Ticket.svelte`). Separately, on the Conductor's Android phone (installed
app) the header logo's dark rounded square renders white while its inner dark shapes stay dark;
desktop is fine.

## Goals

- The code email (first send and Resend, `pocketbase/pb_hooks/join.js` `codeMail`) carries an HTML
  part that looks like the web ticket: gold card, dark notches at the tear line, dashed tear line.
- The subject carries the code, code first: `652354 is your Chug-a-Lug boarding code`.
- The header logo keeps its dark square on phones whose browser applies automatic dark mode.

## Non-goals / anti-goals

- No name, route, date or any other user- or Conductor-typed text in the email (option A, "code is
  the ticket"). Nothing to escape, nothing personal in an inbox preview beyond the code.
- The plain-text part keeps today's wording; tests and text-only clients read the code from it.
- The code must stay one unbroken six-digit run in both parts (copy-paste, `one-time-code` autofill,
  the tests' `/\b(\d{6})\b/`). Spacing is visual only (`letter-spacing`).
- No other emails change (password reset, the unused OTP template).

## Approaches considered

- **Ticket content:** A, code only (picked by the Conductor), vs B, code plus passenger name and the
  current route. B needed escaping and a route lookup at send time for a modest gain.
- **Ticket markup:** table layout with inline styles and `bgcolor` fallbacks (picked) vs CSS in a
  `<style>` block or an image. Gmail supports `<style>` blocks, but inline styles on tables are the
  most portable choice, and the ticket needs no media queries; an image hides the code from copy-paste
  and screen readers.
- **Logo fix:** declare the app dark-only with `color-scheme` (picked) vs swapping the SVG for a PNG
  or adding a CSS background behind it. **Hypothesis, not established cause:** the page never declares
  a colour scheme, and the symptom (outer `#111` rect white, inner `#111` shapes dark, desktop fine)
  fits a browser's automatic dark-mode heuristics recolouring the image. Chrome skips its auto dark
  theme for pages that declare dark support; user agents may still override, so the device check
  below is the acceptance test. `only light` (Chrome's documented opt-out) would be wrong for an
  all-dark app. Declaring `dark` is right for this app regardless, and also darkens native pickers.

## Design

### Email

- New module `pocketbase/pb_hooks/ticketMail.js` (not `.pb.js`, so it is only `require`d) exporting
  `codeMail(email, code)` → `{ to, subject, text, html }`. `join.js` requires it for both sends and
  drops its local `codeMail`. Wording lives in this module: hooks cannot read `web/src/lib/labels.ts`.
- HTML: a full document. Every colour is explicit (attribute `bgcolor` plus inline `style`), so a
  mail client that recolours dark mode still shows a coherent ticket; no `color-scheme` hint is
  relied on. Outer table on `#111111`; a centred 360px-max card table, `bgcolor="#ffb400"`, rounded
  14px, with:
  - kicker `BOARDING CODE · ADMIT ONE` (11px, letter-spaced, weight 800, `#1a1406` at reduced
    contrast via a solid colour, not opacity);
  - the code, 40px, weight 900, `letter-spacing: .18em`, one text node in an element marked
    `data-code` (the tests find the visible code by it);
  - a tear row: three cells. Each outer cell is 10px wide and holds a `#111111` half-circle (a
    10×20px block whose straight edge sits on the card boundary and whose curve bulges into the gold:
    the left notch rounds its right corners (`border-radius: 0 10px 10px 0`), the right notch its
    left corners (`10px 0 0 10px`). No negative margins, which email clients drop). Outlook desktop ignores `border-radius` and shows a small square notch,
    acceptable. The middle cell carries a `2px dashed #8a6a1c` line;
  - footer row `VALID 15 MIN` left and `CHUG-A-LUG CHOO-CHOO` right, 13px, weight 800.
  - A hidden preheader (`display:none` span) repeating "Your boarding code: 652354" so inbox previews
    show the code, not the kicker.
- Fonts: `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`. No external images or fonts.
- **Clients:** Gmail (Android app and web) and Apple Mail (iOS) must show the ticket. Acceptable
  degradation anywhere else (Outlook desktop, clients that recolour dark mode): the code and the
  15-minute validity stay readable, the card fits a 320px screen, notch shape may differ.

### Logo / dark mode

- `web/src/app.html`: `<meta name="color-scheme" content="dark" />`.
- `web/src/routes/+layout.svelte` global `:root`: `color-scheme: dark;`.
- A unit check asserts the declaration is present; that proves only the declaration.
- **Acceptance is on the affected phone** after deploy: note the browser and its version and any
  dark-mode settings, then check both the installed app and a plain browser tab: the outer square and
  the inner window both dark. If it still shows white, the hypothesis is wrong; debug from there.

## Tests (written first)

- Unit (`web/tests/unit/ticketMail.test.ts`, loading the hook module with `createRequire`), with a
  leading-zero code `012345`: subject is exactly `012345 is your Chug-a-Lug boarding code`; text is
  exactly today's wording; the `data-code` element's text is exactly `012345`; the preheader carries
  the same code; the HTML has the kicker, `VALID 15 MIN`, `#ffb400` and both notches.
- Hooks (`web/tests/hooks/join.test.ts`), first send and resend: subject, the `data-code` element and
  the text part all carry the same code, and the text part equals today's wording exactly. The test
  sink (`mailparser`) synthesises `text` from HTML when a mail has no plain part, so exact equality
  with the plain wording is what proves the plain part was sent.
- Manual: send one to Gmail on Android and look at it at phone width before calling it done.
- Web: a check that the served page declares `color-scheme` dark.

## Left to the builder

Exact spacing and colour of secondary text, preheader wording, and where the colour-scheme check
lives (unit test over `app.html` vs e2e).
