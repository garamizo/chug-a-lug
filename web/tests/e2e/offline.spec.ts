import { expect, test, type Page } from '@playwright/test';
import { clearRoutes, login, seedLockedCrawl, openTab, sessionFor } from './helpers';
import { copy } from '../../src/lib/labels';
import { fmtDateTime } from '../../src/lib/time';
import type { NextTrip } from '../../src/lib/types';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const DATE = '2026-12-26';
const NOW = '2026-12-26T19:00:00.000Z';
const DEPART = '2026-12-26T20:34:00.000Z';
const ARRIVE = '2026-12-26T20:49:00.000Z';
const TRIP: NextTrip = {
  tripId: '1244', routeId: 'BNSF', headsign: 'Chicago',
  schedDepart: '2026-12-26T20:31:00.000Z', schedArrive: '2026-12-26T20:46:00.000Z',
  liveDepart: DEPART, liveArrive: ARRIVE, delayMin: 3, status: 'live'
};
const PB_ORIGIN = new URL(process.env.PB_URL ?? 'http://127.0.0.1:18093').origin;
const isPocketBase = (url: URL) => url.origin === PB_ORIGIN;

async function stubProxy(page: Page) {
  // The board names the venue only when it has a train. Keep one catchable at both test times;
  // this spec blocks PocketBase, while the Metra responses remain deterministic across reloads.
  await page.route('**/api/metra/next**', (r) => r.fulfill({ json: { mode: 'live', fetchedAt: NOW, trips: [TRIP] } }));
  await page.route('**/api/metra/status', (r) => r.fulfill({ json: {
    staticPublishedAt: 'P', staticSource: 'file', rtFetchedAt: NOW, rtAgeSec: 0, mode: 'live',
    feeds: {
      positions: { fetchedAt: NOW, ageSec: 0, mode: 'live' },
      tripupdates: { fetchedAt: NOW, ageSec: 0, mode: 'live' },
      alerts: { fetchedAt: NOW, ageSec: 0, mode: 'live' }
    }
  } }));
  await page.route('**/api/metra/alerts', (r) => r.fulfill({ json: { mode: 'live', fetchedAt: NOW, alerts: [] } }));
  await page.route('**/api/metra/stations**', (r) => r.fulfill({ json: { lines: [] } }));
}

/** The route every test here rides: shared by the storage cases, seeded once for them. */
async function seedTunnelRoute() {
  await sessionFor('E2E Tunnel Skipper', true);   // seedLockedCrawl needs the owner to exist
  await clearRoutes();
  return seedLockedCrawl({ ownerName: 'E2E Tunnel Skipper', eventDate: DATE, startTime: '12:00', departAt: DEPART, arriveAt: ARRIVE });
}

/** Per page: stubbed Metra, a session, the event-day clock, and Live with its board up. */
async function openRoute(page: Page) {
  await stubProxy(page);
  await login(page, 'E2E Tunnel Skipper', ADMIN);
  await page.clock.install({ time: new Date(NOW) });
  await page.goto('/live');
  await expect(page.getByTestId('departure-board')).toContainText('min walk from The Whistle Stop');
  await expect(page.getByTestId('departure-board')).toContainText('2:34 PM');
}

async function arrive(page: Page) {
  const seeded = await seedTunnelRoute();
  await openRoute(page);
  return seeded;
}

