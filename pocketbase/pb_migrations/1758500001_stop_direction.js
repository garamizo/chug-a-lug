// A stop knows which way the crawl is heading when it visits: out toward Chicago, or back to
// Aurora. The planner orders the crawl from it (going stops top to bottom, then return stops
// bottom to top) and draws it on that side of the line. Stops from before this field are placed
// by the direction of travel between their neighbours.
migrate((app) => {
  const stops = app.findCollectionByNameOrId('stops')
  stops.fields.add(new SelectField({ name: 'direction', values: ['out', 'back'], maxSelect: 1 }))
  app.save(stops)
}, (app) => {
  try {
    const stops = app.findCollectionByNameOrId('stops')
    stops.fields.removeByName('direction')
    app.save(stops)
  } catch (_) {}
})
