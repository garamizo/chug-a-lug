import type { Handle } from '@sveltejs/kit';
import { metra } from '$lib/server/metra';

// Warm the schedule at boot so the first planner request does not wait for Metra.
metra.getSchedule().catch((err) => console.error('[metra] initial schedule load failed:', (err as Error).message));

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  // HSTS is Cloudflare's job (OPERATIONS.md checklist), so a typo here cannot pin a broken policy.
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  return response;
};
