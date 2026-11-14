import { instrumentConnectionProvider } from '../../../src/driver/instrumented'
import type { ConnectionProvider } from '../../../src/driver/types'

describe('instrumentConnectionProvider (NTS-576)', () => {
  const inner = {
    run: vi.fn().mockResolvedValue({ records: [] }),
    beginTransaction: vi.fn(),
    edition: vi.fn(),
    close: vi.fn(),
  } as unknown as ConnectionProvider

  it('a throwing query:executed listener does not turn success into rejection', async () => {
    const provider = instrumentConnectionProvider(inner, () => {
      throw new Error('listener blew up')
    })

    await expect(provider.run('RETURN 1')).resolves.toEqual({ records: [] })
  })

  it('a throwing listener does not replace the statement error', async () => {
    const failing = {
      ...inner,
      run: vi.fn().mockRejectedValue(new Error('statement failed')),
    } as unknown as ConnectionProvider

    const provider = instrumentConnectionProvider(failing, () => {
      throw new Error('listener blew up')
    })

    await expect(provider.run('RETURN 1')).rejects.toThrow('statement failed')
  })
})
