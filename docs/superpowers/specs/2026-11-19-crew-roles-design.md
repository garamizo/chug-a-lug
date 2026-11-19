# Crew roles: Crew, Trainspotter, Put off

Date: 2026-11-19 · Branch `feat/crew-roles`

## Why

The Conductor needs two things the app cannot do today:

1. **Remove someone** for good: they can no longer sign in, they disappear from the Crew Board for
   everyone else, they win no Golden Spikes and they do not appear in Closing Time — yet what they
   left behind (planner comments, photos, chat messages, routes they built) stays where it is.
2. **Sign people up who are not riding** ("Trainspotters"): they help plan (build routes, Cheers /
   Pass), follow the night from home and watch Closing Time, but they are not part of the night's
   score — no Tab, no Golden Spikes, not in the reel.

Today the only lever is **Put off / Let back on** on the Manifest, which blocks sign-in and nothing
else: a put-off person still shows on the Crew Board and still counts for Spikes and the reel.

## Decisions taken with the user

- A person's role is **permanent** (one value per person, not per route). The current role applies
  to every night, past ones included, when the board, Spikes or reel are worked out.
- Roles: **Conductor, Crew, Trainspotter, Put off**. "Excluded" is named **Put off** (the app's
  existing word); "Observer" is named **Trainspotter**.
- **Exactly one Conductor**: the account named by `CONDUCTOR_EMAIL`. Nobody can be made Conductor
  and the Conductor cannot be changed from the UI. The role window offers only Crew / Trainspotter /
  Put off, and only for people other than the Conductor.
- On the **Crew Board**, the Conductor taps a name to open a modal (the **role window**) and picks
  the role.
- Trainspotters see the 🍻 Tab button **disabled**.
- Approach **A** (below).

## Approaches

- **A. One `role` field on `users`, phones filter by role (chosen).** The server enforces the two
  hard rules (Put off cannot sign in; Trainspotter cannot log a drink). Board, Spikes, reel,
  and milestones filter by role on the phone, which is where they are computed
  today. Authors keep their names on old posts because user records stay readable.
- B. Hide put-off users at the server (users list/view rule). Stricter, but every `expand: 'user'`
  of their comments, photos and messages would come back empty and render as "Crew" — against
  "keep comments, photos".
- C. Keep `blocked` and add a separate `trainspotter` flag. Least migration, but two flags can
  contradict and every reader must decide which wins.

## Design

### Data

- `users.role`: select, one of `crew | trainspotter | put_off`, not required. **Empty reads as
  `crew`** everywhere (one helper on each side: `pb_hooks/crew.js roleOf(record)`,
  `web/src/lib/roles.ts roleOf(user)`), so join, rehearsal login, `ensureConductor` and existing
  test fixtures keep working without setting it. (Builder's call to make it required instead if
  every creation path is updated.)
- New sign-ups (join link) get an empty role, i.e. Crew; a Trainspotter is set afterwards from the
  role window. The join flow is unchanged.
- `users.is_admin` stays as the Conductor marker; every existing `@request.auth.is_admin = true`
  rule is untouched. The Conductor's role is `crew` (they ride).
- `users.blocked` is **removed**. Migration: `role = 'put_off'` where `blocked`, else `'crew'`;
  then drop the field. Down migration restores `blocked` from `role = 'put_off'` and drops `role`.
- `users.updateRule`: the migration replaces the `@request.body.blocked:isset = false` clause
  (added by `1758900000_crew_access.js`) with `@request.body.role:isset = false`, keeping every other
  clause and order; the down migration does the reverse. Nobody changes their own role through the
  records API, and ordinary self-updates (share_position, home_station, left_early) still work.
- `access_log.event` gains `role_changed`. Existing `put_off` / `let_back_on` stay and are still
  written when a change enters or leaves `put_off`; `role_changed` covers crew ↔ trainspotter.
  `detail` records `from → to`.

### Server (PocketBase hooks)

- Every `getBool('blocked')` becomes `crew.isPutOff(record)` (`roleOf(r) === 'put_off'`):
  `signInGuard`, `onRecordAuthRefreshRequest`, password-reset request/send/confirm, the users update
  hook (its fresh-read field list swaps `blocked` for `role`), `/api/crawl/me`, `isConductor` in
  `access.js`, `ensureConductor` (sets `role = 'crew'` instead of `blocked = false`), and the
  `config.pb.js` guard (checks for the `role` field instead of `blocked`).
