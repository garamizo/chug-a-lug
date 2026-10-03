import { expect, it } from 'vitest';
import { clearMails, mails, oidcCode, turnstileToken } from './setup';

it('the SMTP sink, the single-use Turnstile fake and the OIDC fake are reachable', async () => {
  await clearMails();
  expect(await mails()).toEqual([]);
  const verify = (response: string) => fetch('http://127.0.0.1:12527/siteverify', { method: 'POST', body: new URLSearchParams({ secret: 'test-turnstile-secret', response }) }).then((r) => r.json());
  const token = turnstileToken();
  expect((await verify(token)).success).toBe(true);
  expect((await verify(token)).success).toBe(false); // used once already
  expect((await verify('nope')).success).toBe(false);
  const code = oidcCode({ sub: 's1', email: 'a@test.invalid' });
  const { access_token } = await (await fetch('http://127.0.0.1:12528/token', { method: 'POST', body: new URLSearchParams({ code }) })).json();
  const me = await (await fetch('http://127.0.0.1:12528/userinfo', { headers: { Authorization: `Bearer ${access_token}` } })).json();
  expect(me).toMatchObject({ sub: 's1', email: 'a@test.invalid', email_verified: true });
});
