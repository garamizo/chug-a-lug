# Shared rehearsal through regular startup

User decision: the regular app opens in rehearsal mode by default until the operator switches to the
real event. No separate rehearsal command or user mode chooser. Rehearsal must be unmistakable.

`just up` selects rehearsal by default (`REHEARSAL=1`), starts the normal Compose project and public
origins with an overlay, and automatically initializes the checked-in recorded scenario. It reuses
the configured shared Crew/Conductor passwords so existing participants can sign in with their names.
The rehearsal has its own PocketBase database/uploads and cache under `data/rehearsal/`; production
`data/pb_data` and caches are preserved. No production records are copied. Simulation APIs remain
Conductor controlled; Crew can practice ordinary UI actions. Authentication cookies distinguish
rehearsal from live so switching databases cannot reuse an unrelated identity token.

Initialization runs as a one-shot container after web/PocketBase startup. It stamps the clock before
any itinerary hooks, seeds a route, explicitly recomputes it and verifies persisted legs. A durable
marker prevents reseeding on `just up`. Initialization failure never deletes data or replaces an
existing run. Existing runs preserve their clock and all practice actions. Live selection is explicit
`REHEARSAL=0 just up`; base Compose pins simulation off. Rehearsal overrides both services and the
web build consistently, uses the local recorded feed and disables external feed/Places calls.

The header identifies rehearsal even before login. Login explains shared practice and usual passwords.
Signed-in status explicitly says rehearsal and retains the synchronized simulated clock/source.
The home page links directly to the live rehearsal screen. Public origins/ports and role permissions
stay the same. Existing advanced launcher scripts remain testable, but the extra sim start/status/stop
Just targets are removed in favor of the regular up/logs/down lifecycle.

Validation: tests for startup mode selection, Compose data/credential/network configuration, fresh
seed vs preserved run and failed initialization; browser checks for pre-login and sticky signed-in
notices and the home live entry. Run all ordinary and simulation gates sequentially. Build and smoke
check the Compose overlay only on isolated test ports/project/data. Do not test against live ports or
copy production credentials into test configuration. After validation, fast-forward main and deploy under the user’s existing merge/deploy instruction.
