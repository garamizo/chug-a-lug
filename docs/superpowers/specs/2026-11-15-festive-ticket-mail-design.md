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
  `<style>` block or an image. Gmail drops pseudo-elements and many `<style>` rules; an image hides
  the code from copy-paste and screen readers.
- **Logo fix:** declare the app dark-only with `color-scheme` (picked) vs swapping the SVG for a PNG
  or adding a CSS background behind it. The page never says it is dark, so Android browsers' auto
  dark mode recolours it; declaring `dark` opts out at the cause and also darkens native pickers.

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
  - the code, 40px, weight 900, `letter-spacing: .18em`, one text node;
  - a tear row: three cells. Each outer cell is 10px wide and holds a `#111111` half-circle (a
    10×20px block with `border-radius` on its two outer-facing corners: no negative margins, which
    email clients drop). Outlook desktop ignores `border-radius` and shows a small square notch,
    acceptable. The middle cell carries a `2px dashed #8a6a1c` line;
  - footer row `VALID 15 MIN` left and `CHUG-A-LUG CHOO-CHOO` right, 13px, weight 800.
  - A hidden preheader (`display:none` span) repeating "Your boarding code: 652354" so inbox previews
    show the code, not the kicker.
- Fonts: `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`. No external images or fonts.

### Logo / dark mode

- `web/src/app.html`: `<meta name="color-scheme" content="dark" />`.
- `web/src/routes/+layout.svelte` global `:root`: `color-scheme: dark;`.
- Verification on the device is the Conductor's after deploy; tests cannot see a phone's auto dark
  mode. A layout-sweep or unit check asserts the meta is present.

## Tests (written first)

- Hooks (`web/tests/hooks/join.test.ts`): after a sign-up, the mail's subject is
  `<code> is your Chug-a-Lug boarding code`; the text part still contains the code; the HTML part
  contains the code as one run, `BOARDING CODE`, `VALID 15 MIN`, and `#ffb400`. Resend sends the same
  shape with the new code.
- Web: a check that the served page declares `color-scheme` dark.

## Left to the builder

Exact spacing and colour of secondary text, preheader wording, and where the colour-scheme check
lives (unit test over `app.html` vs e2e).