async function savedRoute(page: Page) {
  return page.evaluate(() => new Promise<{ itinerary: { id: string }; stops: unknown[]; legs: unknown[] } | null>((resolve, reject) => {
    const request = indexedDB.open('chugalug', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('mirror')) { db.close(); resolve(null); return; }
      const tx = db.transaction('mirror', 'readonly');
      const read = tx.objectStore('mirror').get('route');
      tx.oncomplete = () => { db.close(); resolve(read.result ?? null); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

// The service worker only registers in production. This exercises real IndexedDB; the controller
// must also check the precached shell using a production build with the browser fully offline.
test('the route still reads when PocketBase cannot be reached', async ({ page }) => {
  const seeded = await arrive(page);
  // Rendering can beat the asynchronous IDB commit. Wait for all three collections before leaving.
  await expect.poll(() => savedRoute(page)).toMatchObject({
    itinerary: { id: seeded.itineraryId }, stops: [{ id: seeded.firstStopId }, { id: seeded.secondStopId }],
    legs: [{ from_stop: seeded.firstStopId, to_stop: seeded.secondStopId }]
  });

  let blocked = 0;
  await page.route(isPocketBase, (r) => { blocked++; return r.abort(); });
  await page.clock.setFixedTime(new Date('2026-12-26T19:44:30.000Z'));
  // Hard navigation discards liveDay: the stop must now come from disk.
  await page.goto('/route');
  await expect(page.getByTestId('mirror-notice')).toHaveText(`${copy.showingMirror} 44 ${copy.minutesAgo}.`);
  await expect(page.getByTestId('stop-row-0')).toContainText('The Whistle Stop');
  await expect(page.getByTestId('stop-row-1')).toContainText('Berwyn Beer Hall');
  // The stops hook recomputes over the seeded leg: BN4 arrives at 2:55, then a 4-minute walk.
  await expect(page.getByTestId('stop-row-1')).toContainText('2:59 PM');
  expect(blocked).toBeGreaterThan(0);

  await page.goto('/live');
  await expect(page.getByTestId('mirror-notice')).toHaveText(`${copy.showingMirror} 44 ${copy.minutesAgo}.`);
  await expect(page.getByTestId('departure-board')).toContainText('min walk from The Whistle Stop');
  await expect(page.getByTestId('departure-board')).toContainText('2:34 PM');
  await openTab(page);
  await page.getByTestId('drink-beer').click();
  await expect(page.getByRole('alert')).toHaveText(copy.noSignal);
  await page.getByTestId('tab-close').click();
  await page.getByTestId('freight-input').setInputFiles({ name: 'tunnel.mp4', mimeType: 'video/mp4', buffer: Buffer.from('offline video') });
  // The failed upload reports in the chat box that sent it.
  await expect(page.getByTestId('crew-chat').getByRole('alert')).toContainText(copy.noSignal);

  // A days-old mirror must name its saved date. The itinerary remains readable off the live day.
  await page.clock.setFixedTime(new Date('2026-12-29T19:00:00.000Z'));
  await page.goto('/route');
  await expect(page.getByTestId('mirror-notice')).toHaveText(`${copy.showingMirror} ${fmtDateTime(NOW)}.`);
  await expect(page.getByTestId('stop-row-0')).toContainText('The Whistle Stop');
  await page.goto('/live');
  await expect(page.getByTestId('mirror-notice')).toHaveText(`${copy.showingMirror} ${fmtDateTime(NOW)}.`);
  // Off the route's date the mirrored route is a practice day, not a missing one.
  await expect(page.getByTestId('practice-badge')).toBeVisible();
  await expect(page.getByTestId('no-active-route')).toHaveCount(0);

  await page.unroute(isPocketBase);
  await page.goto('/route');
  await expect(page.getByTestId('stop-row-0')).toContainText('The Whistle Stop');
  await expect(page.getByTestId('mirror-notice')).toHaveCount(0);
});

// Seeded once: no case changes the route. With one worker and files run one at a time, no other
// file's clearRoutes() runs between this beforeAll and these cases. ("open throws" is gone: it lands
// in the same catch as "getter throws", src/lib/offline.ts.)
test.describe('storage failures', () => {
let shared: Awaited<ReturnType<typeof seedTunnelRoute>>;
test.beforeAll(async () => { shared = await seedTunnelRoute(); });
for (const storage of ['missing', 'getter throws', 'transaction throws', 'transaction aborts', 'cleared'] as const) {
  test(`the online route works with storage ${storage}, and an empty tunnel does not crash`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (storage !== 'cleared') {
      await page.addInitScript((mode) => {
        if (mode === 'getter throws') {
          Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Storage denied', 'SecurityError'); } });
        } else if (mode === 'transaction throws') {
          Object.defineProperty(IDBDatabase.prototype, 'transaction', { value() { throw new DOMException('Storage cleared', 'InvalidStateError'); } });
        } else if (mode === 'transaction aborts') {
          const transaction = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function (...args) {
            const tx = transaction.apply(this, args);
            tx.abort();
            return tx;
          };
        } else {
          Object.defineProperty(window, 'indexedDB', { value: undefined });
        }
      }, storage);
    }
    await openRoute(page);
    await page.goto('/route');
    await expect(page.getByTestId('stop-row-0')).toContainText('The Whistle Stop');
    if (storage === 'cleared') {
      await expect.poll(() => savedRoute(page)).toMatchObject({ itinerary: { id: shared.itineraryId } });
      // Leave the app first so its poller cannot repopulate the deleted database. The login
      // screen redirects an authenticated browser straight back into the app.
      await page.goto('/icon.svg');
      await page.evaluate(() => new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('chugalug');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('mirror connection was left open'));
      }));
    }
    await page.route(isPocketBase, (r) => r.abort());
    await page.goto('/route');
    await expect(page.getByTestId('no-route')).toBeVisible();
    await expect(page.getByTestId('mirror-notice')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
});

test('an acknowledgement with no signal keeps the Bulletin and reports the failure', async ({ page }) => {
  await arrive(page);
  await page.getByTestId('menu').click();
  await page.getByText(copy.postBulletin, { exact: true }).click();
  await page.getByTestId('bulletin-body').fill('Wait at the first stop.');
  await page.getByTestId('bulletin-send').click();
  await expect(page.getByTestId('pinned-bulletin')).toContainText('Wait at the first stop.');
  await page.route(isPocketBase, (r) => r.abort());
  await page.getByTestId('bulletin-ack').click();
  await expect(page.getByRole('alert')).toHaveText(copy.noSignal);
  await expect(page.getByTestId('pinned-bulletin')).toBeVisible();
});
