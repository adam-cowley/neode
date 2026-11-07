module.exports = {
  birthday: 'string',
  birthplace: 'string',
  name: 'string',
  lastModified: 'string',
  id: 'string',
  biography: 'string',
  version: 'number',
  profileImageUrl: { type: 'string', uri: true },

  acts_in: {
    type: 'relationship',
    target: 'Movie',
    relationship: 'ACTS_IN',
    direction: 'out',
    properties: {
      name: 'string',
    },
  },
}
