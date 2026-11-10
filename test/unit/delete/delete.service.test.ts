import { describe, expect, it } from 'vitest'
import { getModel } from '../../../src/meta/index.js'
import { defineModel } from '../../../src/meta/map-schema.js'
import { DeleteService } from '../../../src/services/query/delete.service.js'
import { FakeRunner } from './fake-runner.js'

const Membership = defineModel('Nts634DeleteMembership', {
  id: { type: 'string', primary: true },
})

const Form = defineModel('Nts634DeleteForm', {
  id: { type: 'string', primary: true },
  tenantId: { type: 'string' },
  ASSIGNED_TO: {
    type: 'relationships',
    relationship: 'ASSIGNED_TO',
    direction: 'out',
    target: 'Nts634DeleteMembership',
  },
  OWNS: {
    type: 'relationships',
    relationship: 'OWNS',
    direction: 'out',
    target: 'Nts634DeleteMembership',
    cascade: true,
  },
})

const SoftForm = defineModel('Nts634DeleteSoftForm', {
  id: { type: 'string', primary: true },
})

getModel(SoftForm).setSoftDelete('Deleted')

const schema = getModel(Form)

describe('DeleteService (NTS-634 guarded one-statement delete)', () => {
  it('renders the guarded hard delete as one statement — no pre-read', async () => {
    const runner = new FakeRunner()

    await new DeleteService(runner).delete(
      schema,
      { id: 'form-1' },
      {
        cascade: false,
        where: { fragment: 'this.tenantId = $tenant', params: { tenant: 'acme' } },
      },
    )

    expect(runner.statements).toEqual([
      {
        query: [
          'MATCH (this:Nts634DeleteForm { id: $this_id })',
          'WHERE (this.tenantId = $tenant)',
          'DETACH DELETE this',
          'RETURN count(this) AS deleted',
        ].join('\n'),
        params: { this_id: 'form-1', tenant: 'acme' },
      },
    ])
  })

  it('renders the guarded soft delete as one statement', async () => {
    const runner = new FakeRunner()

    await new DeleteService(runner).delete(
      schema,
      { id: 'form-1' },
      {
        soft: 'Archived',
        where: { fragment: 'this.tenantId = $tenant', params: { tenant: 'acme' } },
      },
    )

    expect(runner.statements).toEqual([
      {
        query: [
          'MATCH (this:Nts634DeleteForm { id: $this_id })',
          'WHERE (this.tenantId = $tenant)',
          'SET this:`Archived`',
          'RETURN count(this) AS deleted',
        ].join('\n'),
        params: { this_id: 'form-1', tenant: 'acme' },
      },
    ])
  })

  it('renders the declarative @SoftDelete stamp as one guarded statement', async () => {
    const runner = new FakeRunner()

    await new DeleteService(runner).delete(getModel(SoftForm), { id: 'form-1' })

    expect(runner.statements).toHaveLength(1)
    expect(runner.statements[0]?.query).toContain('SET this:`Deleted`')
    expect(runner.statements[0]?.query).toContain('deletedAt')
    expect(runner.statements[0]?.query).toContain('RETURN count(this) AS deleted')
  })

  it('keeps the cascade walk in the same single statement', async () => {
    const runner = new FakeRunner()

    await new DeleteService(runner).delete(schema, { id: 'form-1' })

    expect(runner.statements).toEqual([
      {
        query: [
          'MATCH (this:Nts634DeleteForm { id: $this_id })',
          'OPTIONAL MATCH (this)-[this_OWNS_rel:`OWNS`]->(this_OWNS_node:Nts634DeleteMembership)',
          'DETACH DELETE this_OWNS_node, this',
          'RETURN count(this) AS deleted',
        ].join('\n'),
        params: { this_id: 'form-1' },
      },
    ])
  })

  it('throws the missing-entity error naming the key on zero rows, with no pre-read', async () => {
    const runner = new FakeRunner()

    runner.deletedCount = 0

    await expect(new DeleteService(runner).delete(schema, { id: 'ghost-1' })).rejects.toThrow(
      'Cannot delete: entity not found for ID ghost-1',
    )

    expect(runner.statements).toHaveLength(1)
  })

  it('resolves silently on zero rows with ifExists', async () => {
    const runner = new FakeRunner()

    runner.deletedCount = 0

    await expect(
      new DeleteService(runner).delete(schema, { id: 'ghost-1' }, { ifExists: true }),
    ).resolves.toBeUndefined()
  })
})
