import { describe, expect, it } from 'vitest'

import { testId } from '../../src/testing/test-id'

describe('testId', () => {
  it('produces test-<timestamp>-<random> by default', () => {
    expect(testId()).toMatch(/^test-\d+-[a-z0-9]{6}$/)
  })

  it('uses the given prefix', () => {
    expect(testId('person')).toMatch(/^person-\d+-[a-z0-9]{6}$/)
  })

  it('is unique across calls within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => testId()))

    expect(ids.size).toBe(1000)
  })

  it('is safe as a property value — letters, digits and hyphens only', () => {
    for (let index = 0; index < 100; index += 1) {
      expect(testId()).toMatch(/^[A-Za-z0-9-]+$/)
    }
  })
})
