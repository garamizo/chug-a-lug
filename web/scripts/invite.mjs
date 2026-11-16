// `just invite|invite-status|invite-revoke`: asks the running PocketBase on this host (the route
// refuses anything that came through the tunnel) and prints the answer. Node built-ins only.
import { formatInvite, formatInviteError } from './invite-format.mjs';

const [action, seats, days] = process.argv.slice(2);
if (!['create', 'status', 'revoke'].includes(action)) {
  console.error('Usage: invite.mjs <create|status|revoke> [seats] [days]');
  process.exit(1);
}
const body = { action };
if (action === 'create') {
  body.seats = Number(seats);
  if (days !== undefined && days !== '') body.days = Number(days);
}
try {
  const res = await fetch(`${process.env.PB_HOST_URL ?? 'http://127.0.0.1:8090'}/api/crawl/invite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET ?? '' },
    body: JSON.stringify(body)
  });
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(formatInviteError(res.status, answer));
    process.exit(1);
  }
  console.log(formatInvite(action, answer));
} catch (error) {
  console.error(`Could not reach PocketBase: ${error.message}`);
  process.exit(1);
}
