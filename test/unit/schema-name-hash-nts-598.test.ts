import { describe, expect, it } from 'vitest'
import {
  ConstraintAction,
  ConstraintType,
  isEnterpriseConnection,
  propertyTypeStatement,
  schemaObjectName,
  schemaStatement,
} from '../../src/services/schema/schema-objects'
import { SchemaService } from '../../src/services/schema/schema.service'
import { inspectSchema } from '../../src/services/schema/inspect.service'
import { schemaDrift } from '../../src/services/schema/drift.service'
import type { ConnectionProvider, QueryRecord } from '../../src/driver/types'
import { mergeModel } from '../../src/meta'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { PropertyType } from '../../src/meta/property-schema'

/**
 * NTS-598 — injective hash-suffixed DDL names, edition auto-detection and
 * the fail-loud graph-type parse. No database: statement-shape and
 * wiring tests over fake providers.
 */

const record = (values: Record<string, unknown>): QueryRecord => ({
  keys: Object.keys(values),
  get: (key) => values[key],
  has: (key) => key in values,
})

describe('schemaObjectName injectivity (NTS-598)', () => {
  it('keeps case-distinguished labels and properties injective (User vs user)', () => {
    const upper = schemaObjectName('User', ['id'], ConstraintType.UNIQUE)
    const lower = schemaObjectName('user', ['id'], ConstraintType.UNIQUE)

    expect(upper).not.toBe(lower)
    // both keep a readable prefix — only the hash separates them
    expect(upper.startsWith('user_id_unique_')).toBe(true)
    expect(lower.startsWith('user_id_unique_')).toBe(true)
  })

  it('keeps property lists injective across the _ join ((a, b_c) vs (a_b, c))', () => {
    const split = schemaObjectName('a', ['b_c'], ConstraintType.UNIQUE)
    const joined = schemaObjectName('a_b', ['c'], ConstraintType.UNIQUE)

    expect(split).not.toBe(joined)
    expect(split.startsWith('a_b_c_unique_')).toBe(true)
    expect(joined.startsWith('a_b_c_unique_')).toBe(true)
  })

  it('is order-stable: the same properties in any declaration order hash alike', () => {
    expect(schemaObjectName('Person', ['email', 'eventId'], ConstraintType.UNIQUE)).toBe(
      schemaObjectName('Person', ['eventId', 'email'], ConstraintType.UNIQUE),
    )
  })

  it('is deterministic across processes (pinned literal)', () => {
    expect(schemaObjectName('Person', ['email'], ConstraintType.UNIQUE)).toBe(
      'person_email_unique_b37312eb',
    )
  })

  it('keeps every generated family distinct for the same label + property', () => {
    const names = [
      schemaObjectName('Person', ['email'], ConstraintType.UNIQUE),
      schemaObjectName('Person', ['email'], ConstraintType.EXISTS),
      schemaObjectName('Person', ['email'], ConstraintType.INDEX),
      schemaObjectName('Person', ['email'], ConstraintType.PROPERTY_TYPE),
      schemaObjectName('Person', ['email'], ConstraintType.FULLTEXT),
      schemaObjectName('Person', ['email'], ConstraintType.VECTOR),
    ]

    expect(new Set(names).size).toBe(names.length)
  })

  it('drives every DDL path through the one function: install, drop and declared set agree', () => {
    const create = schemaStatement(ConstraintAction.CREATE, ConstraintType.UNIQUE, 'Person', [
      'email',
    ])
    const drop = schemaStatement(ConstraintAction.DROP, ConstraintType.UNIQUE, 'Person', ['email'])
    const propertyType = propertyTypeStatement(ConstraintAction.CREATE, 'Person', 'email', 'STRING')

    const expected = schemaObjectName('Person', ['email'], ConstraintType.UNIQUE)
    const expectedType = schemaObjectName('Person', ['email'], ConstraintType.PROPERTY_TYPE)

    expect(create).toContain(`CREATE CONSTRAINT ${expected} IF NOT EXISTS`)
    expect(drop).toBe(`DROP CONSTRAINT ${expected} IF EXISTS`)
    expect(propertyType).toContain(`CREATE CONSTRAINT ${expectedType} IF NOT EXISTS`)
  })
})

