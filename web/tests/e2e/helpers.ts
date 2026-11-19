import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import type { Role } from '../../src/lib/roles';

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

/** Sets a user's role as superuser, the admin UI's path: no access-log row, no Conductor check. */
export async function setRole(id: string, role: Role): Promise<void> {
  const res = await fetch(`${PB}/api/collections/users/records/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: await superuserToken() }, body: JSON.stringify({ role }) });
  if (!res.ok) throw new Error(`Set role failed: ${res.status} ${await res.text()}`);
}

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
  await Promise.all(((await res.json()).items as { id: string }[]).map(async (row) => {
    const del = await fetch(`${PB}/api/collections/itineraries/records/${row.id}`, { method: 'DELETE', headers: { Authorization: token } });
    // A route that survives could become the next test's current route.
    if (!del.ok && del.status !== 404) throw new Error(`Delete itinerary ${row.id} failed: ${del.status}`);
  }));
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

/** A real 16x12 JPEG: the photo every Tab tap now has to send. */
export const PROOF_JPEG = { name: 'proof.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/proof.jpg', import.meta.url)) };

/** A Tab tap opens the camera; this answers it with the fixture photo. Nothing counts until it lands. */
export async function tapDrink(page: Page, kind: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(`drink-${kind}`).click();
  await (await chooser).setFiles(PROOF_JPEG);
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
export const CREDIT_PUBLISHED = '11/14/26 02:20:03 AM America/Chicago';
/** Answers /api/metra/status as the live stack would (the test stack's `file:` timetable never gives the
 *  Metra credit a date). With `hold`, every answer waits for that promise. `liveDay` reads the same
 *  endpoint for the board's mode; `schedule_only` with no fetch time is what the test stack and a
 *  practice day report anyway. `requested()` / `answered()` count requests seen and answers delivered. */
export async function stubLiveStatus(page: Page, opts: { hold?: Promise<void> } = {}) {
  let requested = 0, answered = 0;
  const feed = { fetchedAt: null, ageSec: null, mode: 'schedule_only' };
  await page.route('**/api/metra/status', async (r) => {
    requested++;
    if (opts.hold) await opts.hold;
    await r.fulfill({ json: { source: 'live', revision: null, staticPublishedAt: CREDIT_PUBLISHED, staticSource: 'download',
      rtFetchedAt: null, rtAgeSec: null, mode: 'schedule_only', feeds: { positions: feed, tripupdates: feed, alerts: feed } } })
      .then(() => { answered++; }, () => {});   // the page may have moved on
  });
  return { requested: () => requested, answered: () => answered };
}

/** A fresh join link (a new one revokes the last): the `/join#token` path, as the Conductor would share it. */
export async function inviteLink(seats = 3): Promise<string> {
  const res = await fetch(`${PB}/api/crawl/invite`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': 'e2e-secret' },
    body: JSON.stringify({ action: 'create', seats, days: 1 }) });
  if (!res.ok) throw new Error(`Invite failed: ${res.status}`);
  const u = new URL((await res.json()).url);
  return u.pathname + u.hash;
}

type DraftStop = { name: string; station_id: string; station_name: string; direction: 'out' | 'back'; photo?: boolean };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** A draft owned by `ownerName` with these stops in this crawl order; `photo` gives the stop a place with a picture. */
export async function seedDraftRoute(opts: { ownerName: string; eventDate: string; startTime: string; stops: DraftStop[]; startStation?: { id: string; name: string } }): Promise<{ itineraryId: string; stopIds: string[] }> {
  const token = await superuserToken();
  const users = await fetch(`${PB}/api/collections/users/records?filter=${encodeURIComponent(`name_key="${opts.ownerName.toLowerCase()}"`)}`, { headers: { Authorization: token } });
  const owner = (await users.json()).items[0];
  if (!owner) throw new Error(`No user named ${opts.ownerName}; log in first so the identity exists.`);
  const draft = await create('itineraries', {
    title: `E2E Draft ${Math.random().toString(36).slice(2, 8)}`, event_date: opts.eventDate,
    start_time: opts.startTime, vote_open: false, created_by: owner.id,
    ...(opts.startStation ? { start_station: opts.startStation.id, start_station_name: opts.startStation.name } : {})
  }, token);
  const stopIds: string[] = [];
  for (const [i, s] of opts.stops.entries()) {
    let place: string | undefined;
    if (s.photo) {
      const form = new FormData();
      form.append('ref', `google:e2e-${Math.random().toString(36).slice(2, 10)}`);
      form.append('source', 'google');
      form.append('name', s.name);
      form.append('photos', new Blob([PNG], { type: 'image/png' }), 'photo.png');
      const res = await fetch(`${PB}/api/collections/places/records`, { method: 'POST', headers: { Authorization: token }, body: form });
      if (!res.ok) throw new Error(`Create place failed: ${res.status} ${await res.text()}`);
      place = (await res.json()).id;
    }
    const stop = await create('stops', {
      itinerary: draft.id, order: i + 1, name: s.name, kind: 'bar', station_id: s.station_id, station_name: s.station_name,
      dwell_min: 30, walk_min: 5, direction: s.direction, ...(place ? { place } : {})
    }, token);
    stopIds.push(stop.id);
  }
  return { itineraryId: draft.id, stopIds };
}

/** A real finger drag (Chromium touch events): Playwright has no swipe, and a wheel is not a touch. */
export async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const steps = 10;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps, y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Waits until the line's panes viewport is focused on `side` and has finished scrolling there. */
export async function settledOn(page: Page, side: 'left' | 'right'): Promise<void> {
  const vp = page.getByTestId('line-viewport');
  await expect(vp).toHaveAttribute('data-focused', side);
  await expect.poll(() => vp.evaluate((el, s) => {
    const end = s === 'left' ? 0 : el.scrollWidth - el.clientWidth;
    return Math.abs(el.scrollLeft - end) <= 1;
  }, side)).toBe(true);
}

/**
 * A sheet's close X straddles its top edge: half above the sheet, its right edge just inside the
 * sheet's, and the half above the edge really is the X (not clipped, not covered). With `bodyId`, the
 * check repeats after the sheet's scroller has been forced to overflow and scrolled to its end.
 */
/**
 * Opens a sheet by tapping `target` from a page scrolled well down: the sheet still hugs the bottom of
 * the viewport. A spacer makes even a short page scroll. The dialog must stay `position: fixed`:
 * `relative` on a top-layer dialog computes to `absolute`, anchoring it to the document, not the screen.
 * (Opening a sheet currently resets the page to the top, which would hide that, so it is checked directly.)
 */
export async function openSheetFromScrolledPage(page: Page, target: Locator, sheetId: string): Promise<void> {
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.id = 'e2e-scroll-spacer';
    spacer.style.height = '3000px';
    document.body.append(spacer);
  });
  await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await target.click();
  await expect(page.getByTestId(sheetId)).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const sheet = (await page.getByTestId(sheetId).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(sheet.y + sheet.height - viewport.height)).toBeLessThan(2);
  await expect(page.getByTestId(sheetId)).toHaveCSS('position', 'fixed');
  await page.evaluate(() => document.getElementById('e2e-scroll-spacer')?.remove());
}

