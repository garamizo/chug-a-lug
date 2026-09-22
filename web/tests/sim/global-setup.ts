import { createServer } from 'node:http';
import { seed } from './setup';
export default async function () {
  let requests = 0;
  const sentinel = createServer((_request, response) => { requests++; response.writeHead(500); response.end(); });
  await new Promise<void>((resolve, reject) => { sentinel.once('error', reject); sentinel.listen(18096, '127.0.0.1', resolve); });
  try { await seed(); } catch (error) { sentinel.close(); throw error; }
  return async () => {
    await new Promise<void>(resolve => sentinel.close(() => resolve()));
    if (requests) throw new Error(`Simulation contacted live-feed sentinel ${requests} times`);
  };
}
