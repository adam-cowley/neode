import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { getModel } from '../../../src/meta'
import {
  defineModel,
  extendModel,
  getModelByName,
  getModelsByName,
} from '../../../src/meta/map-schema'
import { PropertyType } from '../../../src/meta/property-schema'
import { Direction } from '../../../src/query'
import { Neode } from '../../../src/neode.service'
import { NeodeError } from '../../../src/errors'

// The registry is global per module graph: use unique names per test
describe('map-schema', () => {
  describe('defineModel', () => {
    it('accepts shorthand string property definitions', () => {
      const Person = defineModel('ShorthandPerson', {
        name: 'string',
        age: 'number',
      })

      const schema = getModel(Person)

      expect(schema.getProperty('name').getType()).toEqual(PropertyType.STRING)
      expect(schema.getProperty('age').getType()).toEqual(PropertyType.NUMBER)
    })

    it('declares named filters — the map-API form of @Filter (NTS-568)', () => {
      const Post = defineModel('FilterMapPost', {
        labels: ['FilterMapPost'],
        id: { type: 'string', primary: true },
        tenant: 'string',
        filters: [
          { name: 'tenant', where: 'node.tenant = $tenant' },
          { name: 'notArchived', where: 'NOT node:Archived', default: false },
        ],
      })

      const schema = getModel(Post)

      // `filters` registers filters — it never becomes a property
      expect(schema.hasProperty('filters')).toBe(false)
      expect(schema.getFilters()).toEqual([
        { name: 'tenant', where: 'node.tenant = $tenant' },
        { name: 'notArchived', where: 'NOT node:Archived', default: false },
      ])
    })

    it('rejects duplicate filter names on a map model — they are the withoutFilters keys', () => {
      expect(() =>
        defineModel('FilterMapDuplicate', {
          id: { type: 'string', primary: true },
          filters: [{ name: 'dup_filter' }, { name: 'dup_filter' }],
        }),
      ).toThrow(NeodeError)
    })

    it('rejects filter names that cannot be Cypher parameters', () => {
      expect(() =>
        defineModel('FilterMapInvalidName', {
          id: { type: 'string', primary: true },
          filters: [{ name: 'bad name' }],
        }),
      ).toThrow(NeodeError)
    })

    it('accepts full form property definitions with options', () => {
      const Person = defineModel('FullFormPerson', {
        id: { type: 'uuid', primary: true },
        name: { type: 'string', unique: true, index: true, required: true },
        secret: { type: 'string', hidden: true, protected: true, readonly: true },
        job: { type: 'string', default: 'unemployed' },
      })

      const schema = getModel(Person)

      const id = schema.getProperty('id')
      expect(id.getType()).toEqual(PropertyType.UUID)
      expect(id.isPrimaryKey()).toEqual(true)
      expect(id.isUnique()).toEqual(true)

      const name = schema.getProperty('name')
      expect(name.isUnique()).toEqual(true)
      expect(name.isIndex()).toEqual(true)
      expect(name.isRequired()).toEqual(true)

      const secret = schema.getProperty('secret')
      expect(secret.isHidden()).toEqual(true)
      expect(secret.isProtected()).toEqual(true)
      expect(secret.isReadonly()).toEqual(true)

      expect(schema.getProperty('job').getDefaultValue()).toEqual('unemployed')
    })

    it('generates a uuid default for uuid properties (parity with @Uuid)', () => {
      const Person = defineModel('UuidDefaultPerson', {
        id: { type: 'uuid', primary: true },
      })

      const value = getModel(Person).getProperty('id').getDefaultValue()()

      expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('uses the model name as the only label by default', () => {
      const Person = defineModel('DefaultLabelPerson', {
        name: 'string',
      })

      expect(getModel(Person).getLabels()).toEqual(['DefaultLabelPerson'])
    })

    it('supports the labels key, sorted', () => {
      const Person = defineModel('MultiLabelPerson', {
        labels: ['Person', 'Employee'],
        name: 'string',
      })

      expect(getModel(Person).getLabels()).toEqual(['Employee', 'Person'])
    })

    it('falls back to ANY for unknown type names', () => {
      const Person = defineModel('UnknownTypePerson', {
        // neode accepts arbitrary type names (they are Joi hints)
        weird: 'name',
      })

      expect(getModel(Person).getProperty('weird').getType()).toEqual(PropertyType.ANY)
    })

    it('maps relationship directions to Direction', () => {
      const Person = defineModel('DirectionPerson', {
        out: {
          type: 'relationship',
          relationship: 'OUT_REL',
          direction: 'out',
          target: 'DirectionPerson',
        },
        in: {
          type: 'relationship',
          relationship: 'IN_REL',
          direction: 'in',
          target: 'DirectionPerson',
        },
        both: {
          type: 'relationship',
          relationship: 'BOTH_REL',
          direction: 'both',
          target: 'DirectionPerson',
        },
      })

      const schema = getModel(Person)

      expect(schema.getRelationship('out').getDirection()).toEqual(Direction.OUTGOING)
      expect(schema.getRelationship('in').getDirection()).toEqual(Direction.INCOMING)
      expect(schema.getRelationship('both').getDirection()).toEqual(Direction.BOTH)
    })

    it('normalises direction case-insensitively and falls back to BOTH when invalid', () => {
      const Person = defineModel('CaseDirectionPerson', {
        upper: {
          type: 'relationship',
          relationship: 'A',
          direction: 'OUT',
          target: 'CaseDirectionPerson',
        },
        invalid: {
          type: 'relationship',
          relationship: 'B',
          direction: 'sideways',
          target: 'CaseDirectionPerson',
        },
      })

      const schema = getModel(Person)

      expect(schema.getRelationship('upper').getDirection()).toEqual(Direction.OUTGOING)
      expect(schema.getRelationship('invalid').getDirection()).toEqual(Direction.BOTH)
    })

    it('treats plural relationship types as many and honours eager', () => {
      const Person = defineModel('ManyPerson', {
        friends: {
          type: 'relationships',
          relationship: 'FRIENDS',
          direction: 'out',
          target: 'ManyPerson',
          eager: true,
        },
        bestFriend: {
          type: 'relationship',
          relationship: 'BEST',
          direction: 'out',
          target: 'ManyPerson',
        },
      })

      const schema = getModel(Person)

      expect(schema.getRelationship('friends').getMany()).toEqual(true)
      expect(schema.getRelationship('friends').getEager()).toEqual(true)
      expect(schema.getRelationship('bestFriend').getMany()).toEqual(false)
    })

    it('resolves forward relationship targets once the target model is defined', () => {
      const Movie = defineModel('ForwardRefMovie', {
        title: 'string',
        actors: {
          type: 'relationships',
          relationship: 'ACTED_IN',
          direction: 'in',
          target: 'ForwardRefPerson',
        },
      })

      const Person = defineModel('ForwardRefPerson', {
        name: 'string',
      })

      expect(getModel(Movie).getRelationship('actors').getTarget()).toBe(Person)
    })

    it('produces a virtual class whose instances resolve in the registry', () => {
      const Person = defineModel('VirtualPerson', {
        name: 'string',
      })

      const instance = new Person() as object

      expect(instance.constructor).toBe(Person)
      expect(getModel(instance.constructor as never)).toBeDefined()
    })

    it('rejects a second registration of the same model name (NTS-652)', () => {
      defineModel('DuplicateNamePerson', { name: 'string' })

      // The registry is process-global: a second registration used to
      // silently orphan the first model's schema (last-wins name index)
      expect(() => defineModel('DuplicateNamePerson', { name: 'string', age: 'number' })).toThrow(
        new RegExp(
          'A model named "DuplicateNamePerson" is already registered.*\\{ idempotent: true \\}',
        ),
      )
    })

    it('re-registration with idempotent: true returns the existing model unchanged (NTS-652)', () => {
      const First = defineModel('IdempotentPerson', { name: 'string' })

      const Second = defineModel(
        'IdempotentPerson',
        { name: 'string', age: 'number' },
        { idempotent: true },
      )

      expect(Second).toBe(First)
      expect(getModelByName('IdempotentPerson')).toBe(First)
      // The existing definition wins — the re-run schema never merges in
      expect(getModel(Second).hasProperty('age')).toBe(false)
    })
  })

  describe('getModelByName / getModelsByName', () => {
    it('looks models up by name', () => {
      const Person = defineModel('ByNamePerson', { name: 'string' })

      expect(getModelByName('ByNamePerson')).toBe(Person)
      expect(getModelByName('Nobody')).toBeUndefined()
    })

    it('lists all defined models by name', () => {
      const Person = defineModel('ListedPerson', { name: 'string' })
      const Movie = defineModel('ListedMovie', { title: 'string' })

      const all = getModelsByName()

      expect(all.get('ListedPerson')).toBe(Person)
      expect(all.get('ListedMovie')).toBe(Movie)
    })
  })

  describe('extendModel', () => {
    it('clones properties and adds the new name as an extra label', () => {
      defineModel('ExtBase', {
        name: 'string',
        knows: { type: 'relationship', relationship: 'KNOWS', direction: 'out', target: 'ExtBase' },
      })

      const Employee = extendModel('ExtBase', 'ExtEmployee', {
        payroll: { type: 'number' },
      })

      const schema = getModel(Employee)

      expect(schema.getLabels()).toEqual(['ExtEmployee', 'ExtBase'].sort())
      expect(schema.getProperty('name').getType()).toEqual(PropertyType.STRING)
      expect(schema.getRelationship('knows').getType()).toEqual('KNOWS')
      expect(schema.getProperty('payroll').getType()).toEqual(PropertyType.NUMBER)

      expect(getModelByName('ExtEmployee')).toBe(Employee)
    })

    it('throws a helpful error when the source model is unknown', () => {
      expect(() => extendModel('ExtSourceMissing', 'ExtClone')).toThrow(
        'Couldn\'t find a definition for "ExtSourceMissing"',
      )
    })

    it('carries the filters over to the clone (NTS-568)', () => {
      defineModel('FilterMapExtBase', {
        id: { type: 'string', primary: true },
        filters: [{ name: 'tenant', where: 'node.tenant = $tenant' }],
      })

      const Extended = extendModel('FilterMapExtBase', 'FilterMapExtClone')

      expect(
        getModel(Extended)
          .getFilters()
          .map((filter) => filter.name),
      ).toEqual(['tenant'])
    })
  })

  describe('Neode facade', () => {
    it("looks up models by name and throws neode's helpful error when unknown", () => {
      const neode = new Neode({} as never)

      expect(() => neode.model('NoSuchModelAnywhere')).toThrow(
        'Couldn\'t find a definition for "NoSuchModelAnywhere"',
      )
      expect(() => neode.model('NoSuchModelAnywhere')).toThrow(
        /The models currently defined are \[/,
      )
    })

    it('defines and returns models through model(name, schema)', () => {
      const neode = new Neode({} as never)

      const Person = neode.model('FacadePerson', { name: 'string' })

      expect(getModel(Person).getProperty('name').getType()).toEqual(PropertyType.STRING)
      expect(neode.model('FacadePerson')).toBe(Person)
    })

    it('defines models in bulk through with()', () => {
      const neode = new Neode({} as never)

      neode.with({
        WithPerson: { name: 'string' },
        WithMovie: { title: 'string' },
      })

      expect(getModel(neode.model('WithPerson')).getProperty('name').getType()).toEqual(
        PropertyType.STRING,
      )
      expect(getModel(neode.model('WithMovie')).getProperty('title').getType()).toEqual(
        PropertyType.STRING,
      )
    })

    it('registers every module in a directory through withDirectory()', () => {
      const directory = mkdtempSync(join(tmpdir(), 'ogm-models-'))

      writeFileSync(join(directory, 'DirPerson.js'), "module.exports = { name: 'string' };")
      // Non-model files are ignored
      writeFileSync(join(directory, 'readme.txt'), 'not a model')

      const neode = new Neode({} as never).withDirectory(directory)

      const Person = neode.model('DirPerson')

      expect(getModel(Person).getProperty('name').getType()).toEqual(PropertyType.STRING)
    })

    it('extends models through extend()', () => {
      const neode = new Neode({} as never)

      neode.model('FacadeExtBase', { name: 'string' })

      const Employee = neode.extend('FacadeExtBase', 'FacadeExtEmployee', {
        payroll: 'number',
      })

      expect(getModel(Employee).getLabels()).toEqual(['FacadeExtEmployee', 'FacadeExtBase'].sort())
    })
  })
})
