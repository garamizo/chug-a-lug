# Approved authentication UI

Implements the approved `/auth-preview` proposal from `design/auth-ui-proposal` in the real app.
Use a shared 480px dark card, Google first, email divider, gold primary action, inset password
visibility toggle, plain Sign in / Sign up navigation and explicit crew approval copy. The
prototype stays in its own worktree; no preview controls ship with this change.

## Flows

- `/login`: existing password sign-in and rehearsal credentials remain. Passwordless sign-in
  is a full-width alternative. With an email already entered it sends immediately; otherwise
  it opens an email-only form. The code screen supports actual resend, confirmation feedback,
  change email, password fallback and Google when enabled. Disable competing actions in flight.
- `/join`: email sign-up still needs a name, password, server-verified Turnstile and crew approval.
  Explain verification and approval upfront. Code entry offers email correction, actual resend,
  Google and sign-in navigation. Waiting, approved, declined, expired and offline states share
  the card and always have an exit. Restore name/email from the saved request, never passwords.
- Email correction calls a secret-authorized cancellation endpoint for the old unverified
  request, then returns to the form retaining in-memory values. Cancel is transactional,
  idempotent for expired requests, identical for decoys, and refuses waiting/decided requests.
  Clear password/code hashes on cancellation. Existing hourly limits remain unchanged.
  Increment the UI epoch before cancellation so stale polls cannot resurrect the old request.
- Google signup starts without a name. After the state-checked Google return, collect the crew
  name before exchanging the one-use OAuth code and filing the request. No token, user or
  provider link is created before the existing server checks. Do not claim the identity is
  verified until the exchange completes. Codes live only in memory; scrub the callback URL and
  session state. A lost/expired/consumed code offers a new Google attempt, preserving the name
  in the new OAuth state. Login callbacks still exchange immediately.
- `/login/forgot` and `/reset-password`: matching card, neutral reset confirmation, change email,
  clear back links. Preserve reset token scrubbing, account-enumeration protections and errors.
- Turnstile: load errors, widget errors, expiration, timeouts and absent configuration yield a
  visible retry path. Guard late callbacks and dispose scripts/widgets/timers. Use a compact
  widget on narrow screens. The submit button keeps its action label; check status is separate.

All user-facing frontend copy lives in `labels.ts`. Update the README glossary for approved
plain-language authentication navigation. Backend approval/security logic stays authoritative.

Turnstile callback reference: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/

## Verification

Write tests first for cancellation authorization, decoy parity and verify/cancel races; browser
coverage for correction, stale polls, actual resend, callback name collection/state rejection,
and human-check recovery. Cover every new page state in the phone layout sweep. Run unit, type,
browser and hook suites sequentially. Inspect phone/desktop and rehearsal login. No deployment
or production database writes are part of implementation.

## Review refinements

A saved request starts in a neutral “Checking your request” state. Only a successful status
response may show email verification and approval progress. Connection loss keeps the request
and offers retry; background polling continues.

Focus follows a single owner in the shared card: transitions to forms focus the relevant enabled
field, and transitions to informational screens focus the heading. Busy actions defer that move.

Google callback outcomes are saved even when SPA navigation has removed the callback screen.
Only navigation and component updates require an active callback. A separate, nonsecret retry
hint retains signup/login intent and the typed crew name for 30 minutes. It never authorizes an
exchange: fresh consent supplies fresh state, code and verifier after a reload.

Email correction cannot reset the mail allowance. Resends retain the three-per-request cap and
also share a rolling three-per-hour budget across request IDs for each normalized address.
Both real and decoy requests consume that budget atomically with their resend update.
