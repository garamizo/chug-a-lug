# Closing Time — the night's highlight reel

Status: design, 2026-11-16. Branch `feat/closing-time`. Last of the four M5 branches (ride-home → photo-tab →
golden-spikes → **closing-time**).

## Intent

The user's words: "Closing time happens after we return to the station, so it can be time based." "In order we see
the station stop, then photos, chats, spikes, drinks, In a cool montage." "It should be a video with the most liked
photos and messages, not exhaustively all."

So when the train home arrives, the crew gets an auto-playing montage of the night: for each stop, in route order —
the stop, its most-Cheered photos, its most-Cheered message, the Golden Spikes won there, and what was drunk there —
ending on the night's final spikes. Highlights only, a few minutes at most.

**Goals**
- Opens at Closing Time (the train home arriving: `liveDay.closedAt`, from golden-spikes), for everyone on the crew,
  on the event day and on practice days alike.
- A "video": full-screen, auto-advancing slides with motion, tap to skip or go back, hold to pause.
- Computed on the phone from rows Live already loads (drinks, Freight, messages, Cheers, spikes) — nothing stored.

**Non-goals**
- Rendering or exporting a video file, music, sharing outside the app.
- The Roundhouse album, the Hall of Fame, admin curation of the reel.
- Replaying past nights (the feed is today's; a later Roundhouse can reuse the builder).

**Anti-goals**
- Showing everything (a slide per photo or per drink).
- A reel that differs between phones for the same rows.

## How it works today (verified)

- `liveDay.closedAt` (`web/src/lib/live/day.svelte.ts`) is null until the crawl is `after` with a resolved run home;
  then it is the home arrival on the activity clock (`crawlEnd.at - (now - realNow)`).
- `liveDay.feed` holds today's `drinks`, `media` (with `drink_kind` on Tab photos), `messages`, `reactions` for the
  current route; `liveDay.spikeEvents` is the shared Golden Spikes timeline; `liveDay.stops` / `liveDay.legs` are the
  route.
- Cheers are `reactions` rows `{ user, target_kind: 'drink'|'bulletin'|'message'|'media', target_id }`, one per person
  per entry; `reactionSummary` (`web/src/lib/live/chat.ts`) counts them.
- Photos are tagged with a stop (`media.stop`) while a stop is open; drinks always have a stop; messages have none.
- Venue photos for a stop come from `stopPhoto(stop)` (`web/src/lib/photo.ts`).
- The Lightbox shows Freight at `thumb: '1200x0'` (`FreightStrip.svelte`).

## Approaches considered

1. **A slide list built by a pure function, played by one full-screen component (chosen).** `buildReel(...)` returns
   ordered slides; a player handles timing, motion and gestures. Deterministic, testable, cheap.
2. Render an actual video (canvas + MediaRecorder) — heavy on phones at midnight, codec quirks, and the user asked for
   the experience, not a file. Later, perhaps.
3. A static recap page. Not a montage. Rejected.

## Design

### Stop windows — which stop a message or a spike belongs to

`current.ts` exports its existing private `timings` as `stopTimings(stops, legs, startAt)` (no behaviour change).
`stopWindows(stops, legs, startAt, shiftMs, closedAt): { stopId: string; from: string; to: string }[]` in
`web/src/lib/live/reel.ts`: for each stop in route order, `from` = its arrival from `stopTimings`, `to` = the next
stop's arrival, and for the last stop `to` = `closedAt`. These are the **stored** (planned) legs: a Conductor
correction re-plans the remaining legs on the server (`recomputeLegs`), so after the night the stored legs already
reflect it; a stale incoming leg can put a message under the neighbouring stop — accepted. Plan times are moved to the
activity clock by `shiftMs = now - realNow` (0 on the event day; anchors are off on practice days), the same shift
`closedAt` uses. Activity before the first arrival belongs to the first stop.

### The reel — `buildReel(input): Slide[]`

```ts
export type Slide =
  | { kind: 'title'; title: string; date: string }                                  // the route's title, event date
  | { kind: 'stop'; stopId: string; name: string; station: string; at: string; photo: string | null }
  | { kind: 'photo'; mediaId: string; cheers: number; author: string; caption: string } // caption: proofCaption
  | { kind: 'message'; messageId: string; body: string; author: string; cheers: number }
  | { kind: 'spikes'; events: SpikeEvent[] }                                         // won-once spikes at the stop
  | { kind: 'drinks'; stopId: string; counts: Record<DrinkKind, number> }            // crew totals at the stop
  | { kind: 'finale'; holders: SpikeEvent[]; caboose: SpikeEvent[]; total: number };
export type ReelInput = {
  itineraryTitle: string; eventDate: string;
  stops: Stop[]; windows: ReturnType<typeof stopWindows>;
  drinks: DrinkEntry[]; media: Media[]; messages: ChatMessage[]; reactions: Reaction[];
  spikes: SpikeEvent[]; date: string; closedAt: string;
};
```

Order: `title`, then for each stop in route order: `stop`, its `photo` slides, its `message` slide, its `spikes`
slide, its `drinks` slide — then `finale`. Selection (highlights only, bounded):
- **Photos at a stop**: images (`kind = image`) tagged with that stop, ranked by Cheers descending, then earliest
  `at`, then id; the top **2** with at least one Cheers. If none has a Cheers, the single earliest photo, so a stop
  with photos is never blank. Videos are skipped.
- **Message at a stop**: messages whose `at` is in the stop's window, ranked the same way; the top **1** with at
  least one Cheers; none if none was Cheered.
- **Spikes at a stop**: one `spikes` slide listing the won-once spikes (Pathfinder, Triple Header, Full Consist)
  whose `at` is in the window; skipped when there are none. Held-spike hand-overs are not replayed per stop — the
  finale shows who holds them at the end.
- **Drinks**: the crew's count per Tab kind for drinks at that stop; skipped if the stop had none.
- A stop with nothing else still gets its `stop` slide.
- **Finale**: the current holder of each held spike (Big Boy, Whistle Stop, Railfan), every Caboose winner, and the
  crew's alcoholic-drink total.
- **Cut-off**: source rows (drinks, media, messages) of `date` with `at < closedAt`. Spike events come from
  `liveDay.spikeEvents`, which golden-spikes already cuts at Closing Time and which places Caboose **at** `closedAt` —
  they are taken as they are, never re-filtered by `< closedAt`.
- **Cheers** are counted as of when the reel is built: all of the day's reactions in `liveDay.feed.reactions`
  (the feed loads every reaction created on the server's day for the route, independent of chat pagination). A Cheers
  given after Closing Time still counts — "most liked" includes the morning after.

Durations (below) put a 6-stop night at about 2 minutes and a 10-stop night at about 3½.

### The player — `/live/closing`

- A route `web/src/routes/(app)/live/closing/+page.svelte` rendering `ClosingReel.svelte`: a full-screen layer
  (`role="dialog"`, `aria-modal="true"`, focus moved into it, focus returned on close).
- **Presentation state.** The app layout treats `/live/closing` as a presentation: it hides the compact board
  banner, the pinned Bulletin, the tab bar and the Bulletin composer there, and suppresses the Golden Spike
  celebration (its queue pauses, as for `quiet`) so nothing captures keys or taps over the reel. The spike art is
  extracted from `SpikeCelebration.svelte` into `SpikeArt.svelte` and reused; the celebration controller is not
  mounted in the reel.
- **Timing**: `title` 3 s, `stop` 3 s, `photo` 4.5 s, `message` 4 s, `spikes` 3.5 s, `drinks` 3 s, `finale` 6 s.
  Story-style progress bars at the top (`reel-progress`).
- **Motion**: photos slowly zoom and pan, slides cross-fade. `prefers-reduced-motion`: cross-fade only.
- **Gestures**: tap the right third → next, left third → previous, press and hold → pause, ✕ (`reel-close`);
  keyboard ←/→/Space/Escape. The reel ends on the finale with **Watch again** (`reel-replay`) and **Done**
  (`reel-done`). A slide whose image fails to load is skipped.
- **Loading.** The reel is built only from a feed read that **started after** Closing Time was seen for the current
  route, day and simulation run: when `closedAt` turns non-null, `liveDay` starts a fresh read and the reel is ready
  (`liveDay.reelReady`) once that read — or a later one — is accepted. A seek or a scope change resets it. Until
  ready, the player shows a loading line; if the latest read failed it shows "No signal" with **Try again** (re-runs
  `loadFeed`). The slide list is snapshotted once built, so a live update doesn't reshuffle a playing reel.
- **Not yet.** If `liveDay.closedAt` is null the page shows `copy.closingNotYet` and a link back to Live.
- **History.** Entering pushes `/live/closing` (Play and the automatic open both use `goto`). ✕ and Done go back if
  the previous entry is Live in this app session (`guardedBack`-style, so a double tap pops once), otherwise
  `goto('/live', { replaceState: true })` (direct entry or a reload). Browser Back from the reel returns to Live.
  Returning to Live never re-opens the reel automatically.
- Test ids: `closing-reel`, `reel-slide-{kind}`, `reel-loading`, `reel-retry`.

### Opening at Closing Time

- On Live, once `liveDay.closedAt` is set, a card at the top: `copy.closingCard` (`closing-card`) with **Play**
  (`closing-play`) → `/live/closing`.
- The first time a phone is on Live after Closing Time **and** the reel's data is ready (the feed loaded after
  Closing Time for this scope), it opens the reel by itself — once per device, keyed
  `{itineraryId}:{date}:{runId ?? ''}` in `localStorage` (`chugalug.closingShown`, guarded like `seen.ts`, with an
  in-memory fallback). The key is written when the reel actually starts playing, not when it is scheduled. Leaving the
  reel before it started (✕, Done or Back while loading) keeps the phone from opening it automatically again this
  session, without marking it watched. Deferred while a sheet, the Lightbox, the Tab or the Bulletin composer is open,
  and while practice `quiet` applies.

### Labels (web/src/lib/labels.ts)

- `closingCard: 'Closing Time — the night's highlights'`, `closingPlay: 'Play'`, `closingNotYet: 'Closing Time
  starts when the train home arrives.'`, `closingLoading: 'Putting the night together…'`, `closingReplay: 'Watch
  again'`, `closingDone: 'Done'`, `closingFinale: 'That's the night'`, `closingCrewTotal: 'drinks, all told'`,
  `closingCheers: 'Cheers'` (badge count on photo/message slides).
- Existing: `wrapUpPhase: 'Closing Time'`, `noSignal`, spike names, drink labels and icons, `proofCaption`.

README glossary: the **Closing Time** row ("Wrap-up phase") gains "the highlight reel that plays when the train home
arrives". FEATURES.md gains a Closing Time bullet; ROADMAP's M5 notes it.

## Edge cases

- No photos or messages at all: the reel is stops, spikes, drinks and the finale.
- A route with no run home or an impossible one: no Closing Time (closedAt null), no card, `/live/closing` explains.
- A late photo after Closing Time: not in the reel (cut at `closedAt`); a late Cheers does count.
- The first feed read after Closing Time fails: no automatic open until a later read succeeds; Play shows Try again.
- Practice day: windows and the cut use the same shift as `closedAt`.
- Opening the reel over a sheet or Lightbox: the automatic open waits; Play is on Live itself.

## Tests

- Unit `web/tests/unit/reel.test.ts`: slide order per stop; top-2 photos by Cheers with ties; the uncheered fallback
  photo; videos skipped; the top-1 Cheered message by window; won-once spikes grouped per stop, held hand-overs not
  replayed; Caboose (at `closedAt`) on the finale; drinks slide counts and skip; source rows at/after `closedAt` and
  other days ignored; late Cheers counted; deterministic for shuffled input. `stopWindows`: matches `stopTimings`,
  last window ends at `closedAt`, practice shift. `current.test.ts`: `stopTimings` is the old `timings`.
- Unit for the auto-open decision (`shouldAutoOpen(...)`: closedAt set, feed loaded after it for this scope, not
  shown, no overlay, not quiet) and the marker (written on play; memory fallback).
- e2e in the **simulation** suite (`web/tests/sim/closing.spec.ts`), because only it moves the server's event clock
  (drinks and photos are stamped by the server): a route on the simulation's event date boarding at Aurora with two
  CUS stops (dwell 5, walk 4) recomputes to a resolved run home (~20:42Z on the fixture day); activity is posted
  while the clock is inside the night, then the clock moves past the home arrival. Checks: the card; one automatic
  open; tap/hold/keys; a Cheered photo and the finale; ✕ and Back return to Live without reopening; leaving while
  loading; Try again; reduced motion; no celebration over the reel; the automatic open waits for the Tab sheet.
  Ordinary e2e: direct entry before Closing Time shows the not-yet line; one `layoutSweep` line for that state.

## Left to the builder

The slide visuals (typography, motion parameters, drinks slide layout), the preload mechanism, and the exact
`withRunHome` seed (which stops and times give a resolved closing leg on the fixture timetable).
