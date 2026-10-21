#!/usr/bin/env node
/**
 * Studio behaviour checks in a real browser (local or staging; installed Chrome via playwright-core):
 *   1. Imisi's queue: "Mark done" removes the card and the nav badge drops by one (then the lead
 *      is put back in the queue through the REST API, so the check leaves data as it found it).
 *   2. Command bar: Ctrl K opens it, typing finds a programme, Enter opens it.
 *   3. Instructor: sees the instructor Overview and is refused /admin/queue and /admin/lifecycle.
 *   4. Phone width (390px): the queue's reply, WhatsApp and Mark done controls are visible and ≥ 44px.
 *
 *   STUDIO_URL=… STUDIO_QA_EMAIL=… STUDIO_QA_PASSWORD=… STUDIO_QA_INSTRUCTOR_EMAIL=… STUDIO_QA_INSTRUCTOR_PASSWORD=… node scripts/studio-e2e.mjs
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = (process.env.STUDIO_URL ?? 'http://localhost:3002').replace(/\/$/, '')
const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push(`✓ ${name}`)
  } catch (error) {
    results.push(`✗ ${name}: ${error.message}`)
  }
}

async function login(context, email, password) {
  const response = await context.request.post(`${base}/api/users/login`, { data: { email, password }, timeout: 180_000 })
  assert.ok(response.ok(), `login failed (${response.status()})`)
}

const browser = await chromium.launch({ channel: 'chrome' })
try {
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await login(admin, process.env.STUDIO_QA_EMAIL, process.env.STUDIO_QA_PASSWORD)
  const page = await admin.newPage()

  await check('Queue: Mark done removes the card and updates the nav badge', async () => {
    await page.goto(`${base}/admin/queue`, { waitUntil: 'networkidle', timeout: 120_000 })
    const badge = page.locator('#nav-queue .sa-nav__badge [aria-hidden="true"]')
    const before = Number(await badge.textContent())
    const cards = page.locator('.sa-queue__card')
    const countBefore = await cards.count()
    assert.ok(countBefore > 0, 'queue is empty')
    const first = cards.first()
    const href = await first.locator('.sa-queue__name a').getAttribute('href')
    const id = href.split('/').pop()
    await first.getByRole('button', { name: /Mark done/ }).click()
    await page.waitForFunction((n) => document.querySelectorAll('.sa-queue__card').length === n - 1, countBefore, { timeout: 15_000 })
    await page.waitForTimeout(300)
    const after = Number((await badge.count()) ? await badge.textContent() : 0)
    assert.equal(after, before - 1, `badge ${before} -> ${after}`)
    // Put the lead back so the check leaves the data unchanged.
    // Best effort: a failed clean-up shouldn't fail the behaviour being checked.
    const restore = await admin.request.patch(`${base}/api/leads/${id}`, { data: { needsHuman: true }, headers: { Origin: base }, timeout: 30_000 }).catch((error) => error)
    if (!(restore?.ok?.())) console.warn(`Note: couldn't put lead ${id} back in the queue (${restore?.status?.() ?? restore?.message}); set needsHuman = true on it by hand.`)
  })

  await check('Command bar: Ctrl K, search a programme, Enter opens it', async () => {
    await page.goto(`${base}/admin`, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.locator('.sa-cmd__trigger').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox')
    await input.waitFor({ state: 'visible', timeout: 10_000 })
    await input.fill('Data')
    const option = page.getByRole('option', { name: /Data Analysis/ }).first()
    await option.waitFor({ timeout: 15_000 })
    await option.hover()
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/admin\/collections\/courses\/\d+/, { timeout: 30_000 })
  })

  await check('Queue on a 390px phone: actions visible with 44px targets', async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await login(phone, process.env.STUDIO_QA_EMAIL, process.env.STUDIO_QA_PASSWORD)
    const p = await phone.newPage()
    await p.goto(`${base}/admin/queue`, { waitUntil: 'networkidle', timeout: 120_000 })
    const card = p.locator('.sa-queue__card').first()
    for (const name of [/Reply on WhatsApp/, /Mark done/]) {
      const box = await card.getByRole('button', { name }).boundingBox()
      assert.ok(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390, `${name} target ${JSON.stringify(box)}`)
    }
    const wa = await card.getByRole('link', { name: /Open WhatsApp app/ }).boundingBox()
    assert.ok(wa && wa.height >= 44, 'WhatsApp link target')
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`)
    await phone.close()
  })

  if (process.env.STUDIO_QA_INSTRUCTOR_EMAIL) {
    const teacher = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await login(teacher, process.env.STUDIO_QA_INSTRUCTOR_EMAIL, process.env.STUDIO_QA_INSTRUCTOR_PASSWORD)
    const t = await teacher.newPage()
    await check('Instructor: sees their own Overview, no revenue or applicants', async () => {
      await t.goto(`${base}/admin`, { waitUntil: 'networkidle', timeout: 120_000 })
      await t.getByRole('heading', { name: 'My programmes' }).waitFor({ timeout: 10_000 })
      assert.equal(await t.getByText('Revenue over time').count(), 0, 'revenue panel shown')
      assert.equal(await t.getByText('Admissions funnel').count(), 0, 'funnel shown')
      assert.equal(await t.locator('#nav-queue').count(), 0, 'queue link in nav')
    })
    for (const path of ['/admin/queue', '/admin/lifecycle', '/admin/studio-kit']) {
      await check(`Instructor: ${path} says "Not available for your role"`, async () => {
        await t.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 120_000 })
        await t.getByText('Not available for your role').waitFor({ timeout: 10_000 })
        assert.equal(await t.locator('.sa-queue__card, .sa-lifecycle__table').count(), 0, 'data rendered')
      })
    }
    await teacher.close()
  }
} finally {
  await browser.close()
}

console.log(results.join('\n'))
if (results.some((line) => line.startsWith('✗'))) process.exit(1)
