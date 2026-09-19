import type { Handle } from '@sveltejs/kit';
import { metra } from '$lib/server/metra';

// Warm the schedule at boot so the first planner request does not wait for Metra.
metra.getSchedule().catch((err) => console.error('[metra] initial schedule load failed:', (err as Error).message));

export const handle: Handle = ({ event, resolve }) => resolve(event);
