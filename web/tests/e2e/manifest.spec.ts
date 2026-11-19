import { test, expect } from '@playwright/test';
import { login, sessionFor } from './helpers';
import { accessEventLabels, copy, labels } from '../../src/lib/labels';

test('the Manifest lists name and email and changes a role from the role window', async ({ page }) => {
  const crew = await sessionFor('E2E Manifest Crew');
  await sessionFor('E2E Manifest Conductor', true);
  await login(page, 'E2E Manifest Conductor', 'admin-test-password');
  await page.goto('/crew/access');
  const row = page.getByTestId('manifest-person').filter({ hasText: 'E2E Manifest Crew' });
  await expect(row).toContainText(String(crew.record.email));
  await expect(page.getByRole('heading', { name: /recent requests/i })).toHaveCount(0);
  await expect(row.getByTestId('person-status')).toContainText(copy.roleCrew);
  const boss = page.getByTestId('manifest-person').filter({ hasText: 'E2E Manifest Conductor' });
  await expect(boss.getByTestId('person-status')).toContainText(labels.admin);
  await expect(boss.getByTestId('open-role-window')).toHaveCount(0);

  await row.getByTestId('open-role-window').click();
  await page.getByTestId('role-option-trainspotter').check();
  await page.getByTestId('role-save').click();
  await expect(page.getByTestId('role-window')).toHaveCount(0);
  await expect(row.getByTestId('person-status')).toContainText(copy.roleTrainspotter);
  await expect(page.getByTestId('log-row').filter({ hasText: accessEventLabels.role_changed }).filter({ hasText: 'E2E Manifest Crew' })).toContainText('Crew → Trainspotter');
});
