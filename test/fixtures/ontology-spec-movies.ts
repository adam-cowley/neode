/**
The Neo4j Ontology Graph Specification's example movies documents
(NTS-683), verbatim from the spec's repository
(https://github.com/neo4j/ontology-graph-spec):

- MOVIES_SHORTHAND — the README's example, in the shorthand document form
  (`label`, `key`, `must_exist`, `unique` inline; expanded into
  `labels.identifier` and `constraints` when decoded).
- MOVIES_LONGHAND — the complete testdata example
  (`go/model/testdata/graph-spec-example.json`), with the model-level
  data-source extensions trimmed: tooling metadata the mapper ignores.
*/
export const MOVIES_SHORTHAND = {
  schema: 'https://neo4j.com/docs/ontology-graph-spec/1.1.0/schema.json',
  version: '1',
  id: 'movies',
  name: 'Movies',
  description: 'People and the films they appear in.',
  nodes: {
    Actor: {
      label: 'Actor',
      description: 'A person who performs in films.',
      aliases: ['Performer'],
      properties: {
        id: { type: 'STRING', key: true },
        name: { type: 'STRING', must_exist: true, description: 'Full name.' },
        born: { type: 'INTEGER' },
        tags: { type: 'LIST<STRING>' },
      },
    },
    Movie: {
      label: 'Movie',
      properties: {
        id: { type: 'STRING', key: true },
        genre: { type: 'STRING', one_of: ['DRAMA', 'COMEDY', 'THRILLER'] },
        released: { type: 'ZONED DATETIME' },
        rating: { type: 'FLOAT', unique: true },
      },
    },
  },
  relationships: {
    ACTED_IN: {
      type: 'ACTED_IN',
      description: 'An actor appeared in a film.',
      from: { node: 'Actor', label: 'Actor', min_count: 0 },
      to: { node: 'Movie', label: 'Movie', min_count: 1 },
      properties: { roles: { type: 'STRING' } },
    },
  },
}

export const MOVIES_LONGHAND = {
  schema: 'https://neo4j.com/docs/ontology-graph-spec/1.1.0/schema.json',
  version: '1',
  id: 'test',
  nodes: {
    Actor: {
      aliases: ['Performer'],
      labels: {
        identifier: 'Actor',
        implied: [],
        optional: [],
        extensions: { custom: {} },
      },
      properties: {
        id: {
          type: 'STRING',
          must_exist: false,
          unique: true,
          extensions: { custom: {} },
        },
        name: {
          type: 'STRING',
          aliases: ['fullName', 'label'],
          must_exist: false,
          unique: false,
          extensions: { custom: {} },
        },
      },
      constraints: {},
      extensions: { custom: { note: 'lead role', verified: true }, indexes: {} },
    },
    Movie: {
      labels: {
        identifier: 'Movie',
        implied: [],
        optional: [],
        extensions: { custom: {} },
      },
      properties: {
        id: {
          type: 'STRING',
          must_exist: false,
          unique: true,
          extensions: { custom: {} },
        },
      },
      constraints: {},
      extensions: { custom: {}, indexes: {} },
    },
  },
  relationships: {
    ACTED_IN: {
      type: 'ACTED_IN',
      aliases: ['STARRED_IN'],
      from: { node: 'Actor', label: 'Actor' },
      to: { node: 'Movie', label: 'Movie' },
      properties: {
        roles: {
          type: 'STRING',
          aliases: ['characters'],
          must_exist: false,
          unique: false,
          extensions: { custom: {} },
        },
      },
      constraints: {},
      extensions: { custom: {}, indexes: {} },
    },
  },
}
