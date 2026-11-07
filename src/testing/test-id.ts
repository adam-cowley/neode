/**
Unique identifier for test data — `test-<timestamp>-<random>` by default,
safe as a property value (letters, digits and hyphens only).
*/
export function testId(prefix = 'test'): string {
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0')

  return `${prefix}-${String(Date.now())}-${random}`
}
