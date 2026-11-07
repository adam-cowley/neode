// The backend import loads neode.service first, resolving the
// query.service -> utils -> neode.service module cycle before the
// query services below are evaluated
import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode, WithMethods } from '../../src/entity-methods'
import { NodeEntity, InternalId, String, Uuid } from '../../src/decorators'
import { Builder } from '../../src/query'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

@NodeEntity()
class Enrolment {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  course: string
}

// ---------------------------------------------------------------------------

describe('Labels as state lifecycle', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  const saveEnrolment = async (course: string): Promise<WithMethods<Enrolment>> =>
    (await backend.neode.save(
      await backend.neode.create(Enrolment, { course }),
    )) as WithMethods<Enrolment>

  describe('addLabel / removeLabel', () => {
    it('sets the label on the node and refreshes the instance', async () => {
      const enrolment = await saveEnrolment('Neo4j 101')

      const returned = await enrolment.addLabel('Completed')

      expect(returned).toBe(enrolment)

      const result = await backend.neode.readCypher(
        'MATCH (e:Enrolment:Completed) RETURN count(e) AS n',
      )

      expect(Number(result.records[0].get('n'))).toEqual(1)
    })

    it('removes the label again, keeping the node', async () => {
      const enrolment = await saveEnrolment('Neo4j 101')

      await enrolment.addLabel('Completed')
      await enrolment.removeLabel('Completed')

      const labelled = await backend.neode.readCypher(
        'MATCH (e:Enrolment:Completed) RETURN count(e) AS n',
      )

      expect(Number(labelled.records[0].get('n'))).toEqual(0)

      const node = await backend.neode.readCypher('MATCH (e:Enrolment) RETURN count(e) AS n')

      expect(Number(node.records[0].get('n'))).toEqual(1)
    })

    it('rejects a label on an unsaved entity', async () => {
      const enrolment = new Enrolment()

      await expect(enrolment.addLabel('Completed')).rejects.toThrow(/elementId/i)
    })
  })

  describe('whereLabel', () => {
    it('filters by the label in a live query', async () => {
      const completed = await saveEnrolment('Neo4j 101')
      const open = await saveEnrolment('Neo4j 201')

      await completed.addLabel('Completed')

      const builder = new Builder().match('e', 'Enrolment').whereLabel('e', 'Completed')

      const { query, params } = builder.return('e.course AS course').build()
      const result = await backend.neode.readCypher(query, params)

      expect(result.records.map((record) => record.get('course'))).toEqual(['Neo4j 101'])

      // and the negated form returns the other one
      const negated = new Builder()
        .match('e', 'Enrolment')
        .whereLabel('e', 'Completed', true)
        .return('e.course AS course')
        .build()

      const negatedResult = await backend.neode.readCypher(negated.query, negated.params)

      expect(negatedResult.records.map((record) => record.get('course'))).toEqual([open.course])
    })
  })

  describe('soft delete', () => {
    it('sets the label instead of deleting and returns the refreshed entity', async () => {
      const enrolment = await saveEnrolment('Neo4j 101')

      const returned = await enrolment.delete({ soft: 'DeletedEnrolment' })

      expect(returned).toBe(enrolment)

      const deleted = await backend.neode.readCypher(
        'MATCH (e:DeletedEnrolment) RETURN count(e) AS n',
      )

      expect(Number(deleted.records[0].get('n'))).toEqual(1)

      // the node itself survives
      const nodes = await backend.neode.readCypher('MATCH (e:Enrolment) RETURN count(e) AS n')

      expect(Number(nodes.records[0].get('n'))).toEqual(1)
    })

    it('soft deletes through neode.delete without removing the node', async () => {
      const enrolment = await saveEnrolment('Neo4j 101')

      await backend.neode.delete(enrolment, { soft: 'ArchivedEnrolment' })

      const archived = await backend.neode.readCypher(
        'MATCH (e:ArchivedEnrolment) RETURN count(e) AS n',
      )

      expect(Number(archived.records[0].get('n'))).toEqual(1)

      const nodes = await backend.neode.readCypher('MATCH (e:Enrolment) RETURN count(e) AS n')

      expect(Number(nodes.records[0].get('n'))).toEqual(1)
    })
  })
})
