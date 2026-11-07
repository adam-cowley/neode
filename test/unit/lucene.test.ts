import { describe, expect, it } from 'vitest'
import { toFulltextQuery } from '../../src/services/index-support/lucene'

describe('toFulltextQuery', () => {
  it('passes plain terms through, lowercased', () => {
    expect(toFulltextQuery('Computer Hacking')).toBe('computer hacking')
  })

  it('strips Lucene special characters that would break the parser', () => {
    expect(toFulltextQuery('matrix)')).toBe('matrix')
    expect(toFulltextQuery('neo*query')).toBe('neo query')
    expect(toFulltextQuery('a:"quoted" term')).toBe('a quoted term')
    expect(toFulltextQuery('path\\to\\file')).toBe('path to file')
    expect(toFulltextQuery('field:value')).toBe('field value')
    expect(toFulltextQuery('[nested]{braces}')).toBe('nested braces')
    expect(toFulltextQuery('boost^2 and ~fuzzy')).toBe('boost 2 and fuzzy')
  })

  it('strips uppercase Lucene boolean operators', () => {
    expect(toFulltextQuery('hacker AND truth')).toBe('hacker truth')
    expect(toFulltextQuery('hacker OR truth OR NOT')).toBe('hacker truth')
    expect(toFulltextQuery('[1 TO 10]')).toBe('1 10')
  })

  it('keeps lowercase "and"/"or" as ordinary terms', () => {
    // Lucene operators are only uppercase; real words survive
    expect(toFulltextQuery('fish and chips')).toBe('fish and chips')
  })

  it('collapses whitespace and ignores empty input', () => {
    expect(toFulltextQuery('  spaced \t out  ')).toBe('spaced out')
    expect(toFulltextQuery('')).toBe('')
    expect(toFulltextQuery(')))')).toBe('')
  })

  it('caps the number of terms', () => {
    expect(toFulltextQuery('a b c d e f', 3)).toBe('a b c')
  })

  it('uses a sane default term cap', () => {
    const many = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ')

    expect(toFulltextQuery(many).split(' ')).toHaveLength(12)
  })
})
