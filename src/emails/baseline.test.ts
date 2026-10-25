import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Brief section 2: with no overrides published, every email renders exactly as it did before
 * the editor existed. Compares every render with src/emails/__baseline__/baseline.json.
 */
process.env.FRONTEND_URL = 'https://skillsair.com'
const { renderBaseline } = await import('./baseline-cases.js')

test('every email matches the baseline snapshot, character for character', () => {
  const baseline = JSON.parse(readFileSync('src/emails/__baseline__/baseline.json', 'utf8')) as Record<string, unknown>
  const current = renderBaseline()
  assert.deepEqual(Object.keys(current), Object.keys(baseline), 'the set of renders changed')
  for (const [key, rendered] of Object.entries(current)) assert.deepEqual(rendered, baseline[key], key)
  console.log(`# baseline: ${Object.keys(current).length} renders compared`)
})
