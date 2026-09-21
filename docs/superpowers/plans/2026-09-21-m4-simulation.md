# M4 simulation: implementation plan

- Date: 2026-09-21
- Status: planned, not implemented
- Branch/worktree: `feat/m4-simulation`, `.worktrees/m4-simulation`
- Starting commit: `72a32a5`

Design authority: [M4 simulation without GPS](../specs/2026-09-21-m4-simulation-design.md).
**No GPS, geolocation mocks, waypoint scripts, individual positions, Punch or straggler tracking.**

## Execution rules

- Continue in the M4 worktree; the spec, this plan, code and tests stay on the same branch.
- Write each behavior's tests first, demonstrate the intended failure, then implement it.
- Do not infer completion from unchecked or checked boxes in this file. Record commands/results and
  any deviations in a final completion note. These tasks have not been executed.
- Run `npm install` in `web/` before testing. Scripts importing npm dependencies live under `web/`.
- Read applicable repo instructions at implementation time. Never use ports 3000/8090 for a test or
  rehearsal and never run `just up` to start simulation. One test suite at a time across worktrees.
- Fixtures and simulated instances use explicit isolated environment values. Do not copy or symlink
  the main checkout's `.env`, `.secrets`, or PocketBase data into a rehearsal. Read-only access to
  actual recordings is permitted when needed; keep their files out of git.
- After each implemented task, run the repo gate sequentially:
  `cd web && npm test && npm run check && npm run test:e2e`, then
  `bash scripts/test-hooks.sh` from the repo root. Once added, run `npm run test:sim` after the ordinary
  e2e suite has stopped. Use targeted tests during red/green iteration; the full gate closes a task.
- Changes here add no external service dependency or new browser automation library.

## Dependency map

```
1 clock math -> 2 persisted authority -> 3 isolated seed/runtime
4 recording format -> 5 replay reader -> 6 provider/API integration
2 + 6 -> 7 server planning and event timestamps
2 -> 8 client synchronization
7 + 8 -> 9 live/editor wiring and controls
3 + 6 + 9 -> 10 integration, offline and rehearsal acceptance
10 -> 11 documentation and final review
```

Execute in the numbered order below so each commit is independently understandable. Task 3 uses a
timetable scenario until recording support is complete. No separate agents are required.

## Task 1 — Pure clock model and transition rules

**Create:** `web/src/lib/sim/clock.ts`, `web/tests/unit/simClock.test.ts`.

1. Define serializable clock state/context types matching spec §4. UTC ISO values cross boundaries;
   arithmetic operates on epoch milliseconds. Include run ID, revision, immutable source/date/window,
   rate and remembered resume rate. A request context carries both event and wall instants.
2. Write table-driven tests for paused clock; 1×/10×/60×; rate change without a jump; pause/resume;
   forward seek while paused; backwards seek and seek-while-running rejection; malformed/NaN/infinite
   values; exact window bounds; clamping/ended state; restart using persisted wallStart. Include the
   event day's Chicago midnight and a UTC date change that is not a Chicago date change.
3. Implement pure `eventTimeAt(state, wallNow)` and transition/validation helpers. No fetch, global
   timers, PocketBase or mutable module singleton in this file. Handle zero rate explicitly.
4. Keep a small shared JSON vector fixture for the later PocketBase hook clock helper; include rates,
   dates and expected event instants. Test it with the TypeScript helper now.

**Targeted check:** `cd web && npx vitest run tests/unit/simClock.test.ts`.
**Commit:** `feat(sim): define the shared rehearsal clock`.

## Task 2 — Persistent clock authority and authenticated controls

**Create:**
- `pocketbase/pb_migrations/1758800000_simulation.js`
- `web/src/lib/server/sim/clock.ts`
- `web/src/routes/api/sim/clock/+server.ts`
- `web/tests/unit/simClockApi.test.ts`, `web/tests/hooks/simulation.test.ts`

**Modify:** `web/src/lib/server/env.ts`, `web/src/lib/labels.ts`.

1. Add failing API tests for disabled GET without a DB read, disabled POST, missing authentication,
   Crew mutation, valid Conductor transitions, stale expectedRevision, concurrent updates, invalid
   input, corrupt/missing state, persistence failure and restart/resume behavior. Test no-store headers.
