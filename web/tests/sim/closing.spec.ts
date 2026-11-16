import { expect, test, type Page } from '@playwright/test';
import type PocketBase from 'pocketbase';
import { PB, PROOF_JPEG, login, openTab, sessionFor, tapDrink } from '../e2e/helpers';
import { expectSaneLayout } from '../e2e/layoutRules';
import { admin } from './setup';
import { copy } from '../../src/lib/labels';

// The whole night in order, on the server's event clock: the crew posts while the clock is inside the
// first stop, then the clock moves past the train home and Closing Time's reel takes over. Only this
// suite moves the server clock, and the server stamps every drink, photo, message and Cheers with it.
// It runs after the rehearsal (playwright.sim.config.ts): it archives that route and ends its day.

const BASE = 'http://127.0.0.1:15173';
const CREW = process.env.CREW_PASSWORD!;
const ONE = 'Closing Crew One', TWO = 'Closing Crew Two', CONDUCTOR = 'Closing Conductor';
const MESSAGE = 'Last round is on the Caboose';
// Title, the first stop (its Cheered photo, Cheered message, Pathfinder, two beers), the second stop, the finale.
const SEQUENCE = ['title', 'stop', 'photo', 'message', 'spikes', 'drinks', 'stop', 'finale'];
const SHOWN = 'chugalug.closingShown';

let pb: PocketBase;
let conductorToken = '';
let route = '', stop1 = '', serviceDate = '';
let homeArrival = '';

async function changeClock(body: object) {
  const headers = { Authorization: conductorToken, 'content-type': 'application/json' };
  const current = await (await fetch(`${BASE}/api/sim/clock`, { headers })).json();
  const res = await fetch(`${BASE}/api/sim/clock`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: current.revision, ...body }) });
  expect(res.ok, await res.clone().text()).toBe(true);
  return res.json();
}

const closingKey = () => `${route}:${serviceDate}:browser-fixture`;
const shownKeys = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]') as string[], SHOWN);

/** The slide on screen once any cross-fade has finished, by its kind. */
async function current(page: Page): Promise<string> {
  const slides = page.getByTestId('closing-reel').locator('[data-testid^="reel-slide-"]');
  await expect(slides).toHaveCount(1);
  return (await slides.getAttribute('data-testid'))!.replace('reel-slide-', '');
}

/** Holds the feed's drinks read until released, so the reel cannot be ready yet. */
async function holdFeed(page: Page): Promise<() => Promise<void>> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const pattern = '**/api/collections/drink_entries/records**';
  await page.route(pattern, async (r) => { await held; await r.continue().catch(() => {}); });
  return async () => { release(); await page.unroute(pattern); };
}

