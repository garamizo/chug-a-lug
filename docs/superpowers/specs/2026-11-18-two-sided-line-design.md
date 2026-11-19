# Two-sided line — design

Date: 2026-11-18 · Branch: `feat/two-sided-line` · Status: approved (short design)

## Why

The route planner draws the BNSF line unfolded (since `703ca91`, 2026-09-25): every station top to
bottom toward Chicago, a **Turn around** divider, then every station again bottom to top on the way
back. The page is twice as long as the line, and you have to read both halves to see which stations
the crawl actually uses.

Bring back the earlier layout: one line, each station once, going stops **left** of the line and
return stops **right** of it. A glance shows which stations are visited and in which direction, the
scroll is half as long, and it looks better.

## Goals

- One line, Aurora at the top, Union Station at the bottom, one row per station.
- Going stops (`direction: 'out'`, side `left`) in their station's row left of the line; return stops
  (`'back'`, side `right`) in the same row right of it.
- **Phone:** the two sides are panes in a horizontally snapping viewport. The side in focus fills
  about 80% of the width and the other side peeks in. Drag, tap a direction tab
  (**Aurora → Chicago** / **Chicago → Aurora**), or focus/tap a card on the other side to switch.
- **Wide screen** (the 760 px app column has room for both): both sides in full, no dragging.
- Applies everywhere `ItineraryView` renders: `/plan/[id]`, `/plan/[id]/edit` (draft and the
  locked-route staged editor) and `/route`.

## Non-goals

- No change to stop data, `direction`, crawl ordering, `placeStops`, `insertionIndex`, planning,
  legs or permissions.
- No change to the add screen (`/plan/[id]/add`); it keeps its own direction toggle.
- No new visual language: same cards (`StopRow`), legs, colours and header.

## Anti-goals

- The page must not scroll sideways as a whole (layout sweep `page-overflow`); only the line's own
  viewport scrolls, and only on a phone.
- Vertical scrolling must keep working while the finger is over the line (no scroll trap).

## Approaches

1. **Restore the two-pane `LineMap` from `703ca91^`, adapted to today's cards** (picked). The
   placement data (`placement.rows[i].left/right`) still exists; it is a view-layer change.
2. Keep the unfolded line and compress empty stations. Shorter, but still two passes over the line,
   and it does not show both directions of a station side by side. Rejected: misses the point.
3. Two separate scrolling columns without a shared station row. Loses the "same station, both
   directions" alignment. Rejected.

## Design

- `LineMap.svelte`: back to three columns per row (`left` cell, track, `right` cell) with `left` and
  `right` snippets, a `panes` mode, `focusSide(side)`, and an `onside` callback, as in `703ca91^`.
  The `section` prop and the `-back-` test ids go away: `map-row-<id>` and `station-dot-<id>`, one per
  station. In `panes` mode on a wide viewport (media/container query), the panes fit side by side
  without overflow and no snapping applies.
- `ItineraryView.svelte`: one `LineMap` with `panes`; direction tabs above it (`side-left`,
  `side-right`) that reflect and set the focused side; each cell renders its stop cards
  (`placement.rows[i].left` / `.right`). The station name shows on the focused side on a phone, and
  next to the line on both sides when both are visible (builder's call on the exact placement).
- Tapping a station circle adds a stop on the focused side: `actions.add(id, focused)`. On a wide
  screen the tabs still mark which side a tap adds to; tapping a card or a tab changes it. The add
  screen's own direction toggle remains the final say.
- The **Board at** opening leg stays above stop 1's card, the run home under the last card, and the
  staged editor's "crew is here" button under each card, exactly as today (they ride with `card()`).
- Off-line stops keep their own list under the line.
- Remove `unfold`, `Section`, `SectionRow`, `sideOfSection` from `lineMap.ts` and their unit tests;
  remove `copy.turnAround` and its labels test entry; update the README glossary row and
  `docs/FEATURES.md` to describe the two-sided line.
- Scroll restore after adding a stop keeps working; also restore the focused side (a phone user who
  added a return stop comes back to the right pane).

## Tests

- Unit: `lineMap.test.ts` drops the `unfold` block; `placeStops` tests already cover the sides.
- e2e `planning.spec.ts`: replace `section-*` / `*-back-*` with the single-row ids, switch sides via
  `side-right`, assert return stops in `map-row-<id>` with `data-side="right"`; the cheers-above-line
  check uses the line map's box.
- `rehearsal.spec.ts`: the station dot id loses the outbound/return comment.
- Layout sweep: the existing route view entries cover the line at phone width; add one for the
  right pane in focus.

## Left to the builder

- The exact breakpoint for "both sides visible" and where station names sit in that mode.
- Whether the tabs hide on a wide screen or stay as the "adding to" marker (default: stay).
