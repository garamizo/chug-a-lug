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
  await page.route('**/api/metra/next**', (r) => r.fulfill({ json: { mode: 'live', trips: [TRIP] } }));
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
async function arrive(page: Page, name: string, password: string, at: string, alerts: unknown[] = []) {
  await stubProxy(page, alerts);
  await login(page, name, password);
  await clearLockedCrawls();
  await seedLockedCrawl({ ownerName: name, eventDate: DATE, startTime: '12:00', departAt: DEPART, arriveAt: ARRIVE });
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

test('only the Conductor sees the correction control', async ({ page }) => {
  await arrive(page, 'E2E Live Crew', CREW, '2026-12-26T19:00:00.000Z');
  await expect(page.getByTestId('departure-board')).toBeVisible();
  await expect(page.getByTestId('set-our-stop')).toHaveCount(0);
});

test('the Conductor can move the crawl to another stop', async ({ page }) => {
  await arrive(page, 'E2E Correcting Skipper', ADMIN, '2026-12-26T19:00:00.000Z');
  await expect(page.getByTestId('departure-board')).toContainText('La Grange Road');
  await page.getByTestId('set-our-stop').click();
  await page.getByRole('button', { name: /Berwyn Beer Hall/ }).click();
  await expect(page.getByTestId('departure-board')).toContainText('Union Station');
});
