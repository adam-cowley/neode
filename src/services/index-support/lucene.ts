/**
Sanitise free user text into a safe full-text query string.

Binding the text as a query parameter stops Cypher injection, but the
Lucene parser behind `db.index.fulltext.queryNodes` still 500s on syntax
characters (`(`, `"`, `*`, `AND`, …). Every Lucene special character and
uppercase boolean operator is stripped, terms are lowercased and the term
count capped so the result is always a plain term list.
*/
const LUCENE_SPECIALS = /["\\+!(){}[\]^~*?:/,;&=|<>%-]/g

// Lucene boolean operators are only recognised in upper case, so real words
// like "and" survive once the text is lowercased afterwards
const LUCENE_OPERATORS = /\b(AND|OR|NOT|TO)\b/g

const DEFAULT_MAX_TERMS = 12

export function toFulltextQuery(text: string, maxTerms: number = DEFAULT_MAX_TERMS): string {
  return text
    .replaceAll(LUCENE_OPERATORS, ' ')
    .replaceAll(LUCENE_SPECIALS, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => term.toLowerCase())
    .slice(0, Math.max(1, maxTerms))
    .join(' ')
}
