// State is provisioned only by the isolated rehearsal launcher; normal installs stay inactive.
migrate((app) => {
  const clock = new Collection({
    type: 'base', name: 'simulation_clock',
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'run_id', type: 'text', required: true, max: 64, pattern: '^[A-Za-z0-9_-]+$' },
      { name: 'revision', type: 'number', onlyInt: true, required: true, min: 1 },
      { name: 'epoch_start', type: 'date', required: true },
      { name: 'wall_start', type: 'date', required: true },
      { name: 'rate', type: 'number', onlyInt: true, min: 0, max: 60 },
      { name: 'resume_rate', type: 'number', onlyInt: true, required: true, min: 1, max: 60 },
      { name: 'service_date', type: 'text', required: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      { name: 'source', type: 'select', values: ['recording', 'timetable'], maxSelect: 1, required: true },
      { name: 'recording_id', type: 'text', max: 64, pattern: '^[A-Za-z0-9_-]*$' },
      { name: 'window_start', type: 'date', required: true },
      { name: 'window_end', type: 'date', required: true }
    ]
  })
  app.save(clock)
  clock.fields.getByName('id').pattern = '^simulationclock$'
  clock.fields.getByName('id').autogeneratePattern = 'simulationclock'
  app.save(clock)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('simulation_clock'))
})
