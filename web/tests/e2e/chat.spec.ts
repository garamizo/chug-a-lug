import { expect, test } from '@playwright/test';
import { clearRoutes, login, openTab, seedLockedCrawl } from './helpers';
test('live actions open the Tab and camera choices and share activity with the crew', async ({ page, browser }) => {
  await login(page, 'Chat Conductor', process.env.ADMIN_PASSWORD ?? 'admin-test-password');
  await clearRoutes();
  await seedLockedCrawl({ ownerName: 'Chat Conductor', eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
  await page.goto('/live');
  await expect(page.getByTestId('route-strip').locator('[aria-current="step"]')).toBeVisible();
  await expect(page.getByTestId('route-strip')).toBeVisible();
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
    await login(other, 'Chat Crew', process.env.CREW_PASSWORD ?? 'crew-test-password');
    await other.goto('/live');
    await expect(other.getByTestId('action-bulletin')).toBeDisabled();
    await openTab(page);
    await page.getByTestId('drink-beer').click();
    await expect(other.getByTestId('crew-chat')).toContainText('Chat Conductor');
    await expect(other.getByTestId('crew-chat')).toContainText('Beer');
    await page.getByTestId('tab-undo').click();
    await expect(other.getByTestId('crew-chat')).not.toContainText('Beer');
    await page.getByTestId('tab-close').click();
    const picker = page.waitForEvent('filechooser');
    await page.getByTestId('attach-media').click();
    expect((await picker).isMultiple()).toBe(true);
    // The chat box's round button is the camera while it is empty.
    await expect(page.getByTestId('camera-button')).toBeVisible();
    await expect(page.getByTestId('chat-send')).toHaveCount(0);
    await expect(page.getByTestId('freight-camera')).toHaveAttribute('capture', 'environment');
    await page.getByTestId('action-bulletin').click();
    await page.getByTestId('bulletin-body').fill('Meet by the platform.');
    await page.getByTestId('bulletin-send').click();
    await expect(other.getByTestId('crew-chat')).toContainText('Meet by the platform.');
  } finally { await context.close(); }
});

async function liveChat(page: import('@playwright/test').Page, name: string) {
  await page.route('**/api/metra/**', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
  await login(page, name, process.env.ADMIN_PASSWORD ?? 'admin-test-password');
  await clearRoutes();
  await seedLockedCrawl({ ownerName: name, eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: new Date('2026-12-26T19:00:00Z') });
  await page.goto('/live');
  await expect(page.getByTestId('route-strip').locator('[aria-current="step"]')).toBeVisible();
}

test('the chat box sends with Enter, never sends blanks, and inserts emoji at the caret', async ({ page }) => {
  await liveChat(page, 'Chat Box Conductor');
  await page.getByTestId('chat-input').fill('   ');
  await expect(page.getByTestId('camera-button')).toBeVisible();
  await page.getByTestId('chat-input').fill('Save me a seat');
  await expect(page.getByTestId('camera-button')).toHaveCount(0);
  await expect(page.getByTestId('chat-send')).toBeEnabled();
  await expect(page.getByTestId('emoji-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.getByTestId('emoji-toggle').click();
  await expect(page.getByTestId('emoji-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: '🍕' }).click();
  await expect(page.getByTestId('chat-input')).toHaveValue('Save me a seat🍕');
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('crew-chat')).toContainText('Save me a seat🍕');
  await expect(page.getByTestId('chat-input')).toHaveValue('');
});

test('typing during a slow send is never lost, and a failed send gives its text back', async ({ page }) => {
  await liveChat(page, 'Slow Send Conductor');
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/collections/chat_messages/records', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await held;
    await route.abort('failed');
  });
  await page.getByTestId('chat-input').fill('First');
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('chat-input')).toHaveValue('');
  await page.getByTestId('chat-input').fill('Second, typed while waiting');
  release();
  await expect(page.getByTestId('crew-chat').getByRole('status')).toBeVisible();
  await expect(page.getByTestId('chat-input')).toHaveValue('Second, typed while waiting');
  await page.getByTestId('chat-input').fill('');
  await page.unroute('**/api/collections/chat_messages/records');
  await page.route('**/api/collections/chat_messages/records', (route) => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await page.getByTestId('chat-input').fill('Retry me');
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('chat-input')).toHaveValue('Retry me');
});
