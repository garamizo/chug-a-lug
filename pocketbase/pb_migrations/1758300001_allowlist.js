migrate((app) => {
  app.save(new Collection({
    type: 'base', name: 'allowlist',
    fields: [
      { type: 'text', name: 'phone', required: true, max: 12, pattern: '^\\+1[0-9]{10}$' },
      { type: 'text', name: 'name', required: true, max: 64 },
      { type: 'bool', name: 'is_admin' },
      { type: 'autodate', name: 'created', onCreate: true },
      { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_allowlist_phone ON allowlist (phone)'],
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  }))
}, (app) => app.delete(app.findCollectionByNameOrId('allowlist')))
