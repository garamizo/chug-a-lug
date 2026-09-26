// Planner chat takes photos and videos, like Live: a comment is text, a file, or both.
migrate((app) => {
  const comments = app.findCollectionByNameOrId('comments')
  comments.fields.getByName('body').required = false
  comments.fields.add(new FileField({
    name: 'file', maxSelect: 1, maxSize: 94371840, thumbs: ['400x300', '1200x0'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']
  }))
  app.save(comments)
}, (app) => {
  const comments = app.findCollectionByNameOrId('comments')
  app.db().newQuery("DELETE FROM comments WHERE body = '' OR body IS NULL").execute()
  comments.fields.removeByName('file')
  comments.fields.getByName('body').required = true
  app.save(comments)
})
