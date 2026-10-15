import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { sendTemplate, sendText, verifyWhatsAppSignature } from './whatsapp.js'

test('signature verification accepts the genuine body and rejects tampering', () => {
  process.env.WHATSAPP_APP_SECRET = 'test-app-secret'
  const body = JSON.stringify({ entry: [{ changes: [] }] })
  const signature = `sha256=${crypto.createHmac('sha256', 'test-app-secret').update(body).digest('hex')}`
  assert.equal(verifyWhatsAppSignature(body, signature), true)
  assert.equal(verifyWhatsAppSignature(`${body} `, signature), false)
  assert.equal(verifyWhatsAppSignature(body, 'sha256=deadbeef'), false)
  assert.equal(verifyWhatsAppSignature(body, null), false)
})

test('nothing is sent unless WHATSAPP_ENABLED is exactly "true"', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = (async () => {
    called = true
    return new Response('{}')
  }) as typeof fetch
  try {
    for (const value of [undefined, 'false', 'TRUE', '1']) {
      if (value === undefined) delete process.env.WHATSAPP_ENABLED
      else process.env.WHATSAPP_ENABLED = value
      assert.deepEqual(await sendTemplate('+2348000000000', 'skillsair_offer_ready'), { sent: false, skipped: 'disabled' })
      assert.deepEqual(await sendText('+2348000000000', 'hello'), { sent: false, skipped: 'disabled' })
    }
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.WHATSAPP_ENABLED
  }
})

test('the AI assistant stays off unless WHATSAPP_AI_ASSISTANT is exactly "true"', async () => {
  const { assistantEnabled, assistantReply } = await import('./ai-assistant.js')
  for (const value of [undefined, 'false', 'TRUE', '1']) {
    if (value === undefined) delete process.env.WHATSAPP_AI_ASSISTANT
    else process.env.WHATSAPP_AI_ASSISTANT = value
    assert.equal(assistantEnabled(), false)
    assert.equal(await assistantReply('How much is it?', { firstName: 'Tobi' }), null)
  }
  delete process.env.WHATSAPP_AI_ASSISTANT
})
