import { NodeEntity, Property, OneToOne } from '../../../src/decorators'
import { getModel } from '../../../src/meta'
import { defineModel, extendModel } from '../../../src/meta/map-schema'
import { ontology, ontologyMarkdown } from '../../../src/meta/ontology'
import { Direction } from '../../../src/query'
import { Neode } from '../../../src/neode.service'

// The registry is global per module graph: use unique names per test
function findEntity(name: string) {
  const entity = ontology().entities.find((entity) => entity.name === name)

  expect(entity).toBeDefined()

  return entity!
}

// Map API models (NTS-445)
const Person = defineModel('OntologyPerson', {
  description: 'A human being in the graph',
  name: { type: 'string', required: true, unique: true, index: true, description: 'Legal name' },
  age: 'number',
  knows: {
    type: 'relationship',
    relationship: 'KNOWS',
    direction: 'out',
    target: 'OntologyPerson',
    description: 'Someone this person knows',
  },
})

// Decorator models (NTS-445) — the relationship target is declared first:
// @NodeEntity replays field registrations eagerly, invoking target()
@NodeEntity()
class OntologyHuman {
  name: string
}

@NodeEntity({ description: 'A film in the catalogue' })
class OntologyMovie {
  @Property({ type: 'string', description: 'Display title' })
  title: string

  @OneToOne({
    type: 'DIRECTED',
    target: () => OntologyHuman,
    direction: Direction.OUTGOING,
    description: 'The director of the film',
  })
  director: OntologyHuman
}

describe('ontology (NTS-445)', () => {
  describe('map API descriptions', () => {
    it('stores the entity-level description and never treats it as a property', () => {
      const entity = findEntity('OntologyPerson')

      expect(entity.description).toEqual('A human being in the graph')
      expect(getModel(Person).hasProperty('description')).toEqual(false)
    })

    it('stores property descriptions from full-form definitions', () => {
      const entity = findEntity('OntologyPerson')
      const name = entity.properties.find((property) => property.name === 'name')

      expect(name?.description).toEqual('Legal name')
    })

    it('leaves the description undefined for shorthand properties', () => {
      const entity = findEntity('OntologyPerson')
      const age = entity.properties.find((property) => property.name === 'age')

      expect(age?.description).toBeUndefined()
    })

    it('stores relationship descriptions', () => {
      const entity = findEntity('OntologyPerson')
      const knows = entity.relationships.find((relationship) => relationship.name === 'knows')

      expect(knows?.description).toEqual('Someone this person knows')
    })
  })

  describe('decorator descriptions', () => {
    it('stores the model description from @NodeEntity config', () => {
      expect(findEntity('OntologyMovie').description).toEqual('A film in the catalogue')
    })

    it('stores property descriptions from @Property config', () => {
      const title = findEntity('OntologyMovie').properties.find(
        (property) => property.name === 'title',
      )

      expect(title?.description).toEqual('Display title')
    })

    it('stores relationship descriptions from @OneToOne config', () => {
      const director = findEntity('OntologyMovie').relationships.find(
        (relationship) => relationship.name === 'director',
      )

      expect(director?.description).toEqual('The director of the film')
      expect(director?.relationship).toEqual('DIRECTED')
    })

    it('leaves the description undefined when no config gives one', () => {
      expect(findEntity('OntologyHuman').description).toBeUndefined()
    })
  })

  describe('ontology()', () => {
    it('emits the full JSON shape for a map-defined model', () => {
      const entity = findEntity('OntologyPerson')

      expect(entity.labels).toEqual(['OntologyPerson'])
      expect(entity.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'name',
            type: 'string',
            required: true,
            unique: true,
            indexed: true,
            description: 'Legal name',
          }),
          expect.objectContaining({
            name: 'age',
            type: 'number',
            required: false,
            unique: false,
            indexed: false,
          }),
        ]),
      )
      expect(entity.relationships).toEqual([
        expect.objectContaining({
          name: 'knows',
          relationship: 'KNOWS',
          direction: 'out',
          target: 'OntologyPerson',
          description: 'Someone this person knows',
        }),
      ])
    })

    it('covers every registered model, decorator and map defined alike', () => {
      const names = ontology().entities.map((entity) => entity.name)

      expect(names).toContain('OntologyPerson')
      expect(names).toContain('OntologyMovie')
    })
  })

  describe('ontologyMarkdown()', () => {
    it('renders headings, properties and relationships with descriptions', () => {
      const markdown = ontologyMarkdown()

      expect(markdown).toContain('# Graph ontology')
      expect(markdown).toContain('## OntologyPerson')
      expect(markdown).toContain('A human being in the graph')
      expect(markdown).toContain('`name` (string, required, unique, indexed): Legal name')
      expect(markdown).toContain('`age` (number)')
      expect(markdown).toContain('`knows` :KNOWS out -> OntologyPerson: Someone this person knows')
    })
  })

  describe('extendModel', () => {
    it('preserves entity, property and relationship descriptions', () => {
      extendModel('OntologyPerson', 'OntologyEmployee', {
        payroll: { type: 'number', description: 'Monthly pay' },
      })

      const entity = findEntity('OntologyEmployee')

      expect(entity.description).toEqual('A human being in the graph')
      expect(entity.properties.find((property) => property.name === 'name')?.description).toEqual(
        'Legal name',
      )
      expect(
        entity.properties.find((property) => property.name === 'payroll')?.description,
      ).toEqual('Monthly pay')
      expect(
        entity.relationships.find((relationship) => relationship.name === 'knows')?.description,
      ).toEqual('Someone this person knows')
    })
  })

  describe('Neode facade', () => {
    it('delegates ontology() and ontologyMarkdown() to the module', () => {
      const neode = new Neode({} as never)

      expect(
        neode.ontology().entities.find((entity) => entity.name === 'OntologyPerson'),
      ).toBeDefined()
      expect(neode.ontologyMarkdown()).toContain('## OntologyPerson')
    })
  })
})
