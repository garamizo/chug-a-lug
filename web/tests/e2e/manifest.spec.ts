import { test, expect } from '@playwright/test';
import { login, sessionFor } from './helpers';
import { copy } from '../../src/lib/labels';

test('the Manifest lists name and email and puts someone off', async ({ page }) => {
  const crew = await sessionFor('E2E Manifest Crew');
  await sessionFor('E2E Manifest Conductor', true);
  await login(page, 'E2E Manifest Conductor', 'admin-test-password');
  await page.goto('/crew/access');
  const row = page.getByTestId('manifest-person').filter({ hasText: 'E2E Manifest Crew' });
  await expect(row).toContainText(String(crew.record.email));
  await expect(page.getByRole('heading', { name: /recent requests/i })).toHaveCount(0);
  await row.getByTestId('toggle-block').click();
  await expect(row.getByTestId('person-status')).toContainText(copy.personPutOff);
  await row.getByTestId('toggle-block').click();
  await expect(row.getByTestId('person-status')).toContainText(copy.personAboard);
});
