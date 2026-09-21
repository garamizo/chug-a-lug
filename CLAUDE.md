# Working in this repo

## New work goes in a worktree

Start every new piece of work in its own git worktree, on its own branch — **including the design
spec and the implementation plan**, not just the code. The spec and plan are part of the work, so
they belong on the same branch as the change they describe; writing them on `main` means `main`
carries a plan for something that does not exist yet, and a change of direction leaves it stranded.

```bash
git worktree add .worktrees/m3-live -b feat/m3-live
cd .worktrees/m3-live
```

`.worktrees/` is git-ignored. The harness's worktree tooling may use `.claude/worktrees/` instead;
either is fine, both are ignored.

`main` is the trunk and its history is linear — no merge commits. Land work with a fast-forward:

```bash
git checkout main && git merge --ff-only feat/m3-live && git push origin main
git worktree remove .worktrees/m3-live && git branch -d feat/m3-live
```

## What a fresh worktree does not inherit

Everything below is git-ignored, so a new worktree starts without it:

- **`web/node_modules`** — run `npm install` in `web/` before any test or type check.
- **`.env` and `.secrets/`** — copy or symlink them from the main checkout. Without them Google
  Places and the Metra realtime feed are unconfigured, and the app degrades to "Timetable only".
- **`data/`** — the GTFS zip, the Places budget counters and `data/recordings/`. The GTFS zip
  re-downloads on first use; recordings do not, so point at the main checkout's copy if you need one.

## One test run at a time, across all worktrees

The harnesses bind fixed ports, so two worktrees cannot run them simultaneously:

- e2e (`npm run test:e2e`): **15173** for the web server, **18093** for its PocketBase.
- The production stack (`just up`): **8090** for PocketBase, **3000** for the web server.

Never point a dev or test server at 8090 or 3000 — that is the live stack on this machine.

## Deploying

`just up` runs `docker compose up -d --build`, which rebuilds the images from **whatever is on disk**,
committed or not. Production therefore tracks the working tree of the checkout you run it in, not
`origin/main`. Check freshness with `docker images | grep chug` against your last edit, never against
git. `pb_hooks/` and `pb_migrations/` are read-only bind mounts, so migrations apply on a PocketBase
restart without a rebuild.

## Traps worth knowing before you debug them

- **`pb_hooks/planning.pb.js` forces every new itinerary to `status: draft`**, superusers included.
  Locking one is an *update*, never a create — seeds and fixtures have to follow the same path.
- **PocketBase list rules filter, they do not reject.** An unauthorised read is `200` with zero rows,
  never `403`. Assert on the empty page, not the status code.
- **protobufjs serves absent fields from the prototype.** An omitted `end` reads as `Long(0)` and an
  omitted enum as its first value, so check `hasOwnProperty` before interpreting either. `finish()`
  returns a Node `Buffer` over a shared pool and `Buffer.slice()` does not copy — use
  `new Uint8Array(b).buffer` when you need the bytes alone.
- **The repo root has no `package.json`.** A script that imports a dependency has to live under
  `web/`, because Node resolves ESM imports from the importing file's location.
- **Times are UTC in the database and in every API payload.** Rendering to America/Chicago happens
  only through `$lib/time.ts`; "today" on the live day means Chicago's today (`todayInTz`).
- **The anchor drives two things at once**: `currentStop()`'s override and where `recomputeLegs`
  starts the remaining day. It is the newest admin `checkins` row. The live view only uses it on the
  event day, and `activeAnchor` applies the same Chicago-date gate to preview, commit and recompute.
  Off-day edits plan from `start_time`; converting an off-day anchor into event-day minutes wrecks
  the timetable. Change one path and check the others.
- **`ItineraryView` writes nothing itself.** It calls its `actions` prop: a draft passes
  `recordActions` for immediate writes, the locked-route editor stages changes, and only Save through
  `POST /api/plan/commit` persists those edits. Do not sneak a PocketBase write into a shared control.
- **Nothing may plan legs except `computeLegs`.** Preview, commit and recompute share it so a preview
  cannot disagree with a save. The Save gate and server also share `impossibleFromAnchor`: impossible
  legs behind the crew are history, not blockers.
- **Svelte `$state` values are proxies; IndexedDB cannot structured-clone them.** Mirror the raw
  PocketBase responses before assigning them into state, or storage can fail while the screen works.
- **Seeding stops fires the recompute hook.** The planner replaces seeded leg times with its own
  answer. A test clock based on the fixture's hand-written departure may be watching the wrong train.

## Conventions

- User-visible strings live only in `web/src/lib/labels.ts`. The README's UI glossary is the source
  of truth for the names.
- Tests are written before the code they cover, and each task ends with everything green:
  `cd web && npm test && npm run check && npm run test:e2e`, plus `bash scripts/test-hooks.sh`.
