# Sheet close: one X across the top edge

**Status:** approved in conversation 2026-11-19 (small change, short design).

## Intent

Bottom sheets close in different ways. The stop-details and venue-details sheets have a "Close" text
button in the footer, while the Tab has a round X inside its top-right corner. Make this one control
everywhere: a round X at the top right, raised so it straddles the sheet's top border.

## Goals

- One `SheetClose` component: a 40px round X (`IconButton`'s `close` icon) with a solid fill in the
  sheet's colour and the sheet's border. Its centre sits on the sheet's top border, and its right
  edge is 12px in from the sheet's right edge. The sheets are full width on a phone, so the whole
  button stays on screen.
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
  has to be explicit), `padding: 0` and `max-height: none` (which overrides the UA cap). It keeps the
  UA's `position: fixed`, which already anchors the absolute X; `position: relative` must not be
  set, because on a top-layer dialog it computes to `absolute` and pins the sheet to the top of the
  document, so a sheet opened from a scrolled page lands mid-screen (found in final review). The inner `.body` owns the padding, `max-height: 88dvh`, `overflow-y: auto` and
  `overscroll-behavior: contain`. `box-sizing: border-box` is global, so the body's padding counts
  inside its 88dvh, and the sheet's total height is 88dvh plus its 1px top border. The
  `html:has(dialog.sheet[open])` scroll lock stays.
- The inner body needs `border-radius` to match the sheet's top corners, so scrolled content does
  not poke past the rounded corners.
- StopSheet's swipe handlers (`ontouchstart`/`ontouchend`) stay on the dialog.
- For StopSheet and VenueSheet, the 88dvh cap leaves at least 12dvh above the sheet, so the raised
  X is never cut off by the viewport. TabSheet has no height cap and does not scroll (out of scope).
  Its X is cut off only if the Tab's content fills the screen, which it does not today.
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

Close moves from the bottom right (in reach of a right thumb) to the top right. Back (the
`?stop=`/`?venue=` history entry) and Escape still close the stop and venue sheets, and (added at
the user's request after review) so does a tap on the dimmed screen behind them, as RoleWindow does:
a click whose target is the padding-less dialog itself fell on the backdrop. The Tab keeps its
scrim tap and Escape.

## Tests

- `liveUx.spec.ts`: the right-edge assertion becomes a range: the gap is between 0 and 40px, so a
  negative gap fails. The `overscroll-behavior` assertion moves to the inner body
  (`stop-sheet-body`). A new assertion checks that the X straddles the top edge. Because a bounding
  box does not prove the part above the edge is visible, the test also hit-tests a point 8px above
  the sheet's top inside the X (`document.elementFromPoint` resolves into the X). It repeats that
  hit test after scrolling the body to its end.
- `planning.spec.ts`: the same straddle and hit test for the venue sheet. The failed-add case keeps
  its error inside the modal.
- `TabSheet`: the same hit test above its top edge (in `liveUx`, or wherever the Tab is opened).
- `layoutSweep.spec.ts`: add a "station picker, venue sheet" state, so the third consumer is
  checked. The rules have no container-overflow check, so no exemption is planned. Any failure gets
  investigated.
