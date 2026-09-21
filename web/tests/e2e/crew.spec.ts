import { expect, test } from '@playwright/test';
import { login } from './helpers';

const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';

test('the Crew Board lists everyone who has logged in', async ({ page }) => {
  await login(page, 'E2E Roster One', CREW);
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-crew').click();

  await expect(page).toHaveURL(/\/crew$/);
  await expect(page.getByTestId('crew-row')).toContainText(['E2E Roster One']);
  await expect(page.getByTestId('crew-row').first()).toContainText('0');
});
