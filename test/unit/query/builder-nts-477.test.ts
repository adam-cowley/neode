import { describe, expect, it } from 'vitest'
import { Builder, Direction } from '../../../src/query'
import { NeodeError } from '../../../src/errors'

// NTS-477 — ORDER BY / LIMIT attached to a WITH clause, expressing a
// mid-query sort before a write (read-modify-write shape)
describe('Builder withOrder / withLimit', () => {
  it('renders ORDER BY / LIMIT after the WITH and before the write', () => {
    const builder = new Builder()
    const { query } = builder
      .match('u', 'User')
      .relationship('ENROLMENT', Direction.OUTGOING, 'e')
      .to('c', 'Course')
      .with('u', 'e', 'c', 'totalCount')
      .withOrder('coalesce(e.updatedAt, e.createdAt)', 'DESC')
      .withLimit(1)
      .set('e:CompletedEnrolment')
      .return('u', 'e')
      .build()

    expect(query).toBe(
      [
        'MATCH (u:User)-[e:`ENROLMENT`]->(c:Course)',
        'WITH u, e, c, totalCount',
        'ORDER BY coalesce(e.updatedAt, e.createdAt) DESC',
        'LIMIT 1',
        'SET e:CompletedEnrolment',
        'RETURN u, e',
      ].join('\n'),
    )
  })

  it('supports the orderBy forms', () => {
    const fieldAndDirection = new Builder()
      .match('n')
      .with('n')
      .withOrder('n.name', 'DESC')
      .return('n')

    expect(fieldAndDirection.build().query).toBe(
      'MATCH (n)\nWITH n\nORDER BY n.name DESC\nRETURN n',
    )

    const objectMap = new Builder().match('n').with('n').withOrder({ 'n.name': 'ASC' }).return('n')

    expect(objectMap.build().query).toBe('MATCH (n)\nWITH n\nORDER BY n.name ASC\nRETURN n')

    const descriptors = new Builder()
      .match('n')
      .with('n')
      .withOrder([
        { field: 'n.name', order: 'ASC' },
        { field: 'n.age', order: 'DESC' },
      ])
      .return('n')
      .build()

    expect(descriptors.query).toBe('MATCH (n)\nWITH n\nORDER BY n.name ASC, n.age DESC\nRETURN n')
  })

  it('supports withLimit without an order', () => {
    const { query } = new Builder().match('n').with('n').withLimit(5).return('n').build()

    expect(query).toBe('MATCH (n)\nWITH n\nLIMIT 5\nRETURN n')
  })

  it('attaches to the most recent with()', () => {
    const { query } = new Builder()
      .match('n')
      .with('n')
      .with('m')
      .withOrder('m.score', 'DESC')
      .withLimit(2)
      .return('n', 'm')
      .build()

    expect(query).toBe(
      ['MATCH (n)', 'WITH n', 'WITH m\nORDER BY m.score DESC\nLIMIT 2', 'RETURN n, m'].join('\n'),
    )
  })

  it('rejects withOrder / withLimit without a preceding with()', () => {
    expect(() => new Builder().match('n').withOrder('n.name')).toThrow(NeodeError)
    expect(() => new Builder().match('n').withLimit(1)).toThrow(NeodeError)
  })

  it('rejects withOrder after the WITH is no longer the last clause', () => {
    expect(() => new Builder().match('n').with('n').match('m').withOrder('n.name').build()).toThrow(
      NeodeError,
    )
  })

  // Regression guards: plain orderBy / limit / skip keep their
  // RETURN-position behaviour
  describe('return-position order and limit unchanged', () => {
    it('renders orderBy after RETURN', () => {
      const { query } = new Builder()
        .match('n', 'Person')
        .orderBy('n.name', 'DESC')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n.name DESC')
    })

    it('renders skip and limit after RETURN', () => {
      const { query } = new Builder().match('n', 'Person').return('n').skip(10).limit(5).build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nSKIP 10\nLIMIT 5')
    })
  })
})
