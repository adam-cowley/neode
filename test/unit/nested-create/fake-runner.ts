import { INTERNAL_ID, THIS_NODE } from '../../../src/constants.js'
import type {
  GraphNode,
  QueryOutput,
  QueryParams,
  QueryRecord,
  Runner,
} from '../../../src/driver/types.js'

/**
One record over a plain map — no database
*/
function recordOf(values: Record<string, unknown>): QueryRecord {
  return {
    get: (key) => values[key],
    has: (key) => key in values,
    keys: Object.keys(values),
  }
}

/**
The write row a statement returns: the node in `this`, its elementId in `__id`
*/
export function writtenRow(node: GraphNode): QueryOutput {
  return {
    records: [recordOf({ [THIS_NODE]: node, [INTERNAL_ID]: node.elementId })],
  }
}

/**
A Runner that captures every statement instead of touching a database,
answering the single-row write shape (`this` node + elementId).
Per-statement `outputs` (in statement order) override the default row —
`{ records: [] }` simulates a statement that matched nothing.
*/
export class WriteCaptureRunner implements Runner {
  readonly statements: { query: string; params: QueryParams }[] = []

  private readonly outputs: QueryOutput[]

  constructor(...outputs: QueryOutput[]) {
    this.outputs = outputs
  }

  async run(query: string, params: QueryParams = {}): Promise<QueryOutput> {
    const index = this.statements.length

    this.statements.push({ query, params })

    return this.outputs[index] ?? writtenRow(blankNode())
  }
}

/** A minimal node value — service-level statements only read the elementId */
function blankNode(): GraphNode {
  return { elementId: '4:nts627:1', labels: [], properties: {} }
}
