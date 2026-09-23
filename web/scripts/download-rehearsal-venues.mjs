import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildSchedule, unzipGtfs } from '../src/lib/metra/gtfs.ts';
import { rehearsalVenues } from './rehearsal-venues.mjs';
const schedule = buildSchedule(unzipGtfs(await readFile(process.argv[2])), '');
const stations = ['AURORA', 'NAPERVILLE', 'LISLE', 'MAINST-DG', 'CLARNDNHIL', 'LAGRANGE'].map(id => {
  const station = schedule.stations.get(id);
  if (!station) throw new Error(`Missing station ${id}`);
  return station;
});
const stops = await rehearsalVenues(stations, resolve(import.meta.dirname, '../../data/rehearsal/source/venues'));
console.log(stops.map(s => `${s.station_name}: ${s.name} (${s.photos.length} photos)`).join('\n'));
