import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountIdentity } from './rate-limiter.js'
import { trustedBffClientIp } from '../middleware/validate.js'

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null })
const SECRET = 'a'.repeat(40)

test('sign-in limits count per account: the same email in any case, never the address itself', () => {
  assert.equal(accountIdentity('Tobi@Example.com '), accountIdentity('tobi@example.com'))
  assert.notEqual(accountIdentity('tobi@example.com'), accountIdentity('ada@example.com'))
  assert.ok(!accountIdentity('tobi@example.com').includes('tobi'))
})

test('the frontend’s visitor IP is trusted only with the matching BFF key', () => {
  process.env.BFF_SHARED_SECRET = SECRET
  assert.equal(trustedBffClientIp(headers({ 'x-skillsair-bff-key': SECRET, 'x-skillsair-client-ip': '102.89.1.2' })), '102.89.1.2')
  assert.equal(trustedBffClientIp(headers({ 'x-skillsair-bff-key': `${SECRET.slice(1)}$`, 'x-skillsair-client-ip': '102.89.1.2' })), null)
  assert.equal(trustedBffClientIp(headers({ 'x-skillsair-bff-key': 'short', 'x-skillsair-client-ip': '102.89.1.2' })), null)
  assert.equal(trustedBffClientIp(headers({ 'x-skillsair-client-ip': '102.89.1.2' })), null)
  process.env.BFF_SHARED_SECRET = ''
  assert.equal(trustedBffClientIp(headers({ 'x-skillsair-bff-key': SECRET, 'x-skillsair-client-ip': '102.89.1.2' })), null)
})
