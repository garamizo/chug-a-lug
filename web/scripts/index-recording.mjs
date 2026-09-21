#!/usr/bin/env node
// Existing v1: inspect NAME. Legacy: require the known matching zip, original date and UTC window.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { indexLegacy, inspectSnapshots, loadRecording, validRecordingId } from '../src/lib/server/metra/recording.ts';
import { recordingCopy } from '../src/lib/labels.ts';
const [recordingId, zipPath, serviceDate, windowStart, windowEnd] = process.argv.slice(2);
const count = process.argv.length - 2;
if (!recordingId || !validRecordingId(recordingId) || ![1, 5].includes(count)) {
  console.error(recordingCopy.indexUsage); process.exit(1);
}
try {
  const root = join(fileURLToPath(new URL('../../', import.meta.url)), 'data/recordings');
  if (count === 5) {
    await indexLegacy(root, { recordingId, serviceDate, windowStart, windowEnd }, await readFile(resolve(zipPath)));
    console.log(recordingCopy.indexed);
  }
  const index = await loadRecording(root, recordingId);
  console.log(JSON.stringify({ recordingId, observationsAvailable: index.manifest.observationsAvailable,
    ...index.diagnostics, ...await inspectSnapshots(index) }, null, 2));
} catch {
  console.error(recordingCopy.invalid); process.exitCode = 1;
}
