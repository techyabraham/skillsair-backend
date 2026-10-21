/**
 * Proves Studio didn't change the data shape: compares every collection's and global's
 * data-carrying fields (name, type, hasMany, relationTo, nesting) between a base config and the
 * current one. Layout wrappers (tabs without a name, rows, collapsibles) and `ui` fields store
 * nothing and are ignored; the only allowed difference is the new `displayTitle` field.
 *
 *   git archive <base-branch> src payload.config.ts | tar -x -C tmp/base
 *   node --loader ts-node/esm scripts/studio-shape-check.ts tmp/base/payload.config.ts
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Field } from 'payload'

type Shape = Record<string, string>

function shape(fields: Field[], prefix = ''): Shape {
  const out: Shape = {}
  for (const field of fields) {
    const f = field as Field & { name?: string; fields?: Field[]; tabs?: Array<{ name?: string; fields: Field[] }>; blocks?: unknown[]; hasMany?: boolean; relationTo?: unknown; type: string }
    if (f.type === 'ui') continue
    if (f.type === 'tabs') {
      for (const tab of f.tabs ?? []) Object.assign(out, shape(tab.fields, tab.name ? `${prefix}${tab.name}.` : prefix))
      continue
    }
    if ((f.type === 'row' || f.type === 'collapsible') && !f.name) {
      Object.assign(out, shape(f.fields ?? [], prefix))
      continue
    }
    if (!f.name) continue
    const key = `${prefix}${f.name}`
    out[key] = [f.type, f.hasMany ? 'many' : '', f.relationTo ? JSON.stringify(f.relationTo) : ''].join(':')
    if (f.fields) Object.assign(out, shape(f.fields, `${key}.`))
  }
  return out
}

async function load(file: string) {
  const config = await (await import(pathToFileURL(path.resolve(file)).href)).default
  const entities: Record<string, Shape> = {}
  for (const c of config.collections) entities[`collection:${c.slug}`] = shape(c.fields)
  for (const g of config.globals) entities[`global:${g.slug}`] = shape(g.fields)
  return entities
}

const [baseFile, currentFile = 'payload.config.ts'] = process.argv.slice(2)
if (!baseFile) throw new Error('Usage: studio-shape-check.ts <base payload.config.ts> [current]')
const [base, current] = await Promise.all([load(baseFile), load(currentFile)])
const problems: string[] = []
const added: string[] = []
for (const key of new Set([...Object.keys(base), ...Object.keys(current)])) {
  const a = base[key] ?? {}
  const b = current[key] ?? {}
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[name] === b[name]) continue
    if (!(name in a) && name === 'displayTitle') {
      added.push(`${key}.displayTitle`)
      continue
    }
    problems.push(`${key}.${name}: ${a[name] ?? '(absent)'} → ${b[name] ?? '(absent)'}`)
  }
}
console.log(`Allowed additions (${added.length}): ${added.join(', ')}`)
if (problems.length) {
  console.error(`Data-shape differences:\n${problems.join('\n')}`)
  process.exit(1)
}
console.log(`✓ No other data-shape change across ${Object.keys(current).length} collections and globals.`)
process.exit(0)
