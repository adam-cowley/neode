import { describe, expect, it } from 'vitest'

import { Runner, QueryOutput } from '../../src/driver/types'
import { runCypherScript, splitCypherStatements } from '../../src/ops/cypher-script'

describe('splitCypherStatements', () => {
  it('returns an empty array for empty input', () => {
    expect(splitCypherStatements('')).toEqual([])
  })

  it('returns an empty array for whitespace-only input', () => {
    expect(splitCypherStatements('  \n\t \r\n ')).toEqual([])
  })

  it('returns an empty array for comment-only input', () => {
    expect(splitCypherStatements('// nothing here\n/* nor here */\n-- at all')).toEqual([])
  })

  it('splits on semicolons and trims surrounding whitespace', () => {
    expect(splitCypherStatements('CREATE (a);\n  RETURN 1;')).toEqual(['CREATE (a)', 'RETURN 1'])
  })

  it('returns a single statement without a trailing semicolon', () => {
    expect(splitCypherStatements('RETURN 1')).toEqual(['RETURN 1'])
  })

  it('ignores empty statements from leading, trailing or doubled semicolons', () => {
    expect(splitCypherStatements(';; CREATE (n); ;')).toEqual(['CREATE (n)'])
  })

  it('does not split on semicolons inside single-quoted strings', () => {
    expect(splitCypherStatements("RETURN 'a;b';")).toEqual(["RETURN 'a;b'"])
  })

  it('does not split on semicolons inside double-quoted strings', () => {
    expect(splitCypherStatements('RETURN "a;b";')).toEqual(['RETURN "a;b"'])
  })

  it('honours backslash escapes inside strings', () => {
    // The string is "it'; x" — the escaped quote does not close it
    expect(splitCypherStatements("RETURN 'it\\'; x';")).toEqual(["RETURN 'it\\'; x'"])
  })

  it('does not split on semicolons inside backtick-quoted identifiers', () => {
    expect(splitCypherStatements('MATCH (n:`Foo;Bar`) RETURN n;')).toEqual([
      'MATCH (n:`Foo;Bar`) RETURN n',
    ])
  })

  it('honours doubled backticks inside quoted identifiers', () => {
    expect(splitCypherStatements('RETURN `a``;b` AS x;')).toEqual(['RETURN `a``;b` AS x'])
  })

  it('does not treat -- or // inside strings as comments', () => {
    expect(splitCypherStatements("RETURN '-- not ; a comment';")).toEqual([
      "RETURN '-- not ; a comment'",
    ])
    expect(splitCypherStatements('RETURN "// not ; a comment";')).toEqual([
      'RETURN "// not ; a comment"',
    ])
  })

  it('does not split on semicolons inside -- comments', () => {
    expect(splitCypherStatements('RETURN 1 -- comment; still comment\n;RETURN 2;')).toEqual([
      'RETURN 1 -- comment; still comment',
      'RETURN 2',
    ])
  })

  it('does not split on semicolons inside // comments', () => {
    expect(splitCypherStatements('RETURN 1 // comment; still comment\n;RETURN 2;')).toEqual([
      'RETURN 1 // comment; still comment',
      'RETURN 2',
    ])
  })

  it('does not split on semicolons inside /* */ comments', () => {
    expect(splitCypherStatements('RETURN 1 /* ; ; */ ;')).toEqual(['RETURN 1 /* ; ; */'])
  })

  it('supports multi-line block comments containing semicolons', () => {
    const content = '/* multi\nline ; comment */\nRETURN 1;'

    expect(splitCypherStatements(content)).toEqual(['/* multi\nline ; comment */\nRETURN 1'])
  })

  it('drops statements that contain only comments', () => {
    expect(splitCypherStatements('/* setup */ ; RETURN 1;')).toEqual(['RETURN 1'])
  })

  it('keeps comments that belong to a statement', () => {
    expect(splitCypherStatements('// header\nCREATE (n);')).toEqual(['// header\nCREATE (n)'])
  })

  it('drops a trailing comment-only chunk after the last semicolon', () => {
    expect(splitCypherStatements('RETURN 1; // trailing\n/* block */')).toEqual(['RETURN 1'])
  })

  it('handles CRLF line endings', () => {
    expect(splitCypherStatements('RETURN 1;\r\nRETURN 2;\r\n')).toEqual(['RETURN 1', 'RETURN 2'])
  })

  it('handles a full script mixing everything', () => {
    const content = [
      '// users',
      'CREATE (:User {name: "Alice; co"});',
      'CREATE (:User {name: `Bob;`});',
      '/* multi;',
      'line */ MATCH (n:User) RETURN n; // done',
    ].join('\n')

    expect(splitCypherStatements(content)).toEqual([
      '// users\nCREATE (:User {name: "Alice; co"})',
      'CREATE (:User {name: `Bob;`})',
      '/* multi;\nline */ MATCH (n:User) RETURN n',
    ])
  })
})

describe('runCypherScript', () => {
  class FakeRunner implements Runner {
    readonly statements: string[] = []

    async run(statement: string): Promise<QueryOutput> {
      this.statements.push(statement)

      return { records: [] }
    }
  }

  it('executes statements sequentially and returns one result per statement', async () => {
    const runner = new FakeRunner()
    const results = await runCypherScript(runner, 'CREATE (a); CREATE (b); RETURN 1;')

    expect(runner.statements).toEqual(['CREATE (a)', 'CREATE (b)', 'RETURN 1'])
    expect(results).toHaveLength(3)
  })

  it('reports progress through onStatement before each execution', async () => {
    const runner = new FakeRunner()
    const progress: Array<{ statement: string; index: number }> = []

    await runCypherScript(runner, 'CREATE (a); CREATE (b);', {
      onStatement: (statement, index) => progress.push({ statement, index }),
    })

    expect(progress).toEqual([
      { statement: 'CREATE (a)', index: 0 },
      { statement: 'CREATE (b)', index: 1 },
    ])
  })

  it('stops at the first failing statement and rejects', async () => {
    const executed: string[] = []
    const runner: Runner = {
      async run(statement) {
        if (statement === 'BOOM') {
          throw new Error('syntax error')
        }

        executed.push(statement)

        return { records: [] }
      },
    }

    await expect(runCypherScript(runner, 'CREATE (a); BOOM; CREATE (b);')).rejects.toThrow(
      'syntax error',
    )

    expect(executed).toEqual(['CREATE (a)'])
  })
})
