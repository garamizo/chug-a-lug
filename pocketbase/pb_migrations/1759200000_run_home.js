// The run home: a route's closing leg goes from the last stop back to the Board at station, so it
// has no to_stop (mirror of the opening leg's missing from_stop). `reason` says why a leg is
// impossible when the cause is not a missing train (e.g. 'after_midnight'). Routes that never had
// a Board at station get Aurora, the crew's home station, so every route has somewhere to ride home to.
migrate((app) => {
  const legs = app.findCollectionByNameOrId('legs')
  legs.fields.getByName('to_stop').required = false
  legs.fields.add(new TextField({ name: 'reason', max: 32 }))
  app.save(legs)
  app.db().newQuery("UPDATE itineraries SET start_station = 'AURORA', start_station_name = 'Aurora' WHERE start_station = ''").execute()
}, (app) => {
  const legs = app.findCollectionByNameOrId('legs')
  app.db().newQuery("DELETE FROM legs WHERE to_stop = ''").execute()
  legs.fields.removeByName('reason')
  legs.fields.getByName('to_stop').required = true
  app.save(legs)
})
