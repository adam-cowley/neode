/**
Cypher script runner (NTS-134) — split a .cypher file into statements
(comment- and string-aware) and execute them sequentially.
*/

import type { QueryOutput, Runner } from '../driver/types.js'

/**
Split a script's contents into statements.

Semicolons split statements except when they appear inside:
 - single- or double-quoted string literals (backslash escapes honoured),
 - backtick-quoted identifiers (`` `a``b` `` doubling honoured),
 - `--` and `//` line comments, and `/*` block comments (to the closer).

Chunks that hold nothing but whitespace and comments are dropped, and each
remaining statement is trimmed. Comments that belong to a statement are
kept — they are legal Cypher.
*/
export function splitCypherStatements(content: string): string[] {
  const statements: string[] = []

  // Offset where the current statement starts, and whether anything but
  // whitespace/comments has been seen since — comments-only chunks are
  // not statements
  let start = 0
  let hasCode = false

  const endStatement = (semicolonIndex: number): void => {
    if (hasCode) {
      statements.push(content.slice(start, semicolonIndex).trim())
    }

    start = semicolonIndex + 1
    hasCode = false
  }

  let index = 0

  while (index < content.length) {
    const char = content[index]

    if (char === undefined) {
      break
    }

    const next = advance(content, index, char, endStatement)

    index = next.index

    if (next.isCode) {
      hasCode = true
    }
  }

  endStatement(content.length)

  return statements
}

/**
One scanner step: consume the character at `index` and return the next
index, plus whether the step saw statement code (comments and whitespace
are not code). Extracted so the scanner loop stays a plain loop (a switch
with `break` inside a loop is flagged).
*/
function advance(
  content: string,
  index: number,
  char: string,
  endStatement: (semicolonIndex: number) => void,
): { index: number; isCode: boolean } {
  switch (char) {
    case ';': {
      endStatement(index)

      return { index: index + 1, isCode: false }
    }

    case "'":
    case '"': {
      return { index: skipString(content, index, char), isCode: true }
    }

    case '`': {
      return { index: skipQuotedIdentifier(content, index), isCode: true }
    }

    case '-': {
      return content[index + 1] === '-'
        ? { index: skipLineComment(content, index), isCode: false }
        : { index: index + 1, isCode: true }
    }

    case '/': {
      if (content[index + 1] === '/') {
        return { index: skipLineComment(content, index), isCode: false }
      }

      if (content[index + 1] === '*') {
        return { index: skipBlockComment(content, index), isCode: false }
      }

      return { index: index + 1, isCode: true }
    }

    default: {
      return { index: index + 1, isCode: !/\s/.test(char) }
    }
  }
}

export interface RunCypherScriptOptions {
  /**
  Progress callback — fires with each statement before it executes.
  */
  onStatement?: (statement: string, index: number) => void
}

/**
Run every statement of a script sequentially against a runner.
Stops at (rejects on) the first failing statement.
*/
export async function runCypherScript(
  runner: Runner,
  content: string,
  options: RunCypherScriptOptions = {},
): Promise<QueryOutput[]> {
  const statements = splitCypherStatements(content)
  const results: QueryOutput[] = []

  for (const [index, statement] of statements.entries()) {
    options.onStatement?.(statement, index)

    results.push(await runner.run(statement))
  }

  return results
}

/**
Consume a quoted string literal; returns the index after its closing quote.
*/
function skipString(content: string, openIndex: number, quote: string): number {
  for (let index = openIndex + 1; index < content.length; index += 1) {
    if (content[index] === '\\') {
      index += 1 // escaped character (\' \" \\ ...) — never a closing quote
      continue
    }

    if (content[index] === quote) {
      return index + 1
    }
  }

  return content.length
}

/**
Consume a backtick-quoted identifier; doubled backticks are the escape.
*/
function skipQuotedIdentifier(content: string, openIndex: number): number {
  for (let index = openIndex + 1; index < content.length; index += 1) {
    if (content[index] !== '`') {
      continue
    }

    if (content[index + 1] === '`') {
      index += 1
      continue
    }

    return index + 1
  }

  return content.length
}

/**
Skip to (not past) the newline ending a line comment.
*/
function skipLineComment(content: string, start: number): number {
  let index = start

  while (index < content.length && content[index] !== '\n') {
    index += 1
  }

  return index
}

/**
Skip past the closer of a block comment (unterminated comments run to EOF).
*/
function skipBlockComment(content: string, start: number): number {
  const end = content.indexOf('*/', start + 2)

  return end === -1 ? content.length : end + 2
}
