import { expect, type Page } from '@playwright/test';

const PB = process.env.PB_URL ?? 'http://127.0.0.1:18093';
const SU_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'tests@chugalug.invalid';
const SU_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'local-test-password-only';

export async function login(page: Page, name: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('name-input').fill(name);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('login').click();
  await expect(page.getByTestId('name')).toHaveText(name);
}

async function superuserToken(): Promise<string> {
  const res = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: SU_EMAIL, password: SU_PASSWORD })
  });
  if (!res.ok) throw new Error(`Superuser login failed: ${res.status}`);
  return (await res.json()).token;
}

const create = async (collection: string, body: unknown, token: string) => {
  const res = await fetch(`${PB}/api/collections/${collection}/records`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Create ${collection} failed: ${res.status} ${await res.text()}`);
  return res.json();
};

/** Removes every locked itinerary so one test's crawl cannot become another's. */
export async function clearLockedCrawls(): Promise<void> {
  const token = await superuserToken();
  const res = await fetch(`${PB}/api/collections/itineraries/records?perPage=200`, { headers: { Authorization: token } });
  for (const row of (await res.json()).items as { id: string }[]) {
    await fetch(`${PB}/api/collections/itineraries/records/${row.id}`, { method: 'DELETE', headers: { Authorization: token } });
  }
}

/**
 * Two stops on the BNSF with one train leg between them, locked and dated `eventDate`. Written as
 * superuser because `legs` is server-only. Returns the ids so a test can assert against them.
 */
export async function seedLockedCrawl(opts: {
  ownerName: string; eventDate: string; startTime: string; departAt: string; arriveAt: string;
  /** Adds a second bar at the first stop's station, joined by a walk: the same-station case. */
  extraVenueAtFirstStation?: boolean;
}) {
  const token = await superuserToken();
  const users = await fetch(`${PB}/api/collections/users/records?filter=${encodeURIComponent(`name_key="${opts.ownerName.toLowerCase()}"`)}`, {
    headers: { Authorization: token }
  });
  const owner = (await users.json()).items[0];
  if (!owner) throw new Error(`No user named ${opts.ownerName}; log in first so the identity exists.`);

  // The planning hook forces every new itinerary to `draft`, superuser included, so locking is only
  // reachable through an update — the same path the Highball takes in the app.
  const draft = await create('itineraries', {
    title: 'E2E Live Crawl', event_date: opts.eventDate,
    start_time: opts.startTime, vote_open: false, created_by: owner.id
  }, token);
  const lockRes = await fetch(`${PB}/api/collections/itineraries/records/${draft.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ status: 'locked' })
  });
  if (!lockRes.ok) throw new Error(`Lock itinerary failed: ${lockRes.status} ${await lockRes.text()}`);
  const itinerary = await lockRes.json();

  const first = await create('stops', {
    itinerary: itinerary.id, order: 1, name: 'The Whistle Stop', kind: 'bar',
    station_id: 'LAGRANGE', station_name: 'La Grange Road', dwell_min: 90, walk_min: 5, direction: 'out'
  }, token);
  // Optionally a second bar at the SAME station, reached on foot, before the train leaves.
  const middle = opts.extraVenueAtFirstStation ? await create('stops', {
    itinerary: itinerary.id, order: 2, name: 'The Second Round', kind: 'bar',
    station_id: 'LAGRANGE', station_name: 'La Grange Road', dwell_min: 45, walk_min: 5, direction: 'out'
  }, token) : null;

  const second = await create('stops', {
    itinerary: itinerary.id, order: middle ? 3 : 2, name: 'Berwyn Beer Hall', kind: 'bar',
    station_id: 'CUS', station_name: 'Union Station', dwell_min: 60, walk_min: 4, direction: 'out'
  }, token);

  if (middle) {
    await create('legs', {
      itinerary: itinerary.id, from_stop: first.id, to_stop: middle.id, kind: 'walk',
      ready_at: opts.departAt, depart_at: '2026-12-26T20:10:00.000Z', arrive_at: '2026-12-26T20:15:00.000Z',
      segments: [], computed_at: opts.departAt
    }, token);
  }
  await create('legs', {
    itinerary: itinerary.id, from_stop: (middle ?? first).id, to_stop: second.id, kind: 'train',
    ready_at: opts.departAt, depart_at: opts.departAt, arrive_at: opts.arriveAt,
    segments: [], computed_at: opts.departAt
  }, token);

  return { itineraryId: itinerary.id, firstStopId: first.id, middleStopId: middle?.id ?? null, secondStopId: second.id };
}

/** The newest Conductor position for the crawl, so a test can assert what a save wrote. */
export async function latestAnchor(): Promise<{ stop: string; at: string } | null> {
  const token = await superuserToken();
  const res = await fetch(`${PB}/api/collections/checkins/records?sort=-at&perPage=1`, { headers: { Authorization: token } });
  const items = (await res.json()).items as { stop: string; at: string }[];
  return items[0] ?? null;
}
