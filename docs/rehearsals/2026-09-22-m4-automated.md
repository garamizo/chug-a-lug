# M4 automated rehearsal — 2026-09-22

Status: implementation and automated rehearsal complete; physical-phone and real-Saturday-recording
acceptance remain pending. This is not a claim that a manual at-home rehearsal occurred.

- Branch: `feat/m4-finish`, based on `410e907`.
- Tested implementation commit: `5cc20f5`.
- Run: `browser-fixture`; checked-in `recording` archive, Chicago service date 2026-12-26.
- Window: 2026-12-26T18:20:00Z through 2026-12-27T00:10:00Z.
- Environment: host Node 25.9.0, Chromium with iPhone 13 emulation; three isolated cookie contexts.
  One Crew browser's Date was deliberately three hours behind; performance time was unmodified.
- Origins: web `http://127.0.0.1:15173`, disposable PocketBase `http://127.0.0.1:18093`.
- No production credentials/data, phone connections or suitable real Saturday archive were used.

The final gate ran sequentially after the last code change:

| Command | Result |
| --- | --- |
| `cd web && npm test` | 543 passed across 54 files |
| `cd web && npm run check` | 0 errors, 0 warnings |
| `cd web && npm run test:e2e` | 43 passed, normal simulation-disabled configuration |
| `bash scripts/test-hooks.sh` | 47 normal/upgrade checks plus 3 isolated simulation checks passed |
| `cd web && npm run test:sim` | 2 passed: full three-session rehearsal and web restart persistence |
| `cd web && npm run test:sim:offline` | Production build and 1 real service-worker offline test passed |

The normal hook pass intentionally skips the three simulation-only checks, which the second hook
pass runs on a separate database. Node reports the repository's existing Node 22 engine requirement;
these host results were obtained with Node 25.9.0, not a claimed Node 22 run.

The browser rehearsal verifies paused agreement, supported rate controls, pause/resume continuity,
forward seek propagation, rejected backwards seeks, Crew denial and stale-control conflicts. It
holds an actual clock response until a newer revision arrives and verifies the newer mapping wins.
Normal, delayed and canceled trains, expired alerts and independent feed freshness are asserted
against real replay endpoints. A live-feed sentinel saw no requests despite a dummy configured token.

The real route editor exercises Hold, Annul, anchor selection and adding a manual venue. Its Save
loses one successful response, then retries the same edited Bulletin ID without duplication. Another
Crew acknowledges it; the Crew Board reflects drinks. Paused beer then water followed by Undo leaves
beer, ordered by server sequence. A small photo uploads without external requests and retains its
file timestamp. Persisted anchors, drinks, Bulletins and event logs carry December event timestamps;
actual recomputed legs and the saved stops are inspected. Offline writes are rejected and reconnect
resynchronizes before the next action. Playback reaches the window end and trip data becomes stale.

Web is restarted against the same PocketBase while paused and while running. Paused time and revision
survive exactly; running time includes downtime. Every fresh suite seed asserts the absence of old
anchors, drinks, acknowledgements and uploads.

The offline test builds the production application and registers its actual service worker. It
loads and mirrors the route, disconnects all networking and reloads `/route`. The saved route remains,
its age is measured in wall minutes, Railroad Time is unavailable, and no active board is fabricated.
Reconnection restores synchronization. Cache inspection confirms that no simulation clock or Metra
endpoint responses were stored by Workbox.

Review screenshots (synthetic identities only):

- [Conductor controls](m4-2026-09-22/controls.png)
- [Departure Board and Tab](m4-2026-09-22/board.png)
- [Bulletin sheet](m4-2026-09-22/bulletin.png)
- [Production offline route](m4-2026-09-22/offline.png)

Review found and fixed same-revision clock samples invalidating Save previews, stale Tab/anchor reads,
a missing no-store option on station reads, the image compressor's default CDN worker dependency,
and simulation status scrolling out of view. Status now stays below the header together with the
compact board; scroll assertions cover its visibility. The selected rate, time input, Bulletin
buttons and offline route are readable at mobile width.

Remaining acceptance: run the [physical-device checklist](m4-template.md) with a Conductor and two
Crew phones on dedicated HTTPS origins, then repeat with a suitable indexed Saturday recording and
matching archived GTFS on its original date. Record device/browser details and issues separately.
No merge, push or production deployment was performed.
