# Metra credit footer

## Why

Metra's data license requires the app to show that its schedule comes from Metra, that the app is
not affiliated with Metra, and when the data was last updated (README, "Metra data is proxied
through our server"). The text exists as `copy.notAffiliated` in `web/src/lib/labels.ts`, but no
screen shows it. The app is about to open to the public, so the gap has to close first.

## What

One line of small, muted text at the very bottom of every page, signed in or not:

> Schedule from Metra’s public feed. Not affiliated with Metra. Timetable published Nov 14, 2026.

- **Where:** the root layout (`web/src/routes/+layout.svelte`), after `<main>`, inside the same
  `.col` column. Every page uses that layout, including `/login`, `/join`, `/login/forgot` and
  `/reset-password`. On days with the Live tab bar, `body:has(.tabbar)` already pads the page bottom,
  so the footer sits above the bar, not under it.
- **The date:** the static timetable's `publishedAt`, which `/api/metra/status` already returns as
  `staticPublishedAt` (for example `11/14/26 02:20:03 AM America/Chicago`, Metra's `published.txt`).
  It is shown as a Chicago calendar date, `Nov 14, 2026`.
  - Fetched once per signed-in session (when `$auth.user` becomes set), best-effort. The status
    endpoint requires a signed-in user; this change adds no unauthenticated endpoint.
  - Signed out, the date is unknown, or the fetch fails: the line ends after "Not affiliated with
    Metra." and never shows a placeholder or an error.
  - An unparseable `publishedAt` counts as unknown.
- **Text:** `copy.notAffiliated` becomes "Schedule from Metra’s public feed. Not affiliated with
  Metra." and a new `copy.timetablePublished` holds "Timetable published". "Saturday" is dropped: the
  code does not guarantee the route's date is a Saturday.
- **Name:** README glossary gets a row, "Metra credit", UI label: the footer text.

## Approaches considered

1. **Footer on every page** (chosen by the user). One place, always visible, nothing to remember
   when a new page shows train times.
2. Under the Departure Board and the route view only, the screens that show Metra times. Closer to
   the data, but two placements to keep in sync and none on pages added later.
3. An "About" page. Not next to the data at all.

## Non-goals

- No realtime "last updated" time in the footer; the Departure Board already says "Timetable only —
  no live times since …" when the live feed is stale.
- No change to the Metra proxy, the status endpoint or its polling.

## Tests

- Unit: the date formatter turns Metra's `published.txt` format into `Nov 14, 2026`, and returns
  nothing for an empty or unparseable value.
- e2e: the credit is visible on `/login` (signed out, no date) and on Home signed in (with the
  date from the test stack's GTFS fixture).
- Layout sweep already visits every page state at phone width, so the footer is checked against the
  generic layout rules (no overflow, no overlap with the tab bar) without a new sweep line.
