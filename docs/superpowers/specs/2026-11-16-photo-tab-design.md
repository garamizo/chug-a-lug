# Photo Tab — a drink counts once its photo lands

Status: design, 2026-11-16. Branch `feat/photo-tab`. Second of the four M5 branches (ride-home → **photo-tab** →
golden-spikes → closing-time).

## Intent

The user's words: "to claim a drink/food, you have to take a picture of it" — "it avoids people messing around with
the tap and to encourage people to take a picture of their food and drinks. It's more fun." And: "the photo becomes
Freight tagged with that drink, and Undo removes both."

So the Tab stops being a counter you can tap freely. Each tap on 🍺 / 🍸 / 🥃 / 🧃 / 🍽️ opens the camera; the drink
exists, and counts, only once the server has the photo. The photo is ordinary Freight (strip, chat, Lightbox,
Cheers), labelled with what it proves.

**Goals**
- Server-enforced: no API path lets a crew member create a Tab entry without a photo, and the drink and its photo are
  written in one transaction — never a drink without its photo, never a "proof" without its drink.
- One upload per tap; the count moves only when that upload succeeds.
- The proof photo is Freight: it shows in the Freight strip, in Crew Chat (captioned with the drink), in the Lightbox,
  and can be Cheered.
- Undo removes the drink and its photo together. The Conductor deleting a proof photo removes its drink too.

**Non-goals**
- Judging the photo (is it really a beer?). Any image counts.
- Offline queueing. Today "offline writes are not queued" (docs/OPERATIONS.md); that stays. A failed send keeps the
  photo in memory for a Retry while the page is open, nothing more.
- Video as proof. Freight still accepts video through the chat box; a Tab proof must be an image.
- Changing scoring, milestones or the Crew Board formula (golden-spikes does that next).

**Anti-goals**
- A tap that bumps the count before the server has the photo (the optimistic `pending` count today) — that is
  exactly the "messing around" the user wants gone.
- A drink row whose photo failed, or an orphan "proof" photo after Undo.

## How it works today (verified)

- `drink_entries` (`pb_migrations/1758700000_live.js:49-66`): `user`, `stop` (required), `kind`
  (`beer,wine,cocktail,shot,water,food`), `at`, `created`, `action_order` (`1758820000_action_order.js`). createRule
  `U && @request.body.user = @request.auth.id`; deleteRule owner-only; no update. `live.pb.js:62-67` stamps `at =
  eventNow`; `action_order.pb.js` numbers creates in a transaction.
- `media` (`1758700000_live.js:68-88` + later `at`, `itinerary`): `file` (90 MB, thumbs `400x300`, `1200x0`),
  `kind image|video`, `taken_at`, `stop` (optional), `tagged_by`. createRule owner-only; update/delete Conductor-only.
  `live.pb.js:4-30` forces `user`, sets `itinerary` to the current route, keeps `stop` only if it is on the current
  route (else clears it, `tagged_by='none'`), stamps `at`.
- Client Tab: `live/+page.svelte:61-90` `logDrink(kind)` — optimistic `pending` draft with `newRecordId()`, then
  `drink_entries.create`. Undo: toast (`tab-undo`, 4 s) and "Undo my last one here" (`tab-undo-last`),
  `+page.svelte:96-116`, deleting the row; 404 counts as done.
- Client Freight: `live/upload.ts` `prepare()` (type/size checks, image compression), `uploadBatch`; `+page.svelte:
  120-141` posts FormData to `media`. Photos carry no client id today.
- Chat shows media as photo entries (`live/chat.ts:20-22`, `CrewChat.svelte:104-110`), captioned by author in the
  Lightbox (`CrewChat.svelte:32`).

## Approaches considered

1. **Upload the photo with the drink kind; the media hook writes the drink (chosen).** `media` gains `drink_kind`.
   A media create carrying `drink_kind` makes the hook create the `drink_entries` row in the same transaction, with
   the same id. `drink_entries` becomes server-written only. One request per tap, atomic, idempotent by id.
2. Two requests — upload media, then create the drink pointing at it, with a createRule that checks the media.
   Not atomic: a lost second request leaves a "proof" with no drink and a confusing retry. Rejected.
3. A file field on `drink_entries`. Duplicates Freight (thumbs, chat, Cheers, Lightbox, the strip all read `media`).
   Rejected.

## Design

### Data

