# Sheet close: one X across the top edge

**Status:** approved in conversation 2026-11-19 (small change, short design).

## Intent

Bottom sheets close in different ways. The stop-details and venue-details sheets have a "Close" text
button in the footer, while the Tab has a round X inside its top-right corner. Make this one control
everywhere: a round X at the top right, raised so it straddles the sheet's top border.

## Goals

- One `SheetClose` component: a 40px round X (`IconButton`'s `close` icon) with a solid fill in the
  sheet's colour and the sheet's border. Its centre sits on the sheet's top border, 16px in from the
  right edge.
- `TabSheet`, `StopSheet` and `VenueSheet` all use it.
- The footer "Close" buttons in `StopSheet` and `VenueSheet` are removed. Their test IDs
  (`sheet-close`, `venue-sheet-close`) and the Tab's `tab-close` move to the X, so existing e2e
  tests keep their selectors. The accessible names stay as they are (`copy.closeSheet`, `copy.closeTab`).

## Non-goals

- Lightbox and ClosingReel: these are full-screen, with no top edge to cross. Their ✕ stays as it is.
- RoleWindow's Cancel: backing out of a choice reads better as "Cancel" than as a close control.
- The inline ✕ dismissals in TabHost (error and retry notes) are not modals.

## Constraints

- `StopSheet` and `VenueSheet` are native `<dialog>` elements, and the dialog itself scrolls
  (`overflow-y: auto`). A scroll box clips children that overflow its edge. The dialog therefore
  becomes `overflow: visible` (the UA stylesheet sets `overflow: auto` on a modal dialog, so this
  has to be explicit), and an inner `.body` takes over `max-height`, `overflow-y: auto` and
  `overscroll-behavior: contain`. The `html:has(dialog.sheet[open])` scroll lock stays.
- The inner body needs `border-radius` to match the sheet's top corners, so scrolled content does
  not poke past the rounded corners.
- StopSheet's swipe handlers (`ontouchstart`/`ontouchend`) stay on the dialog.
- The sheet's max height (88dvh) leaves at least 12dvh above it, so the raised X is never cut
  off by the viewport.
- The X must not cover StopSheet's `›` next-stop button. With an 8px top padding plus the grab
  handle, the header starts about 27px down, and the X reaches only 20px below the edge.

## Approaches

1. **Shared `SheetClose` component raised across the edge (chosen).** One place for size, offset
   and fill. It needs the scroll to move into an inner body on the two dialog sheets.
2. Keep the X inside the corner, as the Tab does now. No layout change, but this is not what was
   asked for.
3. A global CSS class on `IconButton`. Less code, but the offset and fill would be spread across
   three stylesheets.

## Trade-off accepted

Close moves from the bottom right (in reach of a right thumb) to the top right. Back, Escape and a
tap on the scrim still close the sheets. On the Tab, the scrim tap and Escape are unchanged.

## Tests

- `liveUx.spec.ts`: the right-edge assertion still holds for the X. The `overscroll-behavior`
  assertion moves to the sheet's inner body (`stop-sheet-body`). A new assertion checks that the X
  straddles the top edge: its top is above the sheet's top, and its bottom is below it.
- `layoutSweep.spec.ts`: no new page state. Check that the layout rules do not flag the X for
  overflowing its container; if they do, exempt it.
