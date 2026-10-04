/** Imports downloaded WordPress media from a CSV with source_url, local_path, alt.
 * Usage: node --loader ts-node/esm src/migrations/import-media.ts <csv-path> [--execute]
 */
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { parse } from 'csv-parse/sync'
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'

interface Row { source_url: string; local_path: string; alt: string }
const mime: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' }

async function run(): Promise<void> {
  const filename = process.argv[2]
  const execute = process.argv.includes('--execute')
  if (!filename) throw new Error('Usage: import-media.ts <csv-path> [--execute]')
  const rows = parse(readFileSync(filename, 'utf8'), { columns: true, skip_empty_lines: true, trim: true }) as Row[]
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  let created = 0, skipped = 0, failed = 0
  for (const [index, row] of rows.entries()) {
    try {
      if (!row.source_url || !row.local_path || !row.alt) throw new Error('Missing source_url, local_path, or alt')
      const fileName = basename(row.local_path)
      const mimetype = mime[extname(fileName).toLowerCase()]
      if (!mimetype) throw new Error('Unsupported file type')
      const existing = await payload.find({ collection: 'media', where: { sourceUrl: { equals: row.source_url } }, limit: 1, overrideAccess: true })
      if (existing.totalDocs) { skipped++; continue }
      const data = readFileSync(row.local_path)
      if (execute) await payload.create({ collection: 'media', data: { alt: row.alt, sourceUrl: row.source_url }, file: { data, name: fileName, mimetype, size: data.length }, overrideAccess: true })
      created++
    } catch (err) {
      failed++
      console.error(`FAILED row ${index + 2}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', rows: rows.length, created, skipped, failed }))
  if (failed) process.exitCode = 1
}

run().catch((err: unknown) => { console.error(err); process.exitCode = 1 })