- The "any route that puts someone off ends their sessions" `onRecordUpdate` hook fires when `role`
  becomes `put_off` (admin UI included).
- **`POST /api/crawl/users/{id}/role`** with body `{ role }` replaces `put-off` / `let-back-on`.
  Conductor only (403); refuses `id` = caller (400), a target with `is_admin` (400), an unknown role
  (400), a missing user (404). Inside one transaction on a fresh read: set role; on entering
  `put_off`, `refreshTokenKey()`. Then log as above. Returns `{ role }`. The two old routes are
  removed (the Manifest is their only caller).
- `/api/crawl/manifest` returns `role` instead of `blocked`.
- **Trainspotters cannot log a drink.** The `media` create-request hook refuses a create with a
  `drink_kind` from a trainspotter with `BadRequestError('trainspotter')`, matching the existing
  proof refusals' code style (`proof_needs_stop`, `proof_locked`); the client maps the code to its
  label. Plain photos and chat messages stay allowed. Drinks have
  `createRule = null` already, so the proof photo is the only path.
- **One Conductor, reconciled at startup.** `ensureConductor` (run by `config.pb.js` on every
  start) also clears `is_admin` on every other user when `SIM !== '1'`, logging `role_changed` with
  detail `Conductor → Crew` for each. Changing `CONDUCTOR_EMAIL` therefore moves the Conductor rather
  than adding one. Rehearsal stacks (`SIM=1`) keep today's behaviour: their login may mint extra
  admins, and nothing is demoted there.

### Who counts: riders

A **rider** is a user whose role is `crew` (the Conductor included). Night aggregates count riders
only:

- **Golden Spikes** (`spikes()`), **milestones** (`milestones()`, computed in `CrewChat.svelte`
  from `liveDay.feed`), the **Closing Time reel** (`buildReel`: photos, top message, drink counts,
  finale), the **Crew Board** score and its own Spikes replay, and the Tab sheet's crew count at the
  current stop (`tally()` in `tab.ts`) — my call, so every number of the night agrees.
- Filtering happens on the input rows (drinks, media, messages) before these pure functions run, by
  one shared helper, e.g. `ridersOnly(rows, roster)`. The functions themselves stay role-agnostic.
- `liveDay` already subscribes to `users` (`day.svelte.ts`); it gains a **roster** (`users` list: id, name, role, is_admin), read in the same
  `loadFeed` round as drinks/media/messages and published with them, and reloaded on a `users`
  subscription event. It lives **in memory only** (there is no feed mirror to follow: `offline.ts`
  persists only the route, stops and legs). A failed roster read keeps the last roster and never
  discards an otherwise good feed read. `spikeEvents` and the reel input are filtered through it.
  The Crew Board filters the same way with the users it already loads.
- **Unknown user ids count as riders** (a user missing from a loaded roster): failing open means a
  stale roster never silently empties the night.
