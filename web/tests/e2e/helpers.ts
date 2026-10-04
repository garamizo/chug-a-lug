import { expect, type Page } from '@playwright/test';

export const PB = process.env.PB_URL ?? 'http://127.0.0.1:18093';
const SU_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'tests@chugalug.invalid';
const SU_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'local-test-password-only';

/** Escapes regex metacharacters so a name can anchor an exact `hasText` match. */
function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const BASE = 'http://127.0.0.1:15173';
const COOKIE = process.env.PUBLIC_SIM === '1' ? 'pb_auth_rehearsal' : 'pb_auth';

/** Superuser find-or-create plus impersonation: a real session without the sign-in UI. */
export async function sessionFor(name: string, admin = false): Promise<{ token: string; record: Record<string, unknown> }> {
  const su = await superuserToken();
  const display = name.trim().replace(/\s+/g, ' '), key = display.toLowerCase();
  const query = new URLSearchParams({ filter: `name_key=${JSON.stringify(key)}` });
  let user = (await (await fetch(`${PB}/api/collections/users/records?${query}`, { headers: { Authorization: su } })).json()).items?.[0];
  if (!user) user = await create('users', { name: display, name_key: key, email: `${Buffer.from(key).toString('hex')}@test.invalid`,
    verified: true, is_admin: admin, password: 'seed-test-password-1', passwordConfirm: 'seed-test-password-1' }, su);
  else if (admin && !user.is_admin) await fetch(`${PB}/api/collections/users/records/${user.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: su }, body: JSON.stringify({ is_admin: true }) });
  // 400 days: several specs move the browser clock to December 2026, past a 30-day token.
  const res = await fetch(`${PB}/api/collections/users/impersonate/${user.id}`, {
    method: 'POST', headers: { Authorization: su, 'content-type': 'application/json' }, body: JSON.stringify({ duration: 400 * 86400 }) });
  if (!res.ok) throw new Error(`Impersonate failed: ${res.status}`);
  return res.json();
}

/**
 * Signs `name` in by cookie and opens nothing: open the page you want next. The app reads the cookie
 * once, at boot (`CookieAuthStore`), so a page that already runs the app is reloaded to pick it up.
 */
export async function login(page: Page, name: string, password: string) {
  const { token, record } = await sessionFor(name, password === ADMIN);
  await page.context().addCookies([{ name: COOKIE, value: encodeURIComponent(JSON.stringify({ token, record })), url: BASE }]);
  if (page.url() !== 'about:blank') await page.reload();
}

/**
 * Opens `/` as a signed-in user and waits for it to settle. On the event day the tab bar can render on
 * `/` for the instant before the home page's own effect redirects to `/live`, so a check-then-assert
 * loses that race: accept whichever lands durably, the exact name on the home screen (an anchored
 * match, so one crew member's name can't satisfy another's) or the tab bar.
 */
export async function openHome(page: Page, name: string) {
  await page.goto('/');
  const nameShown = page.getByTestId('name').filter({ hasText: exactly(name) });
  const tabBarShown = page.getByTestId('tab-bar');
  await expect(nameShown.or(tabBarShown).first()).toBeVisible();
}

let superuser: Promise<string> | undefined;
/** One superuser login per worker: every helper needs it, and each login is a bcrypt check. */
export function superuserToken(): Promise<string> {
  superuser ??= (async () => {
    const res = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: SU_EMAIL, password: SU_PASSWORD })
    });
    if (!res.ok) throw new Error(`Superuser login failed: ${res.status}`);
    return (await res.json()).token as string;
  })();
  superuser.catch(() => { superuser = undefined; });
  return superuser;
}

async function create(collection: string, body: unknown, token: string) {
  const res = await fetch(`${PB}/api/collections/${collection}/records`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Create ${collection} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Removes every itinerary, drafts included, so one test's route cannot become another's. */
export async function clearRoutes(): Promise<void> {
  const token = await superuserToken();
  const res = await fetch(`${PB}/api/collections/itineraries/records?perPage=200&fields=id`, { headers: { Authorization: token } });
  await Promise.all(((await res.json()).items as { id: string }[]).map((row) =>
    fetch(`${PB}/api/collections/itineraries/records/${row.id}`, { method: 'DELETE', headers: { Authorization: token } })));
}

/**
 * Two stops on the BNSF with one train leg between them, locked and dated `eventDate`. Written as
 * superuser because `legs` is server-only. Returns the ids so a test can assert against them.
 */
export async function seedLockedCrawl(opts: {
  ownerName: string; eventDate: string; startTime: string; departAt: string; arriveAt: string;
  /** Adds a second bar at the first stop's station, joined by a walk: the same-station case. */
  extraVenueAtFirstStation?: boolean;
  /** Names the first bar, so two seeded routes can be told apart on screen. */
  firstStopName?: string;
  /** Boards at another station: the planner then opens the route with a ride to the first stop. */
  startStation?: { id: string; name: string };
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
    title: `E2E Live Crawl ${Math.random().toString(36).slice(2, 8)}`, event_date: opts.eventDate,
    start_time: opts.startTime, vote_open: false, created_by: owner.id
  }, token);
  const lockRes = await fetch(`${PB}/api/collections/itineraries/records/${draft.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ status: 'locked', ...(opts.startStation ? { start_station: opts.startStation.id, start_station_name: opts.startStation.name } : {}) })
  });
  if (!lockRes.ok) throw new Error(`Lock itinerary failed: ${lockRes.status} ${await lockRes.text()}`);
  const itinerary = await lockRes.json();

  const first = await create('stops', {
    itinerary: itinerary.id, order: 1, name: opts.firstStopName ?? 'The Whistle Stop', kind: 'bar',
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
export async function latestAnchor(itineraryId?: string): Promise<{ stop: string; at: string } | null> {
  const token = await superuserToken();
  const only = itineraryId ? `&filter=${encodeURIComponent(`stop.itinerary="${itineraryId}"`)}` : '';
  const res = await fetch(`${PB}/api/collections/checkins/records?sort=-at&perPage=1${only}`, { headers: { Authorization: token } });
  const items = (await res.json()).items as { stop: string; at: string }[];
  return items[0] ?? null;
}

/**
 * Deletes a stop directly, bypassing the app entirely — simulates another Conductor's edit landing
 * while this one's editor is open, so a test can force the commit endpoint's `409 stale` path.
 */
export async function deleteStopDirect(stopId: string): Promise<void> {
  const token = await superuserToken();
  const res = await fetch(`${PB}/api/collections/stops/records/${stopId}`, { method: 'DELETE', headers: { Authorization: token } });
  if (!res.ok) throw new Error(`Delete stop failed: ${res.status} ${await res.text()}`);
}

/** The Tab lives in a sheet over Live, opened from the tab bar. */
export async function openTab(page: Page): Promise<void> {
  if (await page.getByTestId('tab-sheet').isVisible()) return;
  await page.getByTestId('tab-drinks').click();
  await page.getByTestId('tab-sheet').waitFor();
}

const MAIL = process.env.MAIL_SINK_URL ?? 'http://127.0.0.1:12526';
export async function clearMails() { await fetch(`${MAIL}/messages`, { method: 'DELETE' }); }
export async function codeFor(to: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const all = (await (await fetch(`${MAIL}/messages`)).json()) as { to: string[]; text: string }[];
    const code = all.filter((m) => m.to.includes(to.toLowerCase())).map((m) => /\b(\d{6})\b/.exec(m.text)?.[1]).filter(Boolean).at(-1);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No code mailed to ${to}`);
}
export async function resetLinkFor(to: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const all = (await (await fetch(`${MAIL}/messages`)).json()) as { to: string[]; text: string; html?: string }[];
    // The text part renders links as [url](url): keep the match out of the brackets.
    const url = all.filter((m) => m.to.includes(to.toLowerCase())).map((m) => /(https?:\/\/[^\s"<>()\[\]]+\/reset-password#[\w.-]+)/.exec(`${m.text}\n${m.html ?? ''}`)?.[1]).filter(Boolean).at(-1);
    if (url) return url;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No reset link mailed to ${to}`);
}
/** Turnstile without the network: the widget script is replaced by one that passes at once. */
export async function stubTurnstile(page: Page) {
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({ contentType: 'text/javascript',
    body: "(function(){var n=0,cb=null;function fresh(){setTimeout(function(){cb('ok-e2e-'+Date.now()+'-'+(++n))})}" +
      "window.turnstile={render:function(el,o){cb=o.callback;fresh();return 'w'},reset:function(){fresh()},remove:function(){}}})();" }));
}