2. Add a migration for the private singleton clock collection and fields. Do not seed an active
   clock in the migration: ordinary production installs must remain unaffected. Test that normal
   users cannot read or mutate this collection directly; list rules filter rather than return 403.
3. Expose `SIM` via `serverEnv` as an exact `=== '1'` opt-in; add `SIM_RUN_ID` and
   `SIM_RECORDINGS_DIR` getters for run identity and bounded recording access. A sim instance without a valid state
   returns 503; it never falls back to wall time. Normal mode has no dependency on simulation storage.
4. Implement injectable server clock reads and serialized updates, using `adminPb` only lazily.
   Capture wall time after obtaining the state. Compare revision inside the control queue and persist
   the fully validated new state before returning it. Echo complete public state on success/409.
5. Add the active-plan-write guard API for task 7. Control changes fail with a retryable 409 while
   writes are applying. Tests must show the guard clears on exceptions and does not block reads.
   Do not introduce a mutex that recompute must acquire while commit is awaiting it.
6. Keep errors shown by the UI in `labels.ts`. No state or recording filesystem paths go in public
   error messages. No client-specific virtual clock accepted from request headers.

**Targeted checks:** `simClockApi.test.ts`, then isolated hook suite.
**Commit:** `feat(sim): persist and control the server clock`.

## Task 3 — Isolated timetable rehearsal and deterministic seed

**Create:**
- `compose.sim.yml`
- `web/scripts/sim.mjs` (launcher/status/seed entry point)
- `web/src/lib/sim/config.ts` (pure validation suitable for unit tests)
- `web/tests/unit/simConfig.test.ts`
- `web/tests/fixtures/sim/timetable/scenario.json`
- `.env.sim.example` (no real credentials)

**Modify:** `justfile`, `.gitignore`, `web/src/lib/server/env.ts` as needed.

1. Test configuration validation first: safe run slug, explicit source/date/window, isolated URLs and
   paths, no production port/data defaults, invalid or conflicting values rejected. Refuse to run
   with inherited production credentials. Do not rely on a user remembering to unset variables.
2. Define a standalone Compose project with web and PocketBase only. Default host ports are
   15174/18094, bound to loopback. Parameterize reachable host/origins for a deliberate phone run.
   Set `SIM=1` on both services and `PUBLIC_SIM=1` at web build and runtime. Pass the matching internal
   recompute URL/secret. Do not merge with the production Compose file or mount production data.
3. Launch with an explicit env allowlist and separate env file even though the root justfile loads
   `.env`. Proposed operator commands: `just sim RUN SOURCE`, `just sim-status RUN`, `just sim-stop RUN`.
   `SOURCE` is `fixture` initially or a safe recording ID later. No delete/reset subcommand is needed.
4. Use one ignored runtime directory/project per RUN. Write an ownership/config marker; require exact
   source/date/port agreement before resuming an existing run. A new name starts a fresh database.
   Never recreate a user's saved run behind their back. Test port availability before launching.
5. Seed the singleton paused clock **before** any event-producing hooks. Then seed isolated users,
   a draft itinerary and stops, and lock by update. Do not copy likes, media, Tab, Bulletins, acks,
   check-ins or credentials from production. If using a sanitized route export, remint all record IDs.
6. Pin `GTFS_URL` to the fixture zip and use explicit empty external API tokens. Trigger/wait for final
   recompute and inspect actual persisted legs. Print URLs and test identities without secrets in logs.
7. Provide shutdown that stops only this project's services. Keep its data for inspection/restart.

**Targeted check:** config unit tests plus a one-instance smoke check on rehearsal ports, followed by
shutdown before test suites run. No production services are restarted.
**Commit:** `feat(sim): launch isolated timetable rehearsals`.

## Task 4 — Recording metadata and reproducible fixture builder

**Create:**
- `web/src/lib/server/metra/recording.ts` (manifest/index validation helpers)
- `web/scripts/index-recording.mjs`
- `web/scripts/generate-sim-fixture.mjs`
- `web/tests/unit/recording.test.ts`
- `web/tests/fixtures/sim/recording/` (small manifest, matching zip, observations and protobufs)

