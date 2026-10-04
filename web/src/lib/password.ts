import { getTokenPayload } from 'pocketbase';
import { copy } from '$lib/labels';

/** Mirrors pocketbase/pb_hooks/crew.js passwordProblem: 8–64 code points, at most 72 UTF-8 bytes. */
export function passwordProblem(p: unknown): string | null {
  if (typeof p !== 'string') return copy.passwordRule;
  const points = Array.from(p).length, bytes = new TextEncoder().encode(p).length;
  return points < 8 || points > 64 || bytes > 72 ? copy.passwordRule : null;
}

/** The address a password-reset token was issued for (PocketBase puts it in the `email` claim). */
export function resetTokenEmail(token: string): string | null {
  const email = getTokenPayload(token).email;
  return typeof email === 'string' && email.includes('@') ? email : null;
}
