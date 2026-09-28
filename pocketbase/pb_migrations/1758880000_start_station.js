// Where the crew boards. Empty keeps the old meaning of Start (the arrival at stop 1). The ride from
// here to stop 1 is the route's opening leg: a legs row with no from_stop.
migrate((app) => {
  const itineraries = app.findCollectionByNameOrId('itineraries')
  itineraries.fields.add(new TextField({ name: 'start_station', max: 32 }))
  itineraries.fields.add(new TextField({ name: 'start_station_name', max: 80 }))
  app.save(itineraries)
  const legs = app.findCollectionByNameOrId('legs')
  legs.fields.getByName('from_stop').required = false
  app.save(legs)
}, (app) => {
  const legs = app.findCollectionByNameOrId('legs')
  app.db().newQuery("DELETE FROM legs WHERE from_stop = ''").execute()
  legs.fields.getByName('from_stop').required = true
  app.save(legs)
  const itineraries = app.findCollectionByNameOrId('itineraries')
  itineraries.fields.removeByName('start_station')
  itineraries.fields.removeByName('start_station_name')
  app.save(itineraries)
})