**Modify:** `web/scripts/record.mjs`, `web/src/lib/server/metra/recorder.ts`,
`web/tests/unit/recorder.test.ts`, `justfile`.

1. Test manifest parsing, hash mismatch, date/window validation, missing zip, truncated last observation,
   invalid snapshot names, path traversal/symlink escape, duplicate snapshot suppression and failed
   disk writes. Add a test that concurrent timer ticks do not overlap recorder fetches/writes.
2. Extend recording to archive static GTFS before recording begins and write version-1 metadata.
   Record one per-feed poll observation with success/failure and snapshot reference, including a
   successful poll whose protobuf timestamp did not change. Only record success after the referenced
   file exists. Keep polling at least 30 real seconds apart and omit tokens/error objects.
3. Write manifests and new snapshots atomically; append observation records. Preserve compatibility
   with existing snapshot filenames. The indexing CLI requires an explicit matching static zip,
   service date and window for legacy folders, and marks freshness as conservative without history.
4. Build a tiny deterministic recording against `tests/fixtures/gtfs.zip`: normal departure, delayed
   departure, canceled departure, active/expired alert, missing feed and independent per-feed outage.
   Include unchanged-but-successfully-polled snapshots and timestamps straddling UTC midnight.
5. Generate protobufs with `gtfs-realtime-bindings`. Use standalone copied bytes, not a pooled
   Buffer's entire `.buffer`. Assert absent optional fields stay absent; inspect with own-property
   checks. Make regeneration byte-stable and document the command and expected file list.
6. Use the recording's original Chicago date; do not rewrite timestamps or `startDate`. Check its
   archived GTFS serves BNSF that day. Fixtures must contain no real identities or credentials.

**Targeted check:** recorder and recording unit tests; regenerate fixture and assert no diff.
**Commit:** `feat(metra): archive replay metadata and deterministic scenarios`.

## Task 5 — Disk-backed replay and independent freshness

**Create:** `web/src/lib/server/metra/replay.ts`, `web/tests/unit/replay.test.ts`.

1. Test index selection before first observation, between observations, after last observation, exact
   boundaries, missing/corrupt snapshots, unsupported manifest versions and legacy fallback. Select
   only observations/snapshots at or before eventNow, even when a later file is already on disk.
2. Test that unchanged successful polls refresh only their own feed; failed observations do not.
   Test positions fresh while tripupdates stale, alerts missing while other feeds fresh, the 120-second
   threshold, paused clock stability and forward seek across a gap. Ages are virtual elapsed time.
3. Implement immutable snapshots at a captured clock context. Copy or safely cache decoded messages;
   never rewrite header/entity times or mutate a previously returned result. Use bounded decoded-file
   caching and an index built once per immutable recording.
4. When a selected observation references a corrupt/missing file, return the most recent valid prior
   data with its original age and a diagnostic. Reject malformed overall recording configuration.
   Never reach the live loader as a recovery mechanism.
5. Validate entity service dates/trip IDs against the archived schedule; include an unmatched-trip
   diagnostic and fail setup if a supposed BNSF recording has no usable coverage. A single unrelated
   entity must not invalidate a recording that otherwise serves the route.
6. Test that the fixture's canceled train disappears, delayed train remains catchable and alert periods
   match virtual time through existing `readPredictions`/`selectAlerts` and departure merging.

**Targeted check:** `replay.test.ts` plus existing realtime/decode/real-feed tests.
**Commit:** `feat(metra): replay archived feeds at rehearsal time`.

## Task 6 — Central provider selection and Metra endpoint context

**Create:** `web/src/lib/server/metra/provider.ts`, `web/tests/unit/metraProvider.test.ts`.

**Modify:** `server/metra/index.ts`, `server/metra/realtime.ts`, `server/env.ts`,
`routes/api/metra/{next,alerts,status,stations}/+server.ts`, `lib/types.ts`,
`tests/unit/metra-endpoints.test.ts`, `tests/unit/realtime.test.ts` (all under `web/src`/`web` as appropriate).

1. First add endpoint tests with eventNow in December and real wall time in September. Default `after`,
   alert activity and per-feed freshness must use the selected context; explicit `after` still works.
2. Introduce the provider interface from spec §6. Adapt the live loader without changing its polling
   interval, credential handling or per-feed failure behavior. Snapshot each request consistently.
