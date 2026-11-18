import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { login } from '../e2e/helpers';
import { awaitWaiting, readMark, restoreBuild, servedMark, swapBuild } from './swap';

test.afterAll(restoreBuild);

test('a deploy installs a waiting worker under a controlled page', async ({ page }) => {
  await login(page, 'Offline Rehearsal Crew', process.env.CREW_PASSWORD!);
  await page.goto('/route');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const before = servedMark();
  expect(await readMark(page)).toBe(before);
  await swapBuild();
  await awaitWaiting(page); // the deploy is found and waits; the test below covers the tap
});

// A full load clears the flag; an in-app move keeps it.
const markTap = (page: Page) => page.evaluate(() => { (window as unknown as { __beforeTap?: number }).__beforeTap = 1; });
const beforeTap = (page: Page) => page.evaluate(() => (window as unknown as { __beforeTap?: number }).__beforeTap);
const workers = (page: Page) => page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return { waiting: !!reg?.waiting, controller: !!navigator.serviceWorker.controller };
});

const CHAT = '**/api/collections/chat_messages/records*';
const isChat = (method: string) => (r: { url(): string; request(): { method(): string } }) =>
  new URL(r.url()).pathname === '/api/collections/chat_messages/records' && r.request().method() === method;

/** Holds the next chat send at the network until `release()`; `held` resolves once it is held. */
async function holdChatSend(context: BrowserContext) {
  let signal!: () => void, release!: () => void;
  const held = new Promise<void>((r) => { signal = r; });
  const released = new Promise<void>((r) => { release = r; });
  await context.route(CHAT, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    signal();
    await released;
    await route.continue();
  });
  return { held, release: async () => { release(); }, done: () => context.unroute(CHAT) };
}

test('three deploys, each taken up at a link tap', async ({ page, context }) => {
  test.setTimeout(180_000);
  await login(page, 'Offline Rehearsal Crew', process.env.CREW_PASSWORD!);
  await page.goto('/route');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  // Cycle 1: offline at the tap, on the logo. The tapped Home stays Home on the event day.
  await swapBuild();
  await awaitWaiting(page);
  await context.setOffline(true);
  await markTap(page);
  await page.locator('a.brand').click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => beforeTap(page)).toBeUndefined();
  await expect.poll(() => readMark(page)).toBe(servedMark());
  expect(await workers(page)).toEqual({ waiting: false, controller: true });
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/route$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/$/);
  await context.setOffline(false);

  // Cycle 2: a send held in flight before the tap; the tap moves in-app, the next one switches.
  await page.goto('/live');
  await expect(page.getByTestId('chat-input')).toBeVisible();
  await swapBuild();
  await awaitWaiting(page);
  const before = await holdChatSend(context);
  const held = `update-held-${Date.now()}`;
  await page.getByTestId('chat-input').fill(held);
  await page.getByTestId('chat-send').click();
  await before.held;
  await markTap(page);
  await page.getByTestId('tab-route').click();
  await expect(page).toHaveURL(/\/route$/);
  expect(await beforeTap(page)).toBe(1);
  expect(await workers(page)).toEqual({ waiting: true, controller: true });
  const posted = page.waitForResponse(isChat('POST'));
  const fed = page.waitForResponse(isChat('GET'));
  await before.release();
  await posted;
  await fed;
  await page.waitForTimeout(1000); // the feed's other reads in the same Promise.all, then the send settles
  await before.done();
  await markTap(page);
  await page.getByTestId('tab-crew').click();
  await expect(page).toHaveURL(/\/crew$/);
  await expect.poll(() => beforeTap(page)).toBeUndefined();
  await expect.poll(() => readMark(page)).toBe(servedMark());
  await page.goto('/live');
  await expect(page.getByText(held)).toBeVisible();

  // Cycle 3: a send begun during a slow handoff; the load waits for it.
  await expect(page.getByTestId('chat-input')).toBeVisible();
  await swapBuild();
  await awaitWaiting(page);
  await page.evaluate(() => {
    const post = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (this: ServiceWorker, ...args: Parameters<typeof post>) {
      setTimeout(() => post.apply(this, args), 2000);
    } as typeof post;
  });
  const during = await holdChatSend(context);
  await markTap(page);
  await page.getByTestId('tab-crew').click();
  await expect(page).toHaveURL(/\/live$/);
  const sent = `update-during-${Date.now()}`;
  await page.getByTestId('chat-input').fill(sent);
  await page.getByTestId('chat-send').click();
  await during.held;
  await page.waitForTimeout(4000);
  await expect(page).toHaveURL(/\/live$/);
  expect(await beforeTap(page)).toBe(1);
  await during.release();
  await expect(page).toHaveURL(/\/crew$/, { timeout: 15_000 });
  await expect.poll(() => beforeTap(page)).toBeUndefined();
  await expect.poll(() => readMark(page)).toBe(servedMark());
  await during.done();
  await page.goto('/live');
  await expect(page.getByText(sent)).toBeVisible();
});
