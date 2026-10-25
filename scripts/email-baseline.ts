/**
 * Writes src/emails/__baseline__/baseline.json: every email rendered with no published overrides
 * (brief section 2). src/emails/baseline.test.ts compares against it on every `npm test`.
 * Regenerate only when the wording learners receive is meant to change in code, never to make
 * the test pass after a refactor.
 *
 * Usage: npm run emails:baseline
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

process.env.FRONTEND_URL = 'https://skillsair.com'
const { renderBaseline } = await import('../src/emails/baseline-cases.js')

const out = path.resolve('src/emails/__baseline__/baseline.json')
const renders = renderBaseline()
await writeFile(out, `${JSON.stringify(renders, null, 1)}\n`, 'utf8')
console.log(`Wrote ${Object.keys(renders).length} renders to ${out}`)