3. Select provider and static source centrally from the configured run. The replay/timetable branches
   must not start the live poller, even if a real token accidentally exists. Spy on fetch/start to prove
   this for next, alerts, status and setup-error paths. Recorded mode uses a pinned local GTFS source.
4. Preserve existing `mode` and timestamp payloads; add source and revision metadata. Keep feed source
   distinct from `FeedMode`. Propagate source diagnostics without filesystem paths or credentials.
5. For timetable mode, supply null feeds and existing `schedule_only` departures; do not generate
   vehicle locations. Validate the selected service date actually has schedule coverage.
6. Update task 3's SOURCE handling for fixture recording/real recording manifests. Instance source/date
   remain immutable. Missing/corrupt replay configuration yields a clear setup failure, never live data.

**Targeted check:** provider and endpoint tests plus current static/realtime regressions.
**Commit:** `feat(sim): serve rehearsal feeds through the Metra APIs`.

## Task 7 — Server planning, anchors and event timestamps

**Create:** `pocketbase/pb_hooks/clock.js`, a new incremental migration
`pocketbase/pb_migrations/1758810000_broadcast_time.js`.

**Modify:**
- `web/src/lib/server/{plan,recompute}.ts`
- `web/src/routes/api/plan/{preview,commit}/+server.ts`
- `pocketbase/pb_hooks/{planning.pb,live.pb}.js`
- `web/src/lib/types.ts`
- Unit tests `planEndpoints`, `planCommit`, `serverPlan`, `recompute`; hook tests `live`, `simulation`

1. Add failing cases for a simulated event-day anchor on a different wall day; off-day rejection;
   simulated Chicago midnight; commit validation/anchor/recompute using the same captured context;
   controller mutation during a commit and during its validation; stale client clockRevision
   refusing before any write;
   failure cleanup and hook-triggered recompute completing without deadlock.
2. Preview returns its clock revision; simulation commits require that revision. Capture server context
   before validation and retain it through the explicit recompute. Ordinary SIM=0 payloads remain
   backward-compatible. The active-plan-write guard rechecks the captured revision on entry, wraps the application phase
   and clears in finally.
3. Supply explicit eventNow to `activeAnchor` and `cohesionBlockers`, including autonomous recomputes.
   Keep their shared date/history behavior. Do not change the schedule search or bypass the Save gate.
   Keep idempotent stop/Bulletin IDs and retry behavior from M3.
4. Implement the PocketBase helper using the same persisted state and shared clock vectors. Check
   `SIM` explicitly; no web callback from the hook. Seeded clock absence in SIM=1 must be visible as
   an error, not an event stamped on the wrong day.
5. Add and backfill `broadcasts.at`, stamp it in the create hook for ordinary and superuser requests,
   and reuse it for the Bulletin event log. Update planning hook event-log timestamps to event time.
   Do not change PocketBase autodates, locked_at or the real timestamp used for leg computed_at.
6. Prove a normal production request does not consult the clock record. Assert `broadcasts.at` and
   event_log.at are virtual in simulation but created/updated remain actual wall metadata.

**Targeted checks:** planning unit files, then hook suite. Hold a mocked commit mid-write to test the
clock guard, and release it to prove the normal recompute queue completes.
**Commit:** `fix(sim): use rehearsal time for planning and event actions`.

## Task 8 — Shared client clock and offline synchronization

**Create:** `web/src/lib/sim/clock.svelte.ts`, `web/tests/unit/simClient.test.ts`.

**Modify:** `web/src/lib/live/day.svelte.ts`, `web/src/routes/(app)/+layout.svelte`,
`web/src/lib/offline.ts`, `web/src/lib/live/feed.ts`, `web/vite.config.ts`,
`web/tests/unit/{liveDay,offline,offlineDay}.test.ts`.

1. Test a deliberately skewed browser wall clock, receipt/round-trip anchoring, interpolation, pause,
   revision changes, late responses, authentication teardown and single-owner timer cleanup. Use a
   fake monotonic clock for arithmetic; do not globally accelerate Date or timers in app code.
2. Implement authenticated no-store clock fetch before event-dependent startup. Respect PUBLIC_SIM:
   normal mode can use real time; an unknown enabled clock cannot quietly act like normal mode.
   Poll every five wall seconds and synchronize on online/focus. Ignore obsolete responses.
