import { seedAllowlist } from '../hooks/setup';
export default async function () {
  await seedAllowlist('+13125550123', 'E2E Rider');
}
