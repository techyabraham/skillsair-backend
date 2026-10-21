#!/usr/bin/env node
/**
 * WCAG contrast check for SkillsAir Studio. Reads the generated tokens.css and theme.css,
 * resolves every pair in admin-theme.config.mjs `contrastPairs` in light and dark, and exits
 * non-zero if any pair is below its threshold (4.5:1 text, 3:1 large text/UI).
 *
 * Usage: node scripts/check-admin-contrast.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contrast } from './admin-color.mjs'
import { contrastPairs } from './admin-theme.config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const styles = path.join(root, 'src', 'app', '(payload)', 'styles')
const css = ['tokens.css', 'theme.css'].map((file) => readFileSync(path.join(styles, file), 'utf8')).join('\n')

/** Collects `--name: value;` declarations from the :root block and the dark block. */
function collect(source) {
  const light = {}
  const dark = {}
  const blocks = source.split(/(?=:root\s*\{|html\[data-theme='dark'\]\s*\{)/)
  for (const block of blocks) {
    const target = block.startsWith('html[') ? dark : block.startsWith(':root') ? light : null
    if (!target) continue
    for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) target[match[1]] = match[2].trim()
  }
  return { light, dark: { ...light, ...dark } }
}

function resolve(vars, name, depth = 0) {
  const value = vars[name]
  if (!value || depth > 8) return undefined
  const ref = value.match(/^var\((--[\w-]+)\)$/)
  return ref ? resolve(vars, ref[1], depth + 1) : value
}

const themes = collect(css)
let failures = 0
for (const [theme, vars] of Object.entries(themes)) {
  for (const [fg, bg, min] of contrastPairs) {
    const fgName = fg.startsWith('--') ? fg : `--sa-${fg}`
    const bgName = bg.startsWith('--') ? bg : `--sa-${bg}`
    const a = resolve(vars, fgName)
    const b = resolve(vars, bgName)
    if (!a?.startsWith('#') || !b?.startsWith('#')) {
      console.error(`✗ ${theme}: cannot resolve ${fgName} (${a}) or ${bgName} (${b})`)
      failures++
      continue
    }
    const ratio = contrast(a, b)
    const ok = ratio >= min
    if (!ok) failures++
    if (!ok || process.argv.includes('--verbose')) {
      console.log(`${ok ? '✓' : '✗'} ${theme.padEnd(5)} ${fgName} ${a} on ${bgName} ${b}: ${ratio.toFixed(2)} (min ${min})`)
    }
  }
}
if (failures) {
  console.error(`\n${failures} contrast pair(s) below threshold.`)
  process.exit(1)
}
console.log(`All ${contrastPairs.length * 2} contrast pairs pass in light and dark.`)