3. Drive LiveDay.now from this store, with the simulation display cadence. On revision changes refresh
   all event-dependent data immediately and invalidate in-flight feeds. Replay trains/alerts poll
   once per wall second; route/Tab/Freight retain their existing cadence/subscriptions.
4. Add a simulation write-readiness helper that resynchronizes before an action. When offline, keep a
   running client's last mapping visibly unsynchronized but prevent writes. A fresh offline boot can
   read its route mirror without inventing Railroad Time or enabling the board's active controls.
5. Scope the mirror to run ID and keep savedAt on wall time. Both `/live` and `/route` must render age
   using wallNow. On discovering a new run, invalidate previous-run data rather than overwriting its
   save timestamp with a false fresh success.
6. Clock APIs are never runtime-cached. Exclude simulation feed reads from normal Workbox fallback
   or key them by run/revision; choose exclusion for M4. Client clock/feed requests use no-store in
   simulation. Preserve ordinary live-mode offline route behavior.

**Targeted checks:** client clock and offline unit tests, existing live-day timer tests.
**Commit:** `feat(sim): synchronize the shared browser clock`.

## Task 9 — Controls and live-screen integration

**Create:** `web/src/routes/(app)/sim/+page.svelte`, `web/src/lib/components/SimulationStatus.svelte`.

**Modify:**
- `web/src/lib/components/AppMenu.svelte`, `web/src/lib/labels.ts`
- `web/src/routes/+layout.svelte`, `web/src/routes/(app)/+layout.svelte`
- `web/src/routes/(app)/{live,route,crew,notifications}/+page.svelte`
- `web/src/routes/(app)/plan/[id]/edit/+page.svelte`, `web/src/lib/live/preview.ts`
- `web/src/lib/live/day.svelte.ts`, Bulletin display components as needed

1. Write browser tests for indicator visibility, Crew read-only access, Conductor controls, paused
   state, selected rate, forward seek, stale revision handling and SIM=0 absence. Mock only the clock
   API in focused UI tests; task 10 verifies it end to end.
2. Render Shakedown Run and Railroad Time across signed-in screens. Display recorded/timetable source,
   event date, rate, ended state and synchronization status. Keep technical revision IDs out of UI.
3. Add Conductor-only menu navigation to /sim; keep server authorization authoritative. Controls send
   expectedRevision and adopt 409 state without retrying the obsolete action automatically.
4. Use liveDay/clock event time for new Tab entries and Crew Board date. Show Bulletin at, falling
   back to created for legacy data. Preserve actual photo capture dates and real cache/park ages.
5. In the editor, a new clock revision triggers a fresh preview. Track its returned revision, discard
   late results and keep Save gated while a check is pending. Submit clockRevision with simulation
   commit and require readiness for Save. Preserve the failed Bulletin's edited text and ID on retry.
6. Apply simulation readiness to Tab, undo, uploads, acknowledgements and standalone Bulletins through
   their existing action paths. Keep the real route editor as the sole anchor-setting UI.
7. Verify mobile layout: simulation status must not obscure navigation, Save, the Bulletin sheet or
   Departure Board. Accessible labels and every visible string live in labels.ts.

**Targeted check:** focused control/editor tests plus `npm run check` before the full gate.
**Commit:** `feat(sim): add rehearsal controls and live-screen status`.

## Task 10 — Complete simulation, production-build offline check and rehearsal

**Create:** `web/playwright.sim.config.ts`, `web/tests/sim/` integration specs/setup,
`web/scripts/smoke-sim-offline.mjs`, `docs/rehearsals/m4-template.md`.

**Modify:** `web/package.json` (`test:sim`, `test:sim:offline`), `web/playwright.config.ts`,
`web/tests/e2e/global-setup.ts` as needed; extract shared test configuration rather than copying secrets.

1. Default e2e/hook harnesses explicitly set SIM=0; the new sim suite sets SIM=1 on both web and
   PocketBase. Share existing test ports 15173/18093 and refuse reuse of a running server. Run suites
   sequentially, with temporary isolated data for each. Do not use the interactive rehearsal instance.
