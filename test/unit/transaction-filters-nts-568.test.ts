import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Filter, NodeEntity, Primary, Property, SoftDelete } from '../../src/decorators'
import type { QueryOutput, TransactionHandle } from '../../src/driver/types.js'
import { clearFilterParams, setFilterParams } from '../../src/services/query/filters'
import { TransactionalService } from '../../src/transaction/transactional.service'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
@SoftDelete()
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class TxMirrorDoc {
  @Primary()
  @Property({ type: 'string' })
  docID!: string
}

const normalise = (query: string): string => query.replaceAll(/\s+/g, ' ').trim()

// A handle that records the statements it was asked to run — the mirror
// plumbing is proven at the statement level, no engine needed
function recordingHandle(): { handle: TransactionHandle; statements: string[] } {
  const statements: string[] = []

  const handle: TransactionHandle = {
    run: async (statement: string): Promise<QueryOutput> => {
      statements.push(statement)

      return { records: [] }
    },
    commit: async () => {},
    rollback: async () => {},
  }

  return { handle, statements }
}

// NTS-568 — the tx mirrors compose the model's named filters by default and
// honour withoutFilters with per-name independence, matching the facade reads
describe('withoutFilters in the transactional mirrors (NTS-568)', () => {
  // The tenant filter fails closed without a value (NTS-575)
  beforeEach(() => {
    setFilterParams('tenant', 'acme')
  })

  afterEach(() => {
    clearFilterParams()
  })

  it('tx.find composes both filters by default; withoutFilters drops only the named one', async () => {
    const { handle, statements } = recordingHandle()
    const tx = new TransactionalService(handle, new EventEmitter())

    await tx.find(TxMirrorDoc, 'd1')
    await tx.find(TxMirrorDoc, 'd1', { withoutFilters: ['tenant'] })

    expect(normalise(statements[0]!)).toContain('this.tenant = $tenant')
    expect(normalise(statements[0]!)).toContain('NOT this:`Deleted`')

    expect(normalise(statements[1]!)).not.toContain('$tenant')
    // per-name independence: the soft-delete clause survives
    expect(normalise(statements[1]!)).toContain('NOT this:`Deleted`')
  })

  it('tx.get composes by default and honours withoutFilters in the options slot', async () => {
    const { handle, statements } = recordingHandle()
    const tx = new TransactionalService(handle, new EventEmitter())

    await tx.get(TxMirrorDoc, {})
    await tx.get(TxMirrorDoc, {}, undefined, undefined, { withoutFilters: ['tenant'] })

    expect(normalise(statements[0]!)).toContain('this.tenant = $tenant')
    expect(normalise(statements[0]!)).toContain('NOT this:`Deleted`')

    expect(normalise(statements[1]!)).not.toContain('$tenant')
    expect(normalise(statements[1]!)).toContain('NOT this:`Deleted`')
  })

  it('tx.all honours withoutFilters in the options slot', async () => {
    const { handle, statements } = recordingHandle()
    const tx = new TransactionalService(handle, new EventEmitter())

    await tx.all(TxMirrorDoc)
    await tx.all(TxMirrorDoc, {}, undefined, undefined, undefined, undefined, {
      withoutFilters: ['tenant'],
    })

    expect(normalise(statements[0]!)).toContain('this.tenant = $tenant')

    expect(normalise(statements[1]!)).not.toContain('$tenant')
    expect(normalise(statements[1]!)).toContain('NOT this:`Deleted`')
  })

  it('tx.search honours withoutFilters', async () => {
    const { handle, statements } = recordingHandle()
    const tx = new TransactionalService(handle, new EventEmitter())

    await tx.search(TxMirrorDoc, 'tx_mirror_doc_index', 'query')
    await tx.search(TxMirrorDoc, 'tx_mirror_doc_index', 'query', undefined, {
      withoutFilters: ['tenant'],
    })

    // the raw-statement paths bind the filtered node as `node`
    expect(normalise(statements[0]!)).toContain('node.tenant = $tenant')

    expect(normalise(statements[1]!)).not.toContain('$tenant')
  })
})