Migration `pocketbase/pb_migrations/1759300000_photo_tab.js`:
- `media.drink_kind`: select, optional, values `beer, cocktail, shot, water, food` (the five the Tab offers).
- `drink_entries.media`: relation to `media`, optional (legacy rows have none), `maxSelect 1`, **cascadeDelete true**
  (the Conductor deleting a proof photo removes its drink), unique index on `media` where non-empty.
- `drink_entries.createRule = null`: only hooks and superusers create Tab rows. deleteRule unchanged (owner).
- Down migration restores the old createRule and drops both fields.

Legacy drinks without a photo keep counting — the rule applies to new taps.

### Server (`pocketbase/pb_hooks/live.pb.js`, the existing media create hook)

PocketBase is pinned at 0.40.4 (`pocketbase/Dockerfile`, `scripts/pb-download.sh`).

When a media create request carries a non-empty `drink_kind`:
- Reject (400, code `proof_needs_image`) unless `kind = image` **and** the uploaded file itself is an image: the
  hook checks the file's sniffed content type (its leading bytes), not the client's `kind` or the file name. A
  missing file is rejected by the required field as today.
- Reject (400, `proof_needs_stop`) unless the client's `stop` is on the current route — a proof must belong to a stop,
  unlike plain Freight, which is re-tagged rather than rejected.
- Inside one transaction (`runInTransaction` wrapping the save chain, the transactional app used throughout, failures
  propagated — an after-success hook is too late): save the media (with the existing user/itinerary/at stamping), then
  save `drink_entries` with `id = media.id`, `user`, `stop`, `kind = drink_kind`, `at` copied explicitly from the
  media's `at` (the request-only drink stamping hook does not run for a hook save), `media = media.id`.
  `action_order.pb.js` uses the model `onRecordCreate`, so it numbers the hook-saved drink. Any failure rolls back
  the media, the drink and the `action_order` sequence allocation.
- The media's `tagged_by` stays as today (`clock`/`manual`).

**Proof pairing is immutable.** A media update hook rejects (400, `proof_locked`) any update that sets `drink_kind`
on media that has none, or that changes `drink_kind`, `kind`, `file`, `user`, `stop` or `itinerary` on a proof.
`drink_entries` keeps `updateRule: null`.

**Deletes go through the drink.** A model `onRecordDelete` hook on `drink_entries` (so it runs for owner Undo, the
Conductor's media delete cascade, and stop/user cascades alike): after the drink's delete, if its `media` still
exists, delete it in the same transaction; "already absent" (the media-first cascade path) is not an error. Server
side, so the media deleteRule (Conductor-only) is not loosened. The Conductor deleting proof media cascades to the
drink through the relation; the drink hook then finds the media gone. A failed media delete rolls the drink delete
back.

Media without `drink_kind` behaves exactly as today.

### Client

- **Tap → camera.** Each Tab button (`TabRow.svelte`, `drink-{kind}`) opens a hidden `<input type="file"
  accept="image/*" capture="environment">` from the tap's own click handler (a user gesture, so the picker opens on
  phones). Cancelling the picker does nothing. On desktop it is a file picker.
- **Send.** The chosen image goes through `upload.ts` `prepare()` (compression, size, type), then one `media` create
  with FormData `id` (client `newRecordId()`), `user`, `stop`, `kind=image`, `taken_at`, `drink_kind`, `file`. After
  `clientClock.ready()` as every write does today.
- **Confirming.** The media create returns only the media. The client then reads `drink_entries/{id}` (expand
  `user,stop`) and upserts both rows. If that read fails, the photo and drink did land (they are one transaction):
  the tap counts as sent, no Retry is offered, and the feed reload (`loadFeed`, realtime, the 30 s poll) brings the
  drink in.
- **Counting.** While a proof is in flight the button shows a sending state (`tab-sending-{kind}`), and the count does
  **not** include it; the row and photo appear once confirmed or via realtime. `withPending` no longer adds unsaved
  taps to counts; the day total on Live (`+page.svelte:52-53`) drops its pending add-on.
- **Scope of a send.** At tap time the send captures the user id, route (itinerary) id, stop id, the server day and
  the simulation run id. Logout, a route change, a server-day change or a run change invalidates it: its retained
  file is dropped, no Retry is offered, and a late answer is not upserted into the now-displayed feed (the feed's own
  reload reconciles). Closing the Tab sheet does not cancel a send; its result shows in the feed.
