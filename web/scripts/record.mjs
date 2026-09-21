#!/usr/bin/env node
// Records real observations on their original service date; never rebases or resets a recording.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createRecording, validRecordingId, atomicRecordingWrite, appendPoll } from '../src/lib/server/metra/recording.ts';
import { createRecorder } from '../src/lib/server/metra/recorder.ts';
import { recordingCopy } from '../src/lib/labels.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const [recordingId, serviceDate, windowStart, windowEnd, ...extra] = process.argv.slice(2);
if (!recordingId || !validRecordingId(recordingId) || !serviceDate || !windowStart || !windowEnd || extra.length) {
  console.error(recordingCopy.recordUsage); process.exit(1);
}
try {
  let fileEnv = {};
  try { fileEnv = parseEnv(await readFile(join(root, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const env = { ...fileEnv, ...process.env };
  if (!env.METRA_API_TOKEN) throw new Error(recordingCopy.noToken);
  if (!(Date.parse(windowStart) <= Date.now() && Date.now() < Date.parse(windowEnd))) throw new Error(recordingCopy.outsideWindow);
  const source = new URL(env.GTFS_URL || 'https://schedules.metrarail.com/gtfs/schedule.zip');
  let zip;
  if (source.protocol === 'file:') zip = await readFile(source);
  else {
    if (!['http:', 'https:'].includes(source.protocol)) throw new Error(recordingCopy.invalid);
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(recordingCopy.failed);
    zip = new Uint8Array(await response.arrayBuffer());
  }
  const { dir, manifest } = await createRecording(join(root, 'data/recordings'), { recordingId, serviceDate, windowStart, windowEnd }, zip);
  const recorder = createRecorder({ base: env.METRA_RT_BASE || 'https://gtfspublic.metrarr.com/gtfs/public', token: env.METRA_API_TOKEN,
    saveSnapshot: (file, bytes) => atomicRecordingWrite(dir, file, bytes),
    appendObservation: observation => appendPoll(dir, manifest, observation) });
  let timer, stopping = false, current = Promise.resolve();
  async function stop(failed = false) {
    if (failed) process.exitCode = 1;
    if (stopping) return;
    stopping = true; clearInterval(timer);
    await current.catch(() => { failed = true; process.exitCode = 1; });
    console.log(failed ? recordingCopy.failed : recordingCopy.stopped);
    if (failed) process.exitCode = 1;
  }
  function poll() {
    if (stopping) return;
    if (Date.now() >= Date.parse(manifest.windowEnd)) { void stop(); return; }
    current = recorder.tick();
    void current.then(() => console.log(JSON.stringify({ recordingId, snapshots: recorder.snapshotsWritten() })), () => stop(true));
  }
  process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
  console.log(recordingCopy.started);
  // Register before the first poll so a window that closed during setup can clear it.
  timer = setInterval(poll, recorder.pollMs); poll();
} catch (error) {
  // Only our fixed messages may leave this process; fetch errors can include secrets/URLs.
  console.error(Object.values(recordingCopy).includes(error.message) ? error.message : recordingCopy.failed);
  process.exitCode = 1;
}
