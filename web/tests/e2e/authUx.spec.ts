import { test, expect } from '@playwright/test';
import { authCopy } from '../../src/lib/labels';

test('password reset focuses the confirmation then the corrected email', async ({ page }) => {
  await page.route('**/api/collections/users/request-password-reset', r => r.fulfill({ status: 204 }));
  await page.goto('/login/forgot');
  await page.getByTestId('email-input').fill('alex@example.com');
  await page.getByTestId('send-link').click();
  await expect(page.getByRole('heading', { name: authCopy.inboxTitle })).toBeFocused();
  await page.getByTestId('change-email').click();
  await expect(page.getByTestId('email-input')).toBeFocused();
});
