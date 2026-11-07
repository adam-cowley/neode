// The backend import loads neode.service first, resolving the module cycles
// before anything below is evaluated
import { openBackend, TestBackend } from './support/backend'

describe('EXPLAIN / PROFILE helpers', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('explain() returns the driver plan when the backend produces one', async () => {
    const plan = await backend.neode.explain('MATCH (n) RETURN count(n) AS c')

    // Relate accepts the EXPLAIN keyword but produces no plan: the helper
    // degrades to undefined rather than throwing. Neo4j backends return
    // the driver's plan tree.
    if (backend.name === 'relate') {
      expect(plan).toBeUndefined()
    } else {
      expect(plan).toBeDefined()
    }
  })

  it('profile() returns the driver profile when the backend produces one', async () => {
    const profile = await backend.neode.profile('RETURN 1 AS one')

    if (backend.name === 'relate') {
      expect(profile).toBeUndefined()
    } else {
      expect(profile).toBeDefined()
    }
  })

  it('surfaces backend errors for invalid statements', async () => {
    await expect(backend.neode.explain('THIS IS NOT CYPHER')).rejects.toThrow()
  })
})
