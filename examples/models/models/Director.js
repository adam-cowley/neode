module.exports = {
  labels: ['Movie', 'Person'],

  birthday: 'string',
  birthplace: 'string',
  name: {
    type: 'string',
    index: true,
  },
  lastModified: 'string',
  id: 'string',
  biography: 'string',
  version: 'number',
  profileImageUrl: { type: 'string', uri: true },

  directed: {
    type: 'relationship',
    target: 'Movie',
    relationship: 'DIRECTED',
    direction: 'out',
    properties: {
      name: 'string',
    },
  },
}
