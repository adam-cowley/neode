import { describe, expect, it } from 'vitest'
import { extractRecipe, rewriteLinks } from '../../scripts/build-docs-site.ts'

const htmlTargets = new Map([
  ['README.md', 'index.html'],
  ['docs/api-reference.md', 'docs/api-reference.html'],
  ['docs/agent/querying.md', 'docs/agent/querying.html'],
])

describe('extractRecipe', () => {
  it('takes the title from the first header line, body from the rest', () => {
    const source = `/**\nCookbook — validation: rules on properties.\n\nAll failing checks are\ncollected into one ValidationError.\n*/\nimport { fromEnv } from 'neode'\n`
    expect(extractRecipe(source)).toEqual({
      title: 'validation: rules on properties',
      body: 'All failing checks are\ncollected into one ValidationError.',
    })
  })

  it('survives a missing header', () => {
    expect(extractRecipe('const x = 1\n')).toEqual({ title: '', body: '' })
  })
})

describe('rewriteLinks', () => {
  it('rewrites links to known pages, keeping anchors', () => {
    expect(rewriteLinks('[api](docs/api-reference.md#events)', 'README.md', htmlTargets)).toBe(
      '[api](/docs/api-reference.html#events)',
    )
  })

  it('resolves links relative to the source file', () => {
    expect(
      rewriteLinks(
        '[next](querying.md) [up](../api-reference.md)',
        'docs/agent/core.md',
        htmlTargets,
      ),
    ).toBe('[next](/docs/agent/querying.html) [up](/docs/api-reference.html)')
  })

  it('leaves unknown targets and non-md links untouched', () => {
    const md = '[missing](docs/nope.md) [site](https://neo4j.com) [img](x.png)'
    expect(rewriteLinks(md, 'README.md', htmlTargets)).toBe(md)
  })
})
