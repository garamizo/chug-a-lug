# Closing Time — the night's highlight reel

Status: design, 2026-11-16. Branch `feat/closing-time`. Last of the four M5 branches (ride-home → photo-tab →
golden-spikes → **closing-time**).

## Intent

The user's words: "Closing time happens after we return to the station, so it can be time based." "In order we see
the station stop, then photos, chats, spikes, drinks, In a cool montage." "It should be a video with the most liked
photos and messages, not exhaustively all."

So when the train home arrives, the crew gets a short, auto-playing montage of the night: for each stop, in route
order — the stop, its most-Cheered photos, its most-Cheered messages, the Golden Spikes won there, and what was drunk
there — ending on the night's final spikes. Highlights only.

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

`stopWindows(stops, legs, startAt, shiftMs, closedAt): { stopId: string; from: string; to: string }[]` in
`web/src/lib/live/reel.ts`: for each stop in route order, `from` = its arrival (from `timings` in `current.ts`, so
anchors and the opening leg behave as on Live), `to` = the next stop's arrival, and for the last stop `to` =
`closedAt`. Plan times are moved to the activity clock by `shiftMs = now - realNow` (0 on the event day), the same
shift `closedAt` uses. Activity before the first arrival belongs to the first stop.

### The reel — `buildReel(input): Slide[]`

```ts
export type Slide =
  | { kind: 'title'; title: string; date: string }                                  // the route's title, event date
  | { kind: 'stop'; stopId: string; name: string; station: string; at: string; photo: string | null }
  | { kind: 'photo'; mediaId: string; cheers: number; author: string; caption: string } // caption: proofCaption
  | { kind: 'message'; messageId: string; body: string; author: string; cheers: number }
  | { kind: 'spike'; event: SpikeEvent }
  | { kind: 'drinks'; stopId: string; counts: Record<DrinkKind, number> }            // crew totals at the stop
  | { kind: 'finale'; holders: SpikeEvent[]; caboose: SpikeEvent[]; total: number };
export type ReelInput = {
  itineraryTitle: string; eventDate: string;
  stops: Stop[]; windows: ReturnType<typeof stopWindows>;
  drinks: DrinkEntry[]; media: Media[]; messages: ChatMessage[]; reactions: Reaction[];
  spikes: SpikeEvent[]; date: string; closedAt: string;
};
```

Order: `title`, then for each stop in route order: `stop`, its `photo` slides, its `message` slides, its `spike`
slides, its `drinks` slide — then `finale`. Selection (highlights only):
- **Photos at a stop**: images (`kind = image`) tagged with that stop, ranked by Cheers (media reactions) descending,
  then earliest `at`, then id; the top **3** with at least one Cheers. If none has a Cheers, the single earliest
  photo, so a stop with photos is never blank. Videos are skipped (the player shows images only).
- **Messages at a stop**: messages whose `at` is in the stop's window, ranked the same way; the top **2** with at
  least one Cheers; none if none was Cheered.
- **Spikes at a stop**: spike events whose `at` is in the window, except Caboose (it lands on the finale).
- **Drinks**: the crew's count per Tab kind for drinks at that stop; the slide is skipped if the stop had none.
- A stop with no photos, messages, spikes or drinks still gets its `stop` slide.
- **Finale**: the current holder of each held spike (Big Boy, Whistle Stop, Railfan), every Caboose winner, and the
  crew's alcoholic-drink total.
- Only rows of `date` and with `at < closedAt` are used (as spikes do).

### The player — `/live/closing`

- A route `web/src/routes/(app)/live/closing/+page.svelte` rendering `ClosingReel.svelte` full-screen (dark, above
  the tab bar). If `liveDay.closedAt` is null it shows a short "Closing Time starts when the train home arrives" line
  and a link back to Live.
- Timing: `title` 3 s, `stop` 3.5 s, `photo` 5 s, `message` 4.5 s, `spike` 3.5 s, `drinks` 3.5 s, `finale` 6 s.
  Story-style progress bars at the top (`reel-progress`).
- Motion: photos slowly zoom and pan (Ken Burns), slides cross-fade; spike slides reuse the golden-spike art from
  `SpikeCelebration`. `prefers-reduced-motion`: cross-fade only.
- Gestures: tap the right third → next, left third → previous, press and hold → pause, ✕ (`reel-close`) → back to
  Live; keyboard ←/→/Space/Escape. The reel ends on the finale with **Watch again** (`reel-replay`) and **Done**.
- Images load ahead: the player preloads the next two slides' images (`thumb: '1200x0'`).
- Test ids: `closing-reel`, `reel-slide-{kind}`.

### Opening at Closing Time

- On Live, once `liveDay.closedAt` is set, a card at the top: "🎬 Closing Time — the night in a minute"
  (`closing-card`) with **Play** → `/live/closing`.
- The first time a phone is on Live after Closing Time, it opens the reel by itself — once per device, keyed
  `{itineraryId}:{date}:{runId ?? ''}` in `localStorage` (`chugalug.closingShown`, guarded like `seen.ts`, with an
  in-memory fallback). Not while practice `quiet` is on for that screen.

### Labels (web/src/lib/labels.ts)

- `closingCard: 'Closing Time — the night in a minute'`, `closingPlay: 'Play'`, `closingNotYet: 'Closing Time starts
  when the train home arrives.'`, `closingReplay: 'Watch again'`, `closingDone: 'Done'`, `closingFinale: 'That's the
  night'`, `closingCrewTotal: 'drinks, all told'`, `closingCheers: 'Cheers'` (badge count on photo/message slides).
- Existing: `wrapUpPhase: 'Closing Time'`, spike names, drink labels and icons, `proofCaption`.

README glossary: the **Closing Time** row ("Wrap-up phase") gains "the reel that plays when the train home arrives".
FEATURES.md gains a Closing Time bullet; ROADMAP's M5 notes it.

## Edge cases

- No photos or messages at all: the reel is stops, spikes, drinks and the finale.
- A route with no run home or an impossible one: no Closing Time (closedAt null), no card, `/live/closing` explains.
- A late photo after Closing Time: not in the reel (cut at `closedAt`).
- Undo/deletes before opening: the reel is built when it opens; a slide whose image fails to load is skipped.
- Practice day: windows and the cut use the same shift as `closedAt`.
- Very long nights: at most 3 + 2 + spikes + 2 slides per stop; ~10 stops ≈ 3–4 minutes worst case.

## Tests

- Unit `web/tests/unit/reel.test.ts`: slide order per stop; top-3 photos by Cheers with ties; the uncheered fallback
  photo; videos skipped; messages placed by window and top-2 Cheered only; spikes by window with Caboose on the
  finale; drinks slide counts and skip; rows after `closedAt` and other days ignored; finale holders; deterministic for
  shuffled input. `stopWindows`: anchors/opening behave as `timings`, last window ends at `closedAt`, practice shift.
- Unit for the auto-open marker (once per key, memory fallback).
- e2e `web/tests/e2e/closing.spec.ts`: a seeded crawl run to its home arrival (sim/clock helpers as in existing
  specs) shows the card, auto-opens the reel once, advances on tap, shows a Cheered photo and the finale, closes with
  ✕; before Closing Time `/live/closing` shows the not-yet line. One `layoutSweep` line for the reel.

## Left to the builder

The slide visuals (typography, Ken Burns parameters, drink slide layout), how the e2e reaches Closing Time (seed legs
and clock), the preload mechanism.
