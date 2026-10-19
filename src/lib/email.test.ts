import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

process.env.JWT_SECRET ??= 'test-jwt-secret-0123456789abcdef0123456789'
process.env.FRONTEND_URL = 'https://skillsair.com'
process.env.BACKEND_URL = 'https://kiwi.skillsair.com'

const { createEmailToken, verifyEmailToken, listUnsubscribeHeaders } = await import('./email-tokens.js')
const { unsubscribeToken } = await import('./leads.js')
const { verifySvixSignature } = await import('./svix.js')
const { renderHtml, renderText, withUtm } = await import('../emails/layout.js')
const { emailTemplates } = await import('../emails/index.js')

test('email tokens round-trip for users and leads, and reject tampering', () => {
  const token = createEmailToken({ type: 'user', id: 42 }, 'unsub', 'learning')
  assert.deepEqual(verifyEmailToken(token), { type: 'user', id: 42, purpose: 'unsub', category: 'learning' })
  assert.equal(verifyEmailToken(createEmailToken({ type: 'lead', id: 7 }, 'prefs'))?.type, 'lead')
  const [body, signature] = token.split('.')
  const forged = Buffer.from(Buffer.from(body ?? '', 'base64url').toString().replace('42', '43')).toString('base64url')
  assert.equal(verifyEmailToken(`${forged}.${signature}`), null)
  assert.equal(verifyEmailToken('garbage'), null)
})

test('email tokens expire', () => {
  const issued = Date.parse('2026-01-01T00:00:00Z')
  const token = createEmailToken({ type: 'lead', id: 1 }, 'prefs', 'all', 30, issued)
  assert.ok(verifyEmailToken(token, issued + 29 * 86400_000))
  assert.equal(verifyEmailToken(token, issued + 31 * 86400_000), null)
})

test('older lead unsubscribe links still work', () => {
  assert.deepEqual(verifyEmailToken(unsubscribeToken(9)), { type: 'lead', id: 9, purpose: 'unsub', category: 'offers' })
})

test('one-click unsubscribe headers follow RFC 8058', () => {
  const headers = listUnsubscribeHeaders({ type: 'user', id: 3 }, 'offers')
  assert.match(headers['List-Unsubscribe'] ?? '', /^<https:\/\/kiwi\.skillsair\.com\/api\/email\/unsubscribe\?token=[^>]+>$/)
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
})

test('Svix signatures are verified, with replay protection', () => {
  const secretBytes = crypto.randomBytes(24)
  const secret = `whsec_${secretBytes.toString('base64')}`
  const body = '{"type":"email.bounced"}'
  const now = Date.now()
  const timestamp = String(Math.floor(now / 1000))
  const signature = crypto.createHmac('sha256', secretBytes).update(`msg_1.${timestamp}.${body}`).digest('base64')
  const headers = { id: 'msg_1', timestamp, signature: `v1,bogus v1,${signature}` }
  assert.equal(verifySvixSignature(body, headers, secret, now), true)
  assert.equal(verifySvixSignature(`${body} `, headers, secret, now), false)
  assert.equal(verifySvixSignature(body, headers, secret, now + 10 * 60_000), false)
  assert.equal(verifySvixSignature(body, headers, undefined, now), false)
})

test('the layout escapes text, has a preheader, one button and the right footer', () => {
  const input = {
    kind: 'marketing' as const,
    subject: 'Hi',
    preheader: 'Finish the thought',
    blocks: ['Hello <script>alert(1)</script> **there**'],
    button: { label: 'See my offer', url: 'https://skillsair.com/r/abc' },
    ps: 'Reply anytime.',
    preferencesUrl: 'https://skillsair.com/email-preferences?token=t',
    unsubscribeUrl: 'https://skillsair.com/email-preferences?token=t',
  }
  const html = renderHtml(input)
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('<strong>there</strong>'))
  assert.ok(html.includes('Finish the thought'))
  assert.ok(html.includes('Email preferences') && html.includes('Unsubscribe'))
  assert.equal((html.match(/background:#c2410c/g) ?? []).length, 1)
  const transactional = renderHtml({ ...input, kind: 'transactional' })
  assert.ok(!transactional.includes('said yes to updates'))
  const text = renderText(input)
  assert.ok(text.includes('See my offer: https://skillsair.com/r/abc') && text.includes('P.S. Reply anytime.'))
})

test('UTM tags only go on SkillsAir links', () => {
  assert.equal(
    withUtm('https://skillsair.com/r/abc', 'marketing', 'A', 'A1'),
    'https://skillsair.com/r/abc?utm_source=email&utm_medium=marketing&utm_campaign=A&utm_content=A1',
  )
  assert.equal(withUtm('https://checkout.paystack.com/x', 'marketing', 'A', 'A1'), 'https://checkout.paystack.com/x')
})

test('every template renders its sample with a subject, preheader, html and text', () => {
  for (const template of Object.values(emailTemplates)) {
    const rendered = template.renderSample()
    assert.ok(rendered.subject && rendered.preheader && rendered.html.includes('<html') && rendered.text.length > 20, template.id)
    assert.notEqual(rendered.subject, rendered.preheader, template.id)
  }
})
