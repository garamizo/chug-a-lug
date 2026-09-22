# Shared rehearsal implementation

Branch: feat/rehearsal-default; worktree: .worktrees/rehearsal-default.
Design: ../specs/2026-09-22-shared-rehearsal-design.md.

1. Add failing unit/Compose tests for default rehearsal startup and explicit live startup, isolated
   mounts, flags, local fixtures and ordinary login credentials; initialization must preserve runs.
2. Add regular startup script and rehearsal Compose overlay, automatic initialization and bundled
   bootstrap assets. Remove extra simulation lifecycle Just targets. Preserve the live data path.
3. Add pre-login/header rehearsal copy and home navigation, plus separate cookies for each mode;
   add browser coverage before UI changes.
4. Run unit/type/e2e/hook/simulation/offline gates sequentially and smoke the real Compose wiring on
   disposable test ports/data. Update README, operations and .env.example with the new default and
   the explicit live switch; record results and commit on this branch.

## Validation completed

- 551 unit tests, Svelte check (zero errors/warnings), 43 ordinary browser tests.
- Hook gate: 47 passed / 3 intentionally skipped, plus 3 lifecycle tests passed.
- 2 rehearsal browser tests and 1 production service-worker offline test passed.
- Disposable Compose build/start/bootstrap on 15173/18093 passed with dummy credentials.
  Crew and Conductor login, paused clock and computed train leg verified. A second initialization
  preserved the clock revision, logged drink and single itinerary. Resolved mounts all use
  rehearsal data; external provider credentials are blank. Smoke containers were removed.
- Merge main by fast-forward, push, deploy through regular just up, then verify shared rehearsal.
