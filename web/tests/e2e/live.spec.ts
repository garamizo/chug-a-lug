import { expect, test, type Page } from '@playwright/test';
import { clearLockedCrawls, login, seedLockedCrawl } from './helpers';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';

// A fixed crawl day, so every board state is deterministic. Chicago is UTC-6 in December, so
// 12:00 local is 18:00Z and the train leaves at 14:34 local.
const DATE = '2026-12-26';
const DEPART = '2026-12-26T20:34:00.000Z';
const ARRIVE = '2026-12-26T20:49:00.000Z';
// walk 5 + buffer 3 means the crawl has to leave at 20:26Z.
const TRIP = {
  tripId: '1244', routeId: 'BNSF', headsign: 'Chicago',
  schedDepart: '2026-12-26T20:31:00.000Z', schedArrive: '2026-12-26T20:46:00.000Z',
  liveDepart: DEPART, liveArrive: ARRIVE, delayMin: 3, status: 'live'
};

async function stubProxy(page: Page, alerts: unknown[] = []) {
  await page.route('**/api/metra/next**', (r) => r.fulfill({ json: { mode: 'live', fetchedAt: '2026-12-26T20:00:00.000Z', trips: [TRIP] } }));
  await page.route('**/api/metra/status', (r) => r.fulfill({ json: {
    staticPublishedAt: 'P', staticSource: 'file', rtFetchedAt: '2026-12-26T20:00:00.000Z', rtAgeSec: 10, mode: 'live',
    feeds: {
      positions: { fetchedAt: '2026-12-26T20:00:00.000Z', ageSec: 10, mode: 'live' },
      tripupdates: { fetchedAt: '2026-12-26T20:00:00.000Z', ageSec: 10, mode: 'live' },
      alerts: { fetchedAt: '2026-12-26T20:00:00.000Z', ageSec: 10, mode: 'live' }
    }
  } }));
  await page.route('**/api/metra/alerts', (r) => r.fulfill({ json: {
    mode: 'live', fetchedAt: '2026-12-26T20:00:00.000Z', alerts
  } }));
}

/** Logs in, seeds a locked crawl owned by that identity, and freezes the clock at `at`. */
async function arrive(page: Page, name: string, password: string, at: string, alerts: unknown[] = [], opts: { extraVenueAtFirstStation?: boolean } = {}) {
  await stubProxy(page, alerts);
  await login(page, name, password);
  await clearLockedCrawls();
  await seedLockedCrawl({ ownerName: name, eventDate: DATE, startTime: '12:00', departAt: DEPART, arriveAt: ARRIVE, ...opts });
  await page.clock.install({ time: new Date(at) });
  await page.goto('/live');
}

test('the board counts down, warns at Last Call, then says All Aboard', async ({ page }) => {
  await arrive(page, 'E2E Live Skipper', ADMIN, '2026-12-26T19:00:00.000Z');
  await expect(page.getByText('Leave in')).toBeVisible();

  // setFixedTime moves Date but fires no timers, and the board re-reads the clock on a 15 s tick,
  // so each jump is followed by a runFor to let that tick actually happen.
  await page.clock.setFixedTime(new Date('2026-12-26T20:20:00.000Z'));
  await page.clock.runFor(16_000);
  await expect(page.getByText('Last Call')).toBeVisible();

  await page.clock.setFixedTime(new Date('2026-12-26T20:27:00.000Z'));
  await page.clock.runFor(16_000);
  await expect(page.getByText('All Aboard')).toBeVisible();
});

test('the ticket leads with the station and names the venue in the walk line', async ({ page }) => {
  await arrive(page, 'E2E Ticket Skipper', ADMIN, '2026-12-26T19:00:00.000Z');
  const board = page.getByTestId('departure-board');
  await expect(board.getByRole('heading')).toHaveText('La Grange Road');
  await expect(board).toContainText('min walk from The Whistle Stop');
  // The delay is carried by the times alone: no on-time or late chip.
  await expect(board).not.toContainText('late');
  await expect(board).not.toContainText('On time');
});

test('an alert shows as a bubble and opens the notifications screen', async ({ page }) => {
  await arrive(page, 'E2E Alert Skipper', ADMIN, '2026-12-26T19:00:00.000Z', [{
    id: 'a1', effect: 'SIGNIFICANT_DELAYS', header: 'BNSF inbound delays',
    body: 'Signal problem at Cicero.', startsAt: null, endsAt: null, stationIds: []
  }]);
  await page.getByText('BNSF inbound delays').click();
  await expect(page).toHaveURL(/\/notifications/);
  await expect(page.getByText('Signal problem at Cicero.')).toBeVisible();
});

test('the banner rides along on other screens', async ({ page }) => {
  await arrive(page, 'E2E Banner Skipper', ADMIN, '2026-12-26T19:00:00.000Z');
  await expect(page.getByTestId('departure-board')).toBeVisible();

  await page.goto('/plan');
  await expect(page.getByTestId('board-compact')).toContainText('The Whistle Stop');
  await expect(page.getByTestId('board-compact')).toContainText('Leave in');
});