export async function expectRaisedClose(page: Page, sheetId: string, closeId: string, bodyId?: string): Promise<void> {
  const check = async () => {
    const sheet = (await page.getByTestId(sheetId).boundingBox())!;
    const close = (await page.getByTestId(closeId).boundingBox())!;
    expect(close.y).toBeLessThan(sheet.y);
    expect(close.y + close.height).toBeGreaterThan(sheet.y);
    const gap = sheet.x + sheet.width - (close.x + close.width);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(40);
    const hit = await page.evaluate(({ x, y, id }) => !!document.elementFromPoint(x, y)?.closest(`[data-testid="${id}"]`),
      { x: close.x + close.width / 2, y: sheet.y - 8, id: closeId });
    expect(hit, `${closeId} is what sits above ${sheetId}'s top edge`).toBe(true);
  };
  await check();
  if (!bodyId) return;
  const body = page.getByTestId(bodyId);
  await body.evaluate((el) => {
    const spacer = document.createElement('div');
    spacer.style.height = '2000px';
    el.append(spacer);
  });
  const pinned = (await page.getByTestId(closeId).boundingBox())!;
  const scrolled = await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return { overflows: el.scrollHeight > el.clientHeight, top: el.scrollTop };
  });
  expect(scrolled.overflows).toBe(true);
  expect(scrolled.top).toBeGreaterThan(0);
  // Scrolling the body does not carry the X with it.
  expect(await page.getByTestId(closeId).boundingBox()).toEqual(pinned);
  await check();
}