- **Failure.** The tap is taken back as today (`copy.noSignal` or the upload error), and a toast offers **Retry**
  (`tab-retry`) holding the prepared file and the same id while the send's scope is still current. A retry that
  gets 400 for a duplicate id treats the save as done if `drink_entries/{id}` now exists (the first send landed, the
  answer was lost).
- **Undo.** Unchanged UI (toast `tab-undo`, `tab-undo-last`); deleting the drink now also removes its photo
  server-side. The client drops both the drink and the media with that id from the feed.
- **Freight and chat.** A proof photo is ordinary Freight, captioned with the drink (icon + label, e.g. "🍺 Beer")
  wherever a Lightbox caption is built: `CrewChat.svelte`, `FreightStrip.svelte` and `StopSheet.svelte`. In Crew Chat
  a proof shows **once**, as the photo entry (Cheers target `media`), captioned with the drink; `chatEntries` stops
  emitting the `drink:{id}` announcement for drinks that have `media`. Legacy drinks without a photo keep their
  announcement.
- **Hint.** The Tab sheet says once, under the buttons, that a drink counts when its photo lands (new label).

### Labels (web/src/lib/labels.ts)

- `tabProofHint: 'Snap it to count it.'`
- `tabSending: 'Sending…'`
- `tabRetry: 'Retry'`
- `proofNeedsImage: 'Take a photo — a video does not count.'`
- `proofNeedsStop: 'Drinks count at a stop on today’s route.'`
- `proofLocked` is a server code only (no client path updates a proof).
- A caption helper reuses the existing drink labels and icons (`labels.ts:277-281`, `:479`).

README glossary: the **Tab** row gains "a drink counts once its photo lands; the photo is Freight". Add an **Undo**
note only if a row exists — none does today. FEATURES.md Tab/Freight bullets updated.

### Tests and fixtures

- Hooks (`web/tests/hooks/live.test.ts`): a proof upload creates both rows with the same id, stamped `at`, and
  `action_order`; a video declared as `kind=image`, non-image bytes, and `kind=video` → 400 `proof_needs_image`;
  proof with a stop off the current route → 400; a failed drink save (injected) rolls back the media, the drink and
  the `action_order` counter; a duplicate id is refused without a second drink; crew `drink_entries.create` → 403
  (createRule null rejects before hooks); owner Undo removes the media; Conductor media delete removes the drink;
  stop and user cascades remove both; proof updates → 400 `proof_locked`; plain Freight unchanged.
  `migrations.test.ts` for the new migration.
- Existing tests to convert (crew-authenticated drink creates): `live.test.ts:73`, `:91` (successful creates) and
  `:83` (forged owner) move to proof uploads; the anonymous create at `:114` now expects 403. `actionOrder.test.ts`
  (superuser token) and migration fixtures (`app.save`) are unaffected. The sim seed (`web/src/lib/server/sim/seed.ts`)
  and `web/tests/sim/setup.ts` create no drinks.
- UI flows that tap drinks and need a photo supplied through the file chooser: `tab.spec.ts`, `chat.spec.ts`,
  `crew.spec.ts`, `liveUx.spec.ts`, `practice.spec.ts`, `offline.spec.ts`, and sim `rehearsal.spec.ts`. A shared
  e2e helper taps a kind and supplies a fixture JPEG.
- Unit: counts exclude in-flight taps; caption helper; `chatEntries` shows a proof once and keeps legacy drink
  announcements; retry-after-duplicate; a late answer after a scope change is not upserted.
- e2e: tap → choose image → count moves after the upload; cancel → no change; failed send → count unchanged, Retry
  lands it; Undo removes the drink and its strip/chat photo.
- One `layoutSweep` line for the Tab sheet with a proof sending.

## Edge cases

- Two quick taps of different kinds: each opens its own picker in turn; each send is independent.
- Retry after the page reloads: the photo is gone; the user taps again. Accepted (no offline queue).
- Chicago midnight or a route switch while a proof is sending or waiting for Retry: the send is out of scope; Retry
  disappears and a late answer is left to the feed reload.
- Deleting a stop or a user removes their proofs' drinks by cascade, and the drink delete hook removes the photos.
- The crawl moves on while a proof is sending: the hook checks the stop is on the current route, not that it is the
  current stop — same as today's drink create, which has no current-stop check.
- A Conductor deletes a proof photo for content: the drink goes with it, by design; the owner sees their count drop.

## Left to the builder

The transaction mechanics in the PocketBase JS hook (which hook event, `runInTransaction` shape) and how
`action_order` is applied to a hook-created row; the exact component placement of the hidden input; the Retry toast
layout.
