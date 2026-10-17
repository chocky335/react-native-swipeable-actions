import { appendFile } from 'node:fs/promises'
import { config } from '../../e2e/wdio.ios.conf'

jest.mock('node:fs/promises', () => ({
  appendFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined)
}))
jest.mock('../../e2e/helpers/selectors', () => ({ setPlatform: jest.fn() }))

const afterHook = config.afterHook as (...args: unknown[]) => Promise<void>

describe('iOS CI hook reporting', () => {
  beforeEach(() => jest.clearAllMocks())

  async function report(result: Record<string, unknown>) {
    await afterHook({ title: 'before all', file: 'example.spec.ts' }, {}, result, 'before all')
    return jest.mocked(appendFile).mock.calls.map(([, data]) => JSON.parse(String(data)))
  }

  it('does not record a successful hook as a failure', async () => {
    expect(await report({ passed: true, duration: 1 })).toEqual([])
  })

  it('records an intentional skip separately, without inventing test totals', async () => {
    const records = await report({ passed: false, skipped: true, duration: 1 })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ event: 'hook-skipped', hook: 'before all' })
    expect(records[0]).not.toHaveProperty('passed')
    expect(records[0]).not.toHaveProperty('skipped')
  })

  it('keeps unsuccessful non-skipped hooks as failures even without an error', async () => {
    expect(await report({ passed: false, skipped: false, duration: 1 })).toEqual([
      expect.objectContaining({ event: 'hook-failure' })
    ])
  })

  it('does not hide actual errors behind skipped or passed flags', async () => {
    const error = new Error('setup failed')
    expect(await report({ passed: true, skipped: true, error, duration: 1 })).toEqual([
      expect.objectContaining({
        event: 'hook-failure',
        error: expect.objectContaining({ message: 'setup failed' })
      })
    ])
  })
})
