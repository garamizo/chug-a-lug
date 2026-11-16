# Metra credit footer

## Why

The README ("Metra data is proxied through our server") says Metra's license requires the app to
show that its schedule comes from Metra, that the app is not affiliated with Metra, and when the
data was last updated. The text exists as `copy.notAffiliated` in `web/src/lib/labels.ts`, but no
screen shows it. The app is about to open to the public, so the gap has to close first. The README is
this spec's source for the requirement; the license text itself was not re-read.

## What

One line of small, muted text at the very bottom of every page, signed in or not:

> Schedule from Metra’s public feed. Not affiliated with Metra. Timetable published Nov 14, 2026.

### Placement

`web/src/routes/+layout.svelte` renders `<footer class="col credit">` right after
`<main class="col">`. Every page uses that layout, including `/login`, `/join`, `/login/forgot` and
`/reset-password`. On days with the Live tab bar, `TabBar.svelte`'s `body:has(.tabbar)` rule pads the
page bottom by the bar's height, so the footer scrolls clear of the bar; a test proves it (below).

### The date

- **Source:** `/api/metra/status` already returns `staticPublishedAt` and `staticSource`, plus
  `source` (`live`, or a simulation source). The browser reads it through `fetchStatus()` in
  `web/src/lib/live/feed.ts`, whose return type gains those three fields. `fetchStatus` sends the
  Authorization header that `requireUser` needs and drops obsolete simulation answers.
- **Only a real Metra publish date is shown.** A pure function `creditDate(status)` returns
  `Nov 14, 2026` when `source === 'live'`, `staticSource` is `download` or `cache`, and
  `staticPublishedAt` matches Metra's `published.txt` format, `MM/DD/YY hh:mm:ss AM|PM <zone>`
  (today `11/14/26 02:20:03 AM America/Chicago`). The date is taken as written: the file is already
  in Chicago time, so there is no time-zone conversion. Everything else returns no date:
  - `file:` timetables, whose `publishedAt` is the zip's mtime (`static.ts`, tests and offline dev);
  - simulation, whose `publishedAt` is the service date (`provider.ts`);
  - an empty or unrecognised value; a failed or refused fetch.
- **Without a date** the line ends after "Not affiliated with Metra." No placeholder, no error.
- **Session ownership** (CLAUDE.md, "Browser clock ownership"): the root layout owns the fetch in
  one `$effect` keyed on the user id (`$auth.user?.id`), like `(app)/+layout.svelte` does, so
  token renewals and renames do not refetch. Signed in, it fetches at once and every 10 minutes (the
  static loader's own refresh interval, so a new timetable's date shows within about 20 minutes).
  On logout or a user change the effect clears the date, stops the timer and ignores any answer
  still in flight.

### Text

`copy.notAffiliated` becomes "Schedule from Metra’s public feed. Not affiliated with Metra." and a
new `copy.timetablePublished` holds "Timetable published". "Saturday" is dropped: nothing guarantees
the route's date is a Saturday. README's UI glossary gets a "Metra credit" row.

## Approaches considered

1. **Footer on every page** (chosen by the user). One place, always visible, nothing to remember
   when a new page shows train times.
2. Under the Departure Board and the route view only. Closer to the data, but two placements to keep
   in sync and none on pages added later.
3. An "About" page. Not next to the data at all.

## Non-goals

- No realtime "last updated" time in the footer. The full Departure Board already says "Timetable
  only — no live times since …" when it shows a stale trip; its compact strip and no-train state do
  not, and this change leaves them as they are.
- No new unauthenticated endpoint; signed-out pages show the credit without a date.
- No change to the Metra proxy or the status endpoint.

## Tests

- Unit (`creditDate`): Metra's format gives `Nov 14, 2026` (AM and PM, a date in another year);
  each of these gives no date: an ISO mtime with `staticSource: 'file'`, a simulation `source`, an
  empty string, garbage.
- e2e:
  - `/login`, signed out: the credit is visible and ends after "Not affiliated with Metra."
  - Live on a practice day at phone width, where the tab bar shows: after scrolling to the bottom,
    the footer is fully visible and its bottom edge is above the tab bar's top edge.
  - With `/api/metra/status` stubbed as the live stack would answer (the test stack's `file:`
    timetable never gives a date): Home shows the date, logout clears it, and an answer delayed past
    logout never shows it. The tab-bar check uses the dated, longer text.
- Unit (`watchCreditDate`): fetches at once and every 10 minutes, never overlaps calls, reports no
  date on failure, and ignores an answer that lands after dispose.
- The layout sweep keeps running over every page state; its generic rules do not hit-test plain
  text, which is why the tab-bar case has its own assertion.
