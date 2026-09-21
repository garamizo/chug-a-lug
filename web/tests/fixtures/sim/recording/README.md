# Deterministic December 26 recording

Regenerate from the repository root with `just sim-fixture` (Node 22.18+). The generator copies
`../../gtfs.zip` unchanged and generates protobufs with `gtfs-realtime-bindings`. Regeneration must
leave `git diff --exit-code -- web/tests/fixtures/sim/recording` clean.

The original Chicago service date is 2026-12-26. The playback window is 18:20Z through 00:10Z the
next UTC day. Trip `startDate` stays `20261226`; no timestamps are rebased. Positions describe a
synthetic train, never a person's GPS location. There are no credentials or real identities.

Expected generated files:

- `schedule.zip`, `manifest.json`, `polls.ndjson`
- `1798309200.alerts.pb`, `1798309200.tripupdates.pb`
- `1798309260.positions.pb`, `1798309260.tripupdates.pb`
- `1798309320.tripupdates.pb`, `1798329570.alerts.pb`

Scenarios:

- 18:20: BN1 departs CUS at 18:33Z; positions are missing. The initial alert expires at 18:21:30Z.
- 18:20:30: unchanged successful trip-update/alert polls reference the earlier snapshot.
- 18:21: BN1 is delayed five minutes; the first position arrives.
- 18:22: BN3 is canceled; positions stop succeeding independently of the other feeds.
- 18:24: positions are stale while trip updates and alerts are still successfully polled.
- 18:25: trip updates also fail, while alerts continue successfully.
- 23:59:30 and 00:00:00: an open-ended alert spans UTC midnight. Its absent end field must stay
  absent. The midnight trip-update poll successfully references the older cancellation snapshot.

The deliberately long gap and ten-minute tail provide stale-data cases for replay. CUS's trip-update
arrival is absent, as is the canceled trip's stop-update list. Tests inspect own properties to avoid
protobufjs prototype defaults turning an absent field into zero.