describe('edition auto-detection (NTS-598)', () => {
  const provider = (
    edition: 'enterprise' | 'community' | 'unknown' | undefined,
    statements: string[] = [],
  ): ConnectionProvider => {
    return {
      run: async (statement: string) => {
        statements.push(statement)

        return { records: [] }
      },
      ...(edition === undefined
        ? {}
        : {
            edition:
              edition === 'unknown'
                ? async (): Promise<'unknown'> => 'unknown'
                : async (): Promise<'enterprise' | 'community'> => edition,
          }),
    } as unknown as ConnectionProvider
  }

  /** Model declaring one EXISTS and one typed property */
  function registerEditionModel(): void {
    class EditionPerson {
      static __ogmUnitFixture?: void
    }

    const schema: EntitySchema = mergeModel(EditionPerson)

    schema.setLabels(['EditionPerson'])
    schema.addProperty('id')
    schema.getProperty('id').setUnique()
    schema.addProperty('title')
    schema.getProperty('title').setExists()
    schema.getProperty('title').setType(PropertyType.STRING)
    schema.getProperty('title').setTyped(true)
  }

  registerEditionModel()

  it('caches the probe per connection (one CALL dbms.components() round trip)', async () => {
    let calls = 0

    const connection = {
      edition: async (): Promise<'enterprise'> => {
        calls++

        return 'enterprise'
      },
    } as unknown as ConnectionProvider

    expect(await isEnterpriseConnection(connection)).toBe(true)
    expect(await isEnterpriseConnection(connection)).toBe(true)
    expect(calls).toBe(1)
  })

  it('maps community and unknown editions to the fail-safe false', async () => {
    expect(await isEnterpriseConnection(provider('community'))).toBe(false)
    expect(await isEnterpriseConnection(provider('unknown'))).toBe(false)
    expect(await isEnterpriseConnection(provider(undefined))).toBe(false)
  })

  it('skips EXISTS and property-type DDL on Community and runs them on Enterprise', async () => {
    const community: string[] = []

    await new SchemaService(provider('community', community)).create()

    expect(community.filter((statement) => /IS NOT NULL|IS ::/.test(statement))).toEqual([])

    const enterprise: string[] = []

    await new SchemaService(provider('enterprise', enterprise)).create()

    expect(enterprise.some((statement) => statement.includes('IS NOT NULL'))).toBe(true)
    expect(enterprise.some((statement) => statement.includes('IS ::'))).toBe(true)
  })

  it('declares EXISTS / property-type constraints from the DETECTED edition in inspectSchema', async () => {
    const run = async (statement: string): Promise<unknown> => {
      if (statement === 'SHOW CONSTRAINTS' || statement === 'SHOW INDEXES') {
        return { records: [] }
      }

      return { records: [] }
    }

    const community = {
      run,
      edition: async (): Promise<'community'> => 'community',
    } as unknown as ConnectionProvider

    const communityReport = await inspectSchema(community)

    // the previously false-missing entries are simply not declared
    expect(communityReport.constraints.missing).toHaveLength(1) // the unique only
    expect(
      communityReport.constraints.declared.filter(
        (object) =>
          object.type === ConstraintType.EXISTS || object.type === ConstraintType.PROPERTY_TYPE,
      ),
    ).toEqual([])

    const enterprise = {
      run,
      edition: async (): Promise<'enterprise'> => 'enterprise',
    } as unknown as ConnectionProvider

    const enterpriseReport = await inspectSchema(enterprise)

    expect(
      enterpriseReport.constraints.declared.some((object) => object.type === ConstraintType.EXISTS),
    ).toBe(true)
    expect(
      enterpriseReport.constraints.declared.some(
        (object) => object.type === ConstraintType.PROPERTY_TYPE,
      ),
    ).toBe(true)
  })
})

describe('fail-loud graph-type parse (NTS-598)', () => {
  const driftProvider = (run: (statement: string) => Promise<unknown>): ConnectionProvider =>
    ({
      run: async (statement: string): Promise<unknown> => {
        if (statement === 'SHOW CONSTRAINTS' || statement === 'SHOW INDEXES') {
          return { records: [] }
        }

        return run(statement)
      },
      edition: async (): Promise<'community'> => 'community',
    }) as unknown as ConnectionProvider

  it('THROWS when the canonical specification cannot be parsed instead of reporting drift', async () => {
    const connection = driftProvider((statement) => {
      if (statement === 'SHOW CURRENT GRAPH TYPE') {
        return { records: [record({ specification: '{WHAT' })] }
      }

      return { records: [] }
    })

    await expect(schemaDrift(connection)).rejects.toThrow(TypeError)
  })

  it('still omits the graph type family when the backend does not support it', async () => {
    const connection = driftProvider(async () => {
      throw new Error('unsupported')
    })

    const drift = await schemaDrift(connection)

    expect(drift.graphType).toBeUndefined()
  })
})
