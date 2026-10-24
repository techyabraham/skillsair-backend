// Shared helpers for the k6 scripts. Run against staging or a local stack only, never production.
import http from 'k6/http'
import { check, fail } from 'k6'

export const BASE = (__ENV.BASE_URL || 'http://localhost:3001').replace(/\/$/, '')

if (/^https:\/\/(www\.)?(skillsair\.com|kiwi\.skillsair\.com)/.test(BASE) && __ENV.I_KNOW_THIS_IS_PRODUCTION !== 'yes') {
  fail(`Refusing to load-test ${BASE}. Point BASE_URL at staging or localhost.`)
}

/** Logs in the test learners from LOAD_USERS ("email:password,email:password"); returns bearer tokens. */
export function loginAll() {
  const users = (__ENV.LOAD_USERS || '').split(',').map((pair) => pair.trim()).filter(Boolean)
  if (!users.length) fail('Set LOAD_USERS to test learner accounts on the target (email:password,...).')
  return users.map((pair) => {
    const split = pair.indexOf(':')
    const res = http.post(`${BASE}/api/users/login`, JSON.stringify({ email: pair.slice(0, split), password: pair.slice(split + 1) }), { headers: { 'Content-Type': 'application/json' } })
    check(res, { 'login 200': (r) => r.status === 200 })
    return res.json('token')
  })
}

export const auth = (token) => ({ headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
