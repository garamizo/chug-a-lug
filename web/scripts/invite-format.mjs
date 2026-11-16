// What `just invite` prints. Pure, so it is tested without a server. Times show in Chicago.
/** @param {string} iso */
const when = (iso) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
}).format(new Date(iso));

/**
 * @param {string} action
 * @param {any} answer
 * @returns {string}
 */
export function formatInvite(action, answer) {
  if (action === 'create') return `${answer.url}\n${answer.seats} seats, until ${when(answer.expires_at)}`;
  if (action === 'revoke') return answer.revoked ? 'Revoked.' : 'No link to revoke.';
  switch (answer.state) {
    case 'active': return `${answer.seats_left} of ${answer.seats} seats left, until ${when(answer.expires_at)}`;
    case 'expired': return 'The join link expired.';
    case 'full': return 'The join link is full.';
    case 'revoked': return 'The join link was revoked.';
    default: return 'No join link yet. Run just invite <seats>.';
  }
}

/**
 * What `just invite` prints when PocketBase refuses. The route answers 404 to a wrong or missing
 * secret, so a 404 says where to look.
 * @param {number} status
 * @param {any} answer
 * @returns {string}
 */
export function formatInviteError(status, answer) {
  if (status === 404) return 'Not found. Check INTERNAL_SECRET in .env and that the stack is running (just up).';
  return answer?.message ?? `Request failed: ${status}`;
}