- **Closing Time waits for the roster.** `reelReady` additionally requires a roster read accepted in
  the qualifying read (`closingRead`) or any later one (`rosterOk >= closingRead`), so the reel
  snapshot is never built from a feed with no roster. Without it the reel stays not-ready (it retries
  with the feed's normal reload), rather than opening with unfiltered rows. A reel already playing
  keeps its snapshot; a role change shows the next time the reel is built.
- **Celebrations wait for the roster too.** A phone queues no Golden Spike celebration before its
  first roster read is accepted (`rosterOk > 0`): until then unknown ids count as riders, so a
  trainspotter could be celebrated and the real winner's card marked seen.
- Chat itself is not filtered: trainspotters and put-off people's old messages and photos stay in
  Crew chat and the Roundhouse with their authors' names. Only the reel and the aggregates skip them.
- Reactions (Cheers) are not filtered: a trainspotter's Cheers still counts toward what the reel
  picks.

### UI

**Crew Board (`/crew`)**

- Riders ranked as today. Below them a **Trainspotters** heading listing trainspotters by name, no
  drink counts, no laurel (the Bulletin seen marker still shows).
- Put-off people: hidden for everyone except the Conductor, who sees them in a dimmed **Put off**
  section at the bottom.
- For the Conductor only, every name except their own is a button opening the **role window**.
  Others see plain names.

**Role window** (modal, shared component)

- Title: the person's name. Three choices: Crew, Trainspotter, Put off, with a one-line hint each
  (e.g. Trainspotter: "Plans routes and follows along; no Tab, no Golden Spikes"; Put off: "Can't
  sign in; hidden from the Crew Board. What they posted stays."). Current role pre-selected.
- Choosing Put off asks once for confirmation (it signs them out everywhere).
- Save calls `/api/crawl/users/{id}/role`; errors show inline. The component takes an
  `onsaved(role)` callback: the Crew Board relies on its `users` subscription (the callback may
  reload early), the Manifest calls its `load()` so the role and the access log both refresh.

**Manifest (`/crew/access`)**

- Status shows the role label instead of Aboard / Put off. The Put off / Let back on button is
  replaced by a button that opens the same role window.

**Tab**

- For a trainspotter, the tab bar's 🍻 Tab button is `disabled` with an accessible hint
  ("Trainspotters don't run a Tab"). `TabHost` never opens its sheet for them.
- The role comes from `$auth.user`, refreshed by `/api/crawl/me` on app open. A role change while
  the app is open takes effect on next open; the server refuses a drink meanwhile. That refusal is
  **final**: the send is dropped with its message and no Retry is kept, so a stale session cannot
  leave `ui.tabBusy` set and hold up Closing Time.

**Highball (`ApprovalPanel`)**

- Votes are **for the Conductor's reference only**; nobody is expected to vote (user decision). The
  tally's third row (`…`, everyone who has not voted, today `pending` in `ApprovalPanel.svelte`) is
  **removed**, and with it the panel's `users` read. Go / No go names stay. Anyone signed in may
  vote, Trainspotters included; put-off people cannot sign in, and their past votes stay listed.
- `approvalIntro` loses "When the crew says go": e.g. "The Conductor opens the vote and locks the
  route. Votes are a show of hands, not a gate." (exact copy in `labels.ts`).

### Labels and docs

- All new strings in `web/src/lib/labels.ts`: role names, hints, section headings, the role window
  title/buttons, the disabled-Tab hint, the confirmation.
- README UI glossary: add **Trainspotter**, **Role window**, and update **Put off / Let back on**
  (now a role, set from the role window; Let back on = back to Crew).

## Goals, non-goals, anti-goals

- Goals: the four behaviours above, enforced on the server where they are about access (sign-in,
  drinks) and consistent across every phone where they are about scoring.
- Non-goals: per-route roles; more than one Conductor; transferring the Conductor; hiding
  put-off people's past posts; a role for anonymous viewers.
- Anti-goals: losing anyone's comments, photos or routes; breaking author names on old posts; a
  role change that silently reverts on restart (hence the fixed Conductor); a missing roster
  emptying the board or the reel.

## Testing

Tests first, per repo convention.

- Hooks (`scripts/test-hooks.sh`): migration (blocked → role both ways, including the resulting
  `users.updateRule` and an ordinary self-update afterwards); startup with two admins demotes the
  one not named by `CONDUCTOR_EMAIL` (not under `SIM=1`); role endpoint guards
  (non-Conductor, self, Conductor target, bad role, 404) and token death on Put off; put-off
  sign-in / refresh / reset refused as today; self role change through the records API refused;
  trainspotter proof photo refused, plain photo and chat allowed; `ensureConductor` with `role`.
- Unit: `roleOf` (empty → crew); `ridersOnly` (unknown ids kept); Spikes / reel / milestones fed
  filtered rows exclude a trainspotter and a put-off person; `reelReady` false until the roster arrives, and a
  roster read failure keeping the feed.
- e2e: saving from the Manifest refreshes its status and log; Conductor opens the role window from the Crew Board and makes someone a Trainspotter (they
  move under the heading) and Put off (gone for others, dimmed for the Conductor); a trainspotter's
  Tab button is disabled. `layoutSweep.spec.ts` gets one line for the open role window.

## Left to the builder

- Exact copy for hints and messages (kept in `labels.ts`).
- Whether the role window is a native `<dialog>` or the app's existing sheet pattern — match what
  the app already uses.
