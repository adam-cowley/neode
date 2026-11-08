import { describe, expect, it, vi } from 'vitest'
import { NodeEntity, OneToMany, Property } from '../../../src/decorators'
import { Direction, Builder } from '../../../src/query'
import { projectionNode, loadSpecCalls } from '../../../src/projection'
import { defineModel } from '../../../src/meta/map-schema.js'
import { getModel } from '../../../src/meta/index.js'
import { EntitySchema } from '../../../src/meta/entity/entity-schema'
import { RelationshipPropertySchema } from '../../../src/meta/relationship-property-schema'
import { CreateService } from '../../../src/services/query/create.service'
import { MergeService } from '../../../src/services/query/merge.service'
import { RelateService } from '../../../src/services/query/relate.service'
import { getOtherProperty } from '../../../src/services/write-utilities'
import { NeodeError } from '../../../src/errors/index'
import type { Runner } from '../../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Nts483Movie {
  @Property({ type: 'string' })
  title!: string
}

@NodeEntity()
class Nts483Viewer {
  @Property({ type: 'string' })
  name!: string

  // Eager BOTH: projected into every read of the model
  @OneToMany(() => Nts483Movie, 'LIKES', Direction.BOTH, true)
  likes!: Nts483Movie[]

  // Non-eager BOTH: rendered when requested through the `with` load spec
  @OneToMany(() => Nts483Movie, 'WATCHED', Direction.BOTH)
  watched!: Nts483Movie[]
}

// Map-API fixtures for the write paths (direction 'both' through the map API)
defineModel('Nts483Pet', { name: 'string' })

const Nts483Owner = defineModel('Nts483Owner', {
  name: 'string',
  pets: {
    type: 'relationships',
    relationship: 'OWNS',
    direction: 'both',
    target: 'Nts483Pet',
  },
})

const normalise = (query: string): string => query.replaceAll(/\s+/g, ' ').trim()

describe('NTS-483: Direction.BOTH renders an undirected match pattern', () => {
  it('Builder.relationship() renders BOTH without arrows', () => {
    const { query } = new Builder()
      .match('n', 'Person')
      .relationship('LIKES', Direction.BOTH, 'r')
      .to('m', 'Person')
      .return('n')
      .build()

    expect(query).toBe('MATCH (n:Person)-[r:`LIKES`]-(m:Person)\nRETURN n')
  })

  it('an eager BOTH relationship projects undirected in the read query', () => {
    const schema = getModel(Nts483Viewer)!
    const query = normalise(projectionNode('this', schema))

    expect(query).toContain('(this)-[this_likes_rel:`LIKES`]-(this_likes_node:Nts483Movie)')
  })

  it('a BOTH relationship requested through the with load spec renders undirected in the CALL subquery', () => {
    const builder = new Builder().match('this', 'Nts483Viewer')

    loadSpecCalls(builder, 'this', getModel(Nts483Viewer)!, { watched: () => {} })

    builder.return(`${projectionNode('this', getModel(Nts483Viewer)!)} AS this`)

    const query = normalise(builder.build().query)

    expect(query).toContain('(this)-[this_watched_rel:`WATCHED`]-(this_watched_node:Nts483Movie)')
  })

  it('the map API accepts direction "both" and stores it as Direction.BOTH', () => {
    const schema = getModel(Nts483Owner)!

    expect(schema.getRelationship('pets').getDirection()).toBe(Direction.BOTH)
  })
})

describe('NTS-483: write paths reject BOTH (undirected is match-only)', () => {
  const runner = (): Runner => ({
    run: vi.fn(() =>
      Promise.resolve({
        records: [
          {
            get: (key: string) => (key === '__id' ? '4:nts-483' : undefined),
            has: (key: string) => key === '__id',
            keys: ['__id'],
          },
        ],
      }),
    ),
  })

  it('relate() throws a NeodeError naming the fix', async () => {
    const schema = getModel(Nts483Owner)!

    const attempt = new RelateService(runner()).relate(
      schema,
      { name: 'Adam' },
      { name: 'Rex' },
      schema.getRelationship('pets'),
    )

    await expect(attempt).rejects.toBeInstanceOf(NeodeError)
    await expect(attempt).rejects.toThrow(/"pets"/)
    await expect(attempt).rejects.toThrow(/match-only/)
    await expect(attempt).rejects.toThrow(/OUTGOING or INCOMING/)
  })

  it('create() throws when a BOTH relationship carries a value', async () => {
    const schema = getModel(Nts483Owner)!

    const attempt = new CreateService(runner()).create(schema, {
      name: 'Adam',
      pets: [{ name: 'Rex' }],
    })

    await expect(attempt).rejects.toBeInstanceOf(NeodeError)
    await expect(attempt).rejects.toThrow(/match-only/)
  })

  it('save() throws when a BOTH relationship carries a value', async () => {
    const schema = getModel(Nts483Owner)!

    const attempt = new MergeService(runner()).save(
      { name: 'Adam', pets: [{ name: 'Rex' }] },
      schema,
    )

    await expect(attempt).rejects.toBeInstanceOf(NeodeError)
    await expect(attempt).rejects.toThrow(/match-only/)
  })

  it('relationship-entity targets get the same error from getOtherProperty', () => {
    const relationship = new RelationshipPropertySchema('WROTE')
    relationship.setType('WROTE')
    relationship.setDirection(Direction.BOTH)
    relationship.setTarget(Nts483Movie)

    expect(() => getOtherProperty(relationship, new EntitySchema(), Nts483Movie)).toThrow(
      NeodeError,
    )
    expect(() => getOtherProperty(relationship, new EntitySchema(), Nts483Movie)).toThrow(
      /match-only/,
    )
  })
})
