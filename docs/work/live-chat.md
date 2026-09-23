# Compact live controls and crew chat

Keep the rehearsal header to three short lines, with synchronization beside playback state. Reduce ticket padding, typography and duplicate information while preserving departure/arrival, countdown and walking cues. Display the current venue immediately below it.

Replace the inline Tab and upload controls with three icon actions: cup opens a native modal with personal counters and Undo; photo opens a native file picker with image/video support and an explicit camera alternative; speaker opens the existing Conductor Bulletin composer. Preserve existing Conductor-only Bulletin permissions. Crew activity appears in a shared chronological chat at the bottom: route-wide Tab entries and Bulletins, with author, venue and event timestamp. Undo removes its activity. Scope reads and subscriptions to the current route/run, discard late results, and clean up on navigation/logout.

Rename Still to come to Next stops. Cover chat ordering and live cross-session updates before implementation, update existing interaction tests for the modal, run all required checks plus simulation checks, then deploy from main.
