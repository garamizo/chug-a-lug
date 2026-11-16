// Cheers on the event clock: `at` is stamped by the server like every other live row (pb_hooks/live.pb.js),
// so a rehearsal's Cheers land on the rehearsal's day while `created` stays wall time. Earlier Cheers
// take their creation time, which was the event time outside a rehearsal.
migrate((app) => {
  const reactions = app.findCollectionByNameOrId('reactions')
  reactions.fields.add(new DateField({ name: 'at' }))
  app.save(reactions)
  app.db().newQuery('UPDATE reactions SET at = created').execute()
}, (app) => {
  const reactions = app.findCollectionByNameOrId('reactions')
  reactions.fields.removeByName('at')
  app.save(reactions)
})
