// PocketBase cannot call back into a web request that may be waiting for this hook.
// Read the same persisted singleton and use the shared clock-vector arithmetic locally.
module.exports.eventNow = function (app, wallNow) {
  const wall = wallNow || new Date()
  if ($os.getenv('SIM') !== '1') return wall.toISOString()
  const row = app.findRecordById('simulation_clock', 'simulationclock')
  const instant = (key) => {
    const value = String(row.get(key)).replace(' ', 'T')
    const date = new Date(value)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) ||
        !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error('invalid_clock')
    return date.getTime()
  }
  const start = instant('epoch_start'), origin = instant('wall_start')
  const lower = instant('window_start'), upper = instant('window_end')
  const rate = row.get('rate'), revision = row.get('revision')
  if (![0, 1, 5, 10, 30, 60].includes(rate) || ![1, 5, 10, 30, 60].includes(row.get('resume_rate')) ||
      !Number.isSafeInteger(revision) || revision < 1 || lower >= upper || start < lower || start > upper ||
      row.get('run_id') !== $os.getenv('SIM_RUN_ID')) throw new Error('invalid_clock')
  const source = row.get('source'), recording = row.get('recording_id')
  if ((source !== 'recording' && source !== 'timetable') ||
      (source === 'recording' && !/^[A-Za-z0-9_-]{1,64}$/.test(recording)) ||
      (source === 'timetable' && recording)) throw new Error('invalid_clock')
  const service = row.get('service_date')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(service) || new Date(service + 'T00:00:00Z').toISOString().slice(0, 10) !== service) throw new Error('invalid_clock')
  return new Date(Math.min(upper, start + Math.max(0, wall.getTime() - origin) * rate)).toISOString()
}
