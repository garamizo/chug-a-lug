import { expect, it } from 'vitest';
import { clearMails, mails } from './setup';

it('the SMTP sink is reachable', async () => {
  await clearMails();
  expect(await mails()).toEqual([]);
});
