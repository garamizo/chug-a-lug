import { deleteUserByName } from '../hooks/setup';
export default async function () {
  await deleteUserByName('E2E Rider');
  await deleteUserByName('E2E Boss');
  await deleteUserByName('E2E Skipper');
}