test.describe.serial('Closing Time, the night end to end', () => {
  test.beforeAll(async () => {
    test.setTimeout(60_000);
    pb = await admin();
    conductorToken = (await sessionFor(CONDUCTOR, true)).token;
    await sessionFor(ONE); await sessionFor(TWO);
    const conductor = await pb.collection('users').getFirstListItem(`name_key="${CONDUCTOR.toLowerCase()}"`);
    // The rehearsal and the restart left the clock at the window's end or running: a private reset to
    // the window's start, paused, under a newer revision (as restart.spec does), never a UI rewind.
    const clock = await pb.collection('simulation_clock').getOne('simulationclock');
    serviceDate = clock.service_date;
    await pb.collection('simulation_clock').update('simulationclock', {
      epoch_start: clock.window_start, wall_start: new Date().toISOString(), rate: 0, revision: clock.revision + 1
    });
    // Board at Aurora at 11:00, two bars at Union Station: BN2 in, BN3 home. No hand-written legs.
    const draft = await pb.collection('itineraries').create({ title: 'Closing night', event_date: serviceDate, start_time: '11:00', created_by: conductor.id });
    route = draft.id;
    stop1 = (await pb.collection('stops').create({ itinerary: route, order: 1, name: 'First Pour', kind: 'bar', station_id: 'CUS',
      station_name: 'Union Station', dwell_min: 5, walk_min: 4, direction: 'out' })).id;
    await pb.collection('stops').create({ itinerary: route, order: 2, name: 'Last Call', kind: 'bar', station_id: 'CUS',
      station_name: 'Union Station', dwell_min: 5, walk_min: 4, direction: 'out' });
    await pb.collection('itineraries').update(route, { status: 'locked', start_station: 'AURORA', start_station_name: 'Aurora' });
    await expect.poll(async () => {
      const legs = await pb.collection('legs').getFullList({ filter: `itinerary="${route}"` });
      return legs.find((l) => !l.to_stop && l.kind === 'train')?.arrive_at ?? '';
    }, { timeout: 20_000 }).not.toBe('');
    const legs = await pb.collection('legs').getFullList({ filter: `itinerary="${route}"` });
    homeArrival = new Date(legs.find((l) => !l.to_stop && l.kind === 'train')!.arrive_at).toISOString();
    const arrived = new Date(legs.find((l) => !l.from_stop)!.arrive_at).getTime();
    const leaves = new Date(legs.find((l) => l.from_stop === stop1)!.depart_at).getTime();
    expect(leaves).toBeGreaterThan(arrived);
    // Inside the first stop: after the train in and the walk over, before the walk on.
    await changeClock({ action: 'seek', at: new Date(leaves - 60_000).toISOString() });
  });

  test('the night’s drinks, photo, message and Cheers are stamped before the train home', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ONE, CREW);
    await page.goto('/live');
    await expect(page.getByTestId('departure-board')).toBeVisible();
    await openTab(page);
    await tapDrink(page, 'beer');
    await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('1');
    await tapDrink(page, 'beer');
    await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('2');
    await page.getByTestId('tab-close').click();
    await page.getByTestId('freight-input').setInputFiles(PROOF_JPEG);
    await page.getByTestId('chat-input').fill(MESSAGE);
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('crew-chat')).toContainText(MESSAGE);
    await expect.poll(async () => (await pb.collection('media').getFullList({ filter: `stop="${stop1}" && drink_kind=""` })).length).toBe(1);

    // The second phone Cheers the photo and the message.
    const two = await sessionFor(TWO);
    const photo = (await pb.collection('media').getFullList({ filter: `stop="${stop1}" && drink_kind=""` }))[0];
    const message = (await pb.collection('chat_messages').getFullList({ filter: `itinerary="${route}"` }))[0];
    for (const [kind, id] of [['media', photo.id], ['message', message.id]]) {
      const res = await fetch(`${PB}/api/collections/reactions/records`, { method: 'POST',
        headers: { Authorization: two.token, 'content-type': 'application/json' },
        body: JSON.stringify({ user: two.record.id, target_kind: kind, target_id: id, itinerary: route }) });
      expect(res.ok, await res.clone().text()).toBe(true);
    }

    const stamps = [
      ...(await pb.collection('drink_entries').getFullList({ filter: `stop.itinerary="${route}"` })),
      ...(await pb.collection('media').getFullList({ filter: `stop.itinerary="${route}"` })),
      ...(await pb.collection('chat_messages').getFullList({ filter: `itinerary="${route}"` })),
      ...(await pb.collection('reactions').getFullList({ filter: `itinerary="${route}"` }))
    ].map((r) => r.at as string);
    expect(stamps).toHaveLength(2 + 3 + 1 + 2);
    for (const at of stamps) expect(Date.parse(at)).toBeLessThan(Date.parse(homeArrival));

    // The train home arrives.
    await changeClock({ action: 'seek', at: new Date(Date.parse(homeArrival) + 60_000).toISOString() });
  });

  test('the reel opens by itself once, plays, and every way out returns to Live for good', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, TWO, CREW);
    await page.goto('/route');
    await page.goto('/live');
    const reel = page.getByTestId('closing-reel');
    await expect(page).toHaveURL(/\/live\/closing$/);
    await expect(reel.getByTestId('reel-slide-title')).toBeVisible();
    expect(await shownKeys(page)).toContain(closingKey());

    // Hold pauses, and letting go plays on.
    const box = (await reel.boundingBox())!;
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(middle.x, middle.y);
    await page.mouse.down();
    await expect(reel).toHaveClass(/\bpaused\b/);
    let at = SEQUENCE.indexOf(await current(page));
    expect(at).toBeGreaterThanOrEqual(0);
    await page.mouse.up();
    await expect(reel).not.toHaveClass(/\bpaused\b/);

    // Space pauses; a tap on the right third goes on, ← goes back, → on; Space plays again.
    const pauseOn = async () => { await page.keyboard.press(' '); await expect(reel).toHaveClass(/\bpaused\b/); return current(page); };
    at = SEQUENCE.indexOf(await pauseOn());
    await page.mouse.click(box.x + box.width * 0.85, middle.y);
    expect(await pauseOn()).toBe(SEQUENCE[++at]);
    await page.keyboard.press('ArrowLeft');
    expect(await pauseOn()).toBe(SEQUENCE[--at]);
    await page.keyboard.press('ArrowRight');
    expect(await pauseOn()).toBe(SEQUENCE[++at]);
    await page.keyboard.press(' ');
    await expect(reel).not.toHaveClass(/\bpaused\b/);

    // The same by its labelled buttons, for a screen reader on a touch screen; the slide's words are announced.
    const pauseByButton = async () => {
      await reel.getByRole('button', { name: copy.closingPause, exact: true }).click();
      await expect(reel).toHaveClass(/\bpaused\b/);
      await expect(reel.getByRole('button', { name: copy.closingResume, exact: true })).toBeVisible();
      return current(page);
    };
    at = SEQUENCE.indexOf(await pauseByButton());
    await expect(reel.getByTestId('reel-announce')).not.toHaveText('');
    await reel.getByRole('button', { name: copy.closingNext, exact: true }).click();
    expect(await pauseByButton()).toBe(SEQUENCE[++at]);
    await reel.getByRole('button', { name: copy.closingPrevious, exact: true }).click();
    expect(await pauseByButton()).toBe(SEQUENCE[--at]);
    await reel.getByRole('button', { name: copy.closingResume, exact: true }).click();
    await expect(reel).not.toHaveClass(/\bpaused\b/);

    // The Cheered photo and message, then the finale.
    await expect(reel.getByTestId('reel-slide-photo')).toContainText(`1 ${copy.closingCheers}`, { timeout: 15_000 });
    await expect(reel.getByTestId('reel-slide-message')).toContainText(MESSAGE, { timeout: 15_000 });
    await expect(reel.getByTestId('reel-slide-message')).toContainText(`1 ${copy.closingCheers}`);
    await expect(reel.getByTestId('reel-announce')).toContainText(MESSAGE);
    for (let i = 0; i < SEQUENCE.length && !(await reel.getByTestId('reel-slide-finale').isVisible()); i++) await page.keyboard.press('ArrowRight');
    await expect(reel.getByTestId('reel-slide-finale')).toContainText(copy.closingFinale);
    await expect(reel.getByTestId('reel-done')).toBeVisible();
    await expect(reel.getByTestId('reel-replay')).toBeVisible();
    await expectSaneLayout(page);

    // Escape returns to Live, Play has the focus, and the reel does not open again.
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/live$/);
    await expect(page.getByTestId('closing-card')).toContainText(copy.closingCard);
    await expect(page.getByTestId('closing-play')).toBeFocused();
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/live$/);
    await expectSaneLayout(page);

    // Play, then ✕: back on Live, still for good.
    await page.getByTestId('closing-play').click();
    await expect(reel.getByTestId('reel-slide-title')).toBeVisible();
    await page.getByTestId('reel-close').click();
    await expect(page).toHaveURL(/\/live$/);
    await expect(page.getByTestId('closing-play')).toBeFocused();
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/live$/);

    // Play, then the browser's Back.
    await page.getByTestId('closing-play').click();
    await expect(reel).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/live$/);
    await expect(page.getByTestId('closing-card')).toBeVisible();

    // Play, then ✕ twice: one step back, so Back from Live still reaches the screen before it.
    await page.getByTestId('closing-play').click();
    await expect(reel).toBeVisible();
    await page.getByTestId('reel-close').dblclick();
    await expect(page).toHaveURL(/\/live$/);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/live$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/route$/);
  });

  test('leaving while it loads keeps it closed this session, unmarked; it waits for the Tab sheet', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, TWO, CREW);
    let release = await holdFeed(page);
    await page.goto('/live');
    await expect(page.getByTestId('closing-card')).toBeVisible();
    await page.getByTestId('closing-play').click();
    await expect(page.getByTestId('reel-loading')).toBeVisible();
    await page.getByTestId('reel-close').click();
    await expect(page).toHaveURL(/\/live$/);
    await release();
    await expect(page.getByTestId('crew-chat')).toContainText(MESSAGE);
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/live$/);
    expect(await shownKeys(page)).not.toContain(closingKey());

    // A new session: it would open by itself, but not over the Tab sheet.
    release = await holdFeed(page);
    await page.reload();
    await openTab(page);
    await release();
    await expect(page.getByTestId('crew-chat')).toContainText(MESSAGE);
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/live$/);
    await expect(page.getByTestId('tab-sheet')).toBeVisible();
    await page.getByTestId('tab-close').click();
    await expect(page).toHaveURL(/\/live\/closing$/);
    await expect(page.getByTestId('reel-slide-title')).toBeVisible();
    expect(await shownKeys(page)).toContain(closingKey());
  });

  test('it waits while something on Live is being typed, then opens', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, TWO, CREW);
    const release = await holdFeed(page);
    await page.goto('/live');
    const input = page.getByTestId('chat-input');
    await input.fill('Half a thought');
    await release();
    await expect(page.getByTestId('crew-chat')).toContainText(MESSAGE);
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/live$/);
    await expect(input).toHaveValue('Half a thought');
    // A draft holds it without the focus, and the focus holds it without a draft.
    await input.blur();
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/live$/);
    await input.focus();
    await input.fill('');
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/live$/);
    await input.blur();
    await expect(page).toHaveURL(/\/live\/closing$/);
    await expect(page.getByTestId('reel-slide-title')).toBeVisible();
  });

  test('with the feed failing, Try again recovers, and reduced motion still plays', async ({ page }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await login(page, TWO, CREW);
    const pattern = '**/api/collections/drink_entries/records**';
    await page.route(pattern, (r) => r.abort());
    await page.goto('/live');
    await page.getByTestId('closing-play').click();
    const reel = page.getByTestId('closing-reel');
    await expect(reel.getByRole('alert')).toHaveText(copy.noSignal);
    await page.unroute(pattern);
    await reel.getByTestId('reel-retry').click();
    await expect(reel.getByTestId('reel-slide-title')).toBeVisible();
    // It plays on by itself.
    await expect(reel.getByTestId('reel-slide-stop')).toBeVisible({ timeout: 6000 });
  });

  test('on Live at Closing Time, the Caboose card plays out before the reel opens', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, ONE, CREW);
    await page.goto('/live');
    const card = page.getByTestId('spike-celebration');
    await expect(card).toContainText(copy.spikeCaboose);
    // Well into its time, the card is still there and the reel has waited.
    await page.waitForTimeout(1500);
    await expect(card).toContainText(copy.spikeCaboose);
    await expect(page).toHaveURL(/\/live$/);
    await expect(page).toHaveURL(/\/live\/closing$/, { timeout: 10_000 });
    await expect(card).toHaveCount(0);
    // It played out: closing the reel does not bring it back.
    await page.getByTestId('reel-close').click();
    await expect(page).toHaveURL(/\/live$/);
    await page.waitForTimeout(1500);
    await expect(card).toHaveCount(0);
  });

  test('a Golden Spike card cut short by Play comes back once the reel is closed', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, ONE, CREW);
    await page.goto('/live');
    const card = page.getByTestId('spike-celebration');
    await expect(card).toContainText(copy.spikeCaboose);
    // Play from the keyboard: the card sits over Live's top, where the Closing Time card is.
    await page.getByTestId('closing-play').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/live\/closing$/);
    await expect(card).toHaveCount(0);
    await page.getByTestId('reel-close').click();
    await expect(page).toHaveURL(/\/live$/);
    await expect(card).toContainText(copy.spikeCaboose);
  });

  test('a fresh Golden Spike waits until the reel is closed', async ({ page }) => {
    test.setTimeout(60_000);
    // Crew One drank least, so the Caboose (at Closing Time, a minute ago) is theirs and still fresh.
    await login(page, ONE, CREW);
    await page.goto('/live/closing');
    const reel = page.getByTestId('closing-reel');
    await expect(reel.getByTestId('reel-slide-title')).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await expect(page.getByTestId('spike-celebration')).toHaveCount(0);
      await page.waitForTimeout(1000);
    }
    await reel.getByTestId('reel-close').click();
    await expect(page).toHaveURL(/\/live$/);
    await expect(page.getByTestId('spike-celebration')).toContainText(copy.spikeCaboose);
  });
});
