#!/usr/bin/env node
/**
 * SkillsAir Studio QA: screenshots (light/dark × 1440/390) and axe checks of admin screens.
 * Local and staging only. Uses the installed Chrome (playwright-core, channel "chrome").
 *
 *   STUDIO_URL=http://localhost:3002 STUDIO_QA_EMAIL=... STUDIO_QA_PASSWORD=... \
 *     node scripts/studio-qa.mjs [--out dir] [--axe] [--only overview,queue] [--role-email ... --role-password ...]
 *
 * Exits non-zero when axe finds serious or critical issues (with --axe).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { AxeBuilder } from '@axe-core/playwright'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

const base = (process.env.STUDIO_URL ?? 'http://localhost:3002').replace(/\/$/, '')
const email = process.env.STUDIO_QA_EMAIL
const password = process.env.STUDIO_QA_PASSWORD
const out = option('out', path.resolve('tmp/studio-qa'))
const only = option('only', '')?.split(',').filter(Boolean)
const themes = (option('themes', 'light,dark') ?? '').split(',')
const widths = (option('widths', '1440,390') ?? '').split(',').map(Number)

/** name -> path (or a function of ids discovered at runtime). */
const PAGES = {
  login: { path: '/admin/login', auth: false, axe: true },
  overview: { path: '/admin', axe: true },
  queue: { path: '/admin/queue', axe: true },
  lifecycle: { path: '/admin/lifecycle' },
  'applicants-list': { path: '/admin/collections/leads', axe: true },
  'applicant-edit': { path: async (api) => `/admin/collections/leads/${await api.firstId('leads', '-score')}`, axe: true },
  'programmes-list': { path: '/admin/collections/courses' },
  'programme-edit': { path: async (api) => `/admin/collections/courses/${await api.firstId('courses', '-updatedAt')}`, axe: true },
  'subscriptions-list': { path: '/admin/collections/subscriptions' },
  'orders-list': { path: '/admin/collections/orders' },
  'learners-list': { path: '/admin/collections/users' },
  'learner-edit': { path: async (api) => `/admin/collections/users/${await api.firstId('users', '-createdAt', 'where[role][equals]=student')}` },
  'scholarship-window': { path: '/admin/globals/scholarship-window' },
  'laptop-applications': { path: '/admin/collections/laptop-applications' },
  'lessons-list': { path: '/admin/collections/lessons' },
  'media-list': { path: '/admin/collections/media' },
  guide: { path: '/admin/guide' },
  'studio-kit': { path: '/admin/studio-kit' },
}

async function main() {
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const failures = []
  const report = []
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    if (email && password) {
      const response = await page.request.post(`${base}/api/users/login`, { data: { email, password }, headers: { Origin: base }, timeout: 180_000 })
      if (!response.ok()) throw new Error(`Login failed: ${response.status()}`)
    }
    const api = {
      async firstId(collection, sort, extra = '') {
        const response = await page.request.get(`${base}/api/${collection}?limit=1&depth=0&sort=${sort}${extra ? `&${extra}` : ''}`, { headers: { Origin: base } })
        const json = await response.json()
        return json?.docs?.[0]?.id ?? 'create'
      },
    }
    for (const [name, spec] of Object.entries(PAGES)) {
      if (only?.length && !only.includes(name)) continue
      const target = typeof spec.path === 'function' ? await spec.path(api) : spec.path
      for (const theme of themes) {
        await context.addCookies([{ name: 'payload-theme', value: theme, url: base }])
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        for (const width of widths) {
          if (spec.auth === false) await context.clearCookies({ name: 'payload-token' })
          await page.setViewportSize({ width, height: width < 600 ? 844 : 900 })
          const started = Date.now()
          const response = await page.goto(`${base}${target}`, { waitUntil: 'networkidle', timeout: 90_000 })
          const ms = Date.now() - started
          await page.waitForTimeout(1500)
          const file = path.join(out, `${name}--${theme}--${width}.png`)
          await page.screenshot({ path: file, fullPage: true })
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
          report.push({ name, theme, width, status: response?.status(), ms, overflow })
          if (overflow > 1) failures.push(`${name} ${theme} ${width}: horizontal overflow ${overflow}px`)
          if (flag('axe') && spec.axe && width === 1440) {
            const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
            const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
            writeFileSync(path.join(out, `${name}--${theme}--axe.json`), JSON.stringify(result.violations, null, 2))
            for (const violation of serious) {
              failures.push(`${name} ${theme}: axe ${violation.impact} ${violation.id} (${violation.nodes.length}) ${violation.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
            }
            report.push({ name, theme, axe: { serious: serious.length, total: result.violations.length } })
          }
          if (spec.auth === false && email && password) {
            await page.request.post(`${base}/api/users/login`, { data: { email, password }, headers: { Origin: base }, timeout: 180_000 })
          }
        }
      }
    }
  } finally {
    await browser.close()
  }
  writeFileSync(path.join(out, 'report.json'), JSON.stringify({ report, failures }, null, 2))
  for (const line of report) console.log(JSON.stringify(line))
  if (failures.length) {
    console.error(`\n${failures.length} issue(s):\n${failures.join('\n')}`)
    process.exit(1)
  }
  console.log(`\nScreenshots in ${out}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
