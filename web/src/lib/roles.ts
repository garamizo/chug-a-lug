// Who rides tonight. A user's role is permanent until the Conductor changes it; an empty role reads
// as Crew. Only riders (Crew, the Conductor included) count toward the night's aggregates: Golden
// Spikes, milestones, the Closing Time reel and the Tab's crew count. Chat and Cheers are never filtered.

export type Role = 'crew' | 'trainspotter' | 'put_off';

export function roleOf(u: { role?: string | null } | null | undefined): Role {
  const role = u?.role;
  return role === 'trainspotter' || role === 'put_off' ? role : 'crew';
}

/** Trainspotters keep no Tab: the bar shows its button disabled and the sheet never opens. */
export function noTab(u: { role?: string | null } | null | undefined): boolean {
  return roleOf(u) === 'trainspotter';
}

/**
 * Whether a user id is a rider, by the roster. Unknown ids count as riders: a stale roster fails open
 * rather than silently emptying the night.
 */
export function riderFilter(roster: { id: string; role?: string | null }[]): (userId: string) => boolean {
  const out = new Set(roster.filter((u) => roleOf(u) !== 'crew').map((u) => u.id));
  return (userId) => !out.has(userId);
}

/** The riders' rows, in their order. */
export function ridersOnly<T extends { user: string }>(rows: T[], isRider: (id: string) => boolean): T[] {
  return rows.filter((r) => isRider(r.user));
}