2. Seed the clock before itinerary writes, pin fixture GTFS/replay data and await recompute. Use the
   actual HTTP control endpoint to change time; do not mock /api/sim or /api/metra in integration tests.
3. With two independent contexts, prove pause agreement, rate continuity, forward seek propagation,
   Crew denial and stale-control conflict. Skew one phone's Date while keeping performance monotonic
   to prove clock synchronization does not rely on its wall clock.
4. Rehearse normal, delayed and canceled departures, active/expired alerts and independent feed
   outages. Assert the selected trip and source/freshness indicators, not only text snapshots.
   Verify that no real Metra fetch occurs throughout the suite.
5. Exercise anchor correction, Hold, Annul, added venue, Save/Bulletin retry after lost response,
   acknowledgement by another phone, live Crew Board totals, Tab undo and a small Freight upload.
   Assert persisted anchor/Tab/Bulletin/event-log times and the actual recomputed legs.
6. Disconnect one client, change the clock on another, reconnect and verify resync before writes.
   Deliver old responses late and ensure they cannot undo the newer revision. Verify mirror age is
   wall-based and a new run does not inherit the previous run's stored route/clock.
7. Restart web against the same isolated PB and verify paused/running persistence semantics. Start
   another fresh run and verify it has no old acknowledgements, media or anchors.
8. Build the production web bundle for an isolated simulation origin and run the offline smoke script
   on test ports after other servers stop. Register the real service worker, go fully offline and
   reload /route. Assert mirror/clock-unavailable behavior and online resync. A Vite development
   server test is not evidence that production service-worker behavior works.
9. Execute the manual scenario from spec §7 at home with a Conductor and two Crew clients. Save the
   run ID, source/date, tested build, browser/device details, observed issues and pass/fail checkpoints
   in a dated rehearsal note. A later real-recording rehearsal can follow once a suitable Saturday
   recording exists; synthetic green tests do not imply that real-data acceptance happened.

**Gate:** ordinary unit/type/e2e/hook checks, `npm run test:sim`, production build and
`npm run test:sim:offline`, all sequential. Capture screenshots of mobile controls, Departure Board,
Bulletin and offline state for the review; no screenshots containing production identities.
**Commit:** `test(sim): rehearse the complete live day without GPS`.

## Task 11 — Documentation, review and milestone closeout

**Modify:** `README.md`, `docs/OPERATIONS.md`, `CLAUDE.md`, this plan's completion note.

1. Update the simulation section and M4 roadmap to match what shipped. Remove claims of scripted GPS
   and synthetic vehicle positions. Do not mark M4 done until its acceptance evidence exists.
2. Document isolated start/stop/resume/new-run commands, record/index commands, original-date replay,
   archived GTFS requirement, legacy freshness limitation, forward-only seek and restart semantics.
3. Document accessible HTTPS origins for a multi-phone PWA rehearsal and keep normal production
   SIM=0. Explain that source selection is immutable per run and missing setup fails visibly.
4. Add traps to CLAUDE.md: virtual business time vs real operational time; no production data reuse;
   capture clock context through preview/commit/recompute; don't deadlock the recompute hook queue;
   don't re-date replay headers; dispose polling/listeners and reject stale revisions.
5. Review the whole branch for direct Date calls in event paths, credentials in fixtures/logs, unsafe
   recording paths, accidental live-feed starts, direct simulation collection permissions and any
   geolocation code. Intentional Date calls remain in the operational-time paths listed in the spec.
6. Run the final full gate once after the final code change. Record exact totals and manual acceptance
   status. If real recordings or phones are unavailable, state what remains unverified rather than
   marking the full milestone complete.
7. Commit docs on this branch. Merge/push/deploy only when requested; landing must be fast-forward,
   preserving linear main history. Deploying simulation never means rebuilding the live Compose stack.

**Commit:** `docs: record M4 simulation behavior and rehearsal evidence`.

## Plan preparation note

This document was prepared by inspecting the M3 source and tests at `72a32a5`. It does not claim any
M4 code, migration, command, fixture or test listed as Create already exists. The baseline's last
verified gate was 312 unit tests, 42 e2e tests, 37 hook tests and a clean Svelte/type check. Preparing
these Markdown documents does not rerun or substitute for M4's future implementation checks.