test('nobody can correct the position from the board any more', async ({ page }) => {
  await arrive(page, 'E2E Readonly Skipper', ADMIN, '2026-12-26T19:00:00.000Z');
  await expect(page.getByTestId('set-our-stop')).toHaveCount(0);
});

test('a Conductor-saved position change refreshes the board train immediately, not on the next poll', async ({ page }) => {
  // The two bars in this seed share a station, so the from/to the timetable is asked for does not
  // change when the crew moves between them — the same physical train serves both. What has to
  // change promptly is which *response* is showing: the board must not keep displaying the trip it
  // fetched for the stop the crew just left. Each call to /api/metra/next here returns a distinct,
  // recognisable departure time so a stale board is caught by content, not just by request count.
  const NAME = 'E2E Reactive Skipper';
  await login(page, NAME, ADMIN);
  await clearLockedCrawls();
  const seeded = await seedLockedCrawl({
    ownerName: NAME, eventDate: DATE, startTime: '12:00', departAt: DEPART, arriveAt: ARRIVE,
    extraVenueAtFirstStation: true
  });

  // Only the board's own query (feed.ts always asks with `limit=3`) is mocked here: the editor
  // also renders StopRow, which asks the *real* backend for layover alternatives with `limit=6`,
  // and must keep doing so untouched or the editor itself would fail to render.
  let calls = 0;
  await page.route('**/api/metra/next?**limit=3', (r) => {
    calls += 1;
    const trip = calls === 1
      ? { ...TRIP, liveDepart: '2026-12-26T20:34:00.000Z', liveArrive: '2026-12-26T20:49:00.000Z' }
      : { ...TRIP, liveDepart: '2026-12-26T21:10:00.000Z', liveArrive: '2026-12-26T21:25:00.000Z' };
    r.fulfill({ json: { mode: 'live', fetchedAt: '2026-12-26T20:00:00.000Z', trips: [trip] } });
  });
  await page.route('**/api/metra/status', (r) => r.fulfill({ json: {
    staticPublishedAt: 'P', staticSource: 'file', rtFetchedAt: '2026-12-26T20:00:00.000Z', rtAgeSec: 10, mode: 'live',
    feeds: {
      positions: { fetchedAt: '2026-12-26T20:00:00.000Z', ageSec: 10, mode: 'live' },
      tripupdates: { fetchedAt: '2026-12-26T20:00:00.000Z', ageSec: 10, mode: 'live' },
      alerts: { fetchedAt: '2026-12-26T20:00:00.000Z', ageSec: 10, mode: 'live' }
    }
  } }));
  await page.route('**/api/metra/alerts', (r) => r.fulfill({ json: { mode: 'live', fetchedAt: '2026-12-26T20:00:00.000Z', alerts: [] } }));

  // The clock is frozen for the whole test and never advanced: fake timers (the 30 s poll among
  // them) simply do not run, so any update after this point can only come from the realtime
  // subscription chain, never from the poll racing ahead of the assertion.
  await page.clock.install({ time: new Date('2026-12-26T18:30:00.000Z') });
  await page.goto(`/plan/${seeded.itineraryId}/edit`);
  await expect(page.getByTestId('board-compact')).toContainText('2:34 PM');

  // Move the crawl the way the app does: the editor's own controls, then Save — not a check-in
  // written straight to PocketBase behind the app's back. Setting the position is the Conductor's
  // real action; shortening the first stop's layover is what makes that move land on the *clock*
  // the board itself reads (the check-in's own timestamp is written by the server's real clock,
  // which this frozen page clock cannot reach, so `currentStop`'s correction path never fires in
  // this harness — the dwell change is what actually pulls the crawl's clock-picked position to
  // the second stop, deterministically, well before the 30 s poll would have).
  await page.getByTestId('set-here-1').click();
  await page.getByTestId('dwell-0').selectOption('0');
  await page.getByTestId('save-plan').click();
  // Save's own goto() is a client-side navigation: the same liveDay instance (and its
  // subscriptions) carries on into this next screen, which is what actually being tested.
  await expect(page).toHaveURL(new RegExp(`/plan/${seeded.itineraryId}$`));

  await expect(page.getByTestId('board-compact')).toContainText('3:10 PM');
});

test('two venues at one station still show the onward train', async ({ page }) => {
  // The literal next stop is another bar at La Grange; the train goes to Union Station. Asking the
  // timetable for La Grange to La Grange returns nothing, which used to read as "no train left".
  await arrive(page, 'E2E Same Station', ADMIN, '2026-12-26T19:00:00.000Z', [], { extraVenueAtFirstStation: true });
  const board = page.getByTestId('departure-board');
  await expect(board.getByRole('heading')).toHaveText('La Grange Road');
  await expect(board).toContainText('Union Station');
  await expect(board).toContainText('Leave in');
  await expect(board).not.toContainText('No train left today');
});
