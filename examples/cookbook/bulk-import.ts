/**
Cookbook — batch import: file/API rows into createMany()/mergeMany().

Any source (CSV file, NDJSON stream, paginated API pull) is an
AsyncIterable of records. Feed batches as they arrive — `for await`
gives backpressure, memory stays bounded by the batch size, and each
batch commits its own transaction. rowToProperties() maps every row
through the model schema (renames, defaults, fakes, validation, type
conversion) without throwing, so bad rows are reported and good rows
still import. mergeMany() matches on the model's merge fields, so
re-running the same file updates instead of duplicating.

Run:  npx tsx examples/cookbook/bulk-import.ts
*/
import { NodeEntity, Property, fromEnv } from 'neode'

@NodeEntity()
class Product {
  @Property({ type: 'string', primary: true })
  sku!: string

  @Property({ type: 'string', required: true, min: 2 })
  name!: string

  @Property({ type: 'number', min: 0 })
  price!: number
}

// Stand-in for a real source (createReadStream().pipe(csv-parse), NDJSON
// lines, paginated API pulls): an AsyncIterable of raw records, here a
// CSV body whose headers do not match the property names
async function* sourceRows(): AsyncIterable<Record<string, unknown>> {
  const csv = ['sku,product_name,price', 'K1,Kayak,799', 'P1,Paddle,49.5', 'X2,X,12']
  const headerLine = csv[0]

  if (headerLine === undefined) {
    return
  }

  const headers = headerLine.split(',')

  for (const line of csv.slice(1)) {
    yield Object.fromEntries(headers.map((header, index) => [header, line.split(',')[index] ?? '']))
  }
}

interface ImportReport {
  imported: number
  rejected: { row: Record<string, unknown>; errors: unknown }[]
  products: Product[]
}

async function importRows(neode: ReturnType<typeof fromEnv>): Promise<ImportReport> {
  const BATCH = 1000
  let batch: Record<string, unknown>[] = []
  const report: ImportReport = { imported: 0, rejected: [], products: [] }

  for await (const record of sourceRows()) {
    const mapped = await neode.rowToProperties(Product, record, {
      map: { product_name: 'name' },
    })

    if (mapped.ok) {
      batch.push(mapped.properties)
    } else {
      report.rejected.push({ row: record, errors: mapped.errors })
    }

    if (batch.length === BATCH) {
      const chunks = await neode.mergeMany(Product, batch)
      report.products.push(...chunks.flatMap((chunk) => chunk.entities))
      batch = []
    }
  }

  if (batch.length > 0) {
    const chunks = await neode.mergeMany(Product, batch)
    report.products.push(...chunks.flatMap((chunk) => chunk.entities))
  }

  report.imported = report.products.length

  return report
}

async function main(): Promise<void> {
  const neode = fromEnv()

  try {
    const first = await importRows(neode)

    console.log(`imported ${first.imported} rows, rejected ${first.rejected.length}`)

    for (const failure of first.rejected) {
      console.error(`rejected ${JSON.stringify(failure.row)}:`, failure.errors)
    }

    // Re-running the same file updates instead of duplicating — the merge
    // matches on the model's merge fields (sku here)
    const second = await importRows(neode)

    const distinct = new Set(first.products.concat(second.products).map((product) => product.sku))

    console.log(
      `re-run imported ${second.imported} rows — ${distinct.size} distinct products in total`,
    )

    for (const product of distinct) {
      const [entity] = second.products.filter((candidate) => candidate.sku === product)
      if (entity !== undefined) await neode.delete(entity)
    }
  } finally {
    await neode.close()
  }
}

main().catch(console.error)
