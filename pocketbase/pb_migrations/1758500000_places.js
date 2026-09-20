// Places: one record per Google / OpenStreetMap venue, written only by the SvelteKit server. The
// nearby lookup fills the basics (name, kind, location, rating); the first attach adds details and
// photos. Every stop in every draft then points at the same record, so a venue is fetched once.
// place_lookups remembers which stations have been searched, so a station with nothing nearby is
// not searched again either.
migrate((app) => {
  const U = "@request.auth.id != ''"

  const places = new Collection({
    type: 'base',
    name: 'places',
    listRule: U,
    viewRule: U,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'ref', type: 'text', required: true, max: 240 }, // "google:<place_id>" or "osm:<type/id>"
      { name: 'source', type: 'select', values: ['google', 'osm'], maxSelect: 1, required: true },
      { name: 'place_id', type: 'text', max: 200 },
      { name: 'osm_id', type: 'text', max: 40 },
      { name: 'name', type: 'text', required: true, max: 120 },
      { name: 'kind', type: 'select', values: ['bar', 'restaurant', 'other'], maxSelect: 1 },
      { name: 'lat', type: 'number' },
      { name: 'lon', type: 'number' },
      { name: 'address', type: 'text', max: 200 },
      { name: 'rating', type: 'number' },
      { name: 'rating_count', type: 'number', onlyInt: true },
      { name: 'hours', type: 'json', maxSize: 20000 },
      { name: 'phone', type: 'text', max: 40 },
      { name: 'website', type: 'text', max: 300 },
      { name: 'maps_url', type: 'text', max: 300 },
      { name: 'station_id', type: 'text', max: 32 },
      { name: 'distance_m', type: 'number', onlyInt: true },
      { name: 'photos', type: 'file', maxSelect: 5, maxSize: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], thumbs: ['400x300', '800x0'] },
      { name: 'photo_refs', type: 'json', maxSize: 5000 }, // Google photo resource names, fetched on attach
      { name: 'photo_attributions', type: 'json', maxSize: 5000 },
      { name: 'details_at', type: 'date' },
      { name: 'fetched_at', type: 'date' },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_places_ref ON places (ref)',
      'CREATE INDEX idx_places_station ON places (station_id)'
    ]
  })
  app.save(places)

  const lookups = new Collection({
    type: 'base',
    name: 'place_lookups',
    listRule: U,
    viewRule: U,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'station_id', type: 'text', required: true, max: 32 },
      { name: 'source', type: 'select', values: ['google', 'osm'], maxSelect: 1, required: true },
      { name: 'count', type: 'number', onlyInt: true },
      { name: 'fetched_at', type: 'date' }
    ],
    indexes: ['CREATE UNIQUE INDEX idx_place_lookups_station ON place_lookups (station_id)']
  })
  app.save(lookups)

  const stops = app.findCollectionByNameOrId('stops')
  stops.fields.add(new RelationField({ name: 'place', collectionId: places.id, maxSelect: 1 }))
  app.save(stops)
}, (app) => {
  try {
    const stops = app.findCollectionByNameOrId('stops')
    stops.fields.removeByName('place')
    app.save(stops)
  } catch (_) {}
  for (const name of ['place_lookups', 'places']) {
    try { app.delete(app.findCollectionByNameOrId(name)) } catch (_) {}
  }
})
