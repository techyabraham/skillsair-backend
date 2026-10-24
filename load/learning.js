// Learners watching lessons: curriculum load, then a progress heartbeat every 30 s (the player's rate).
//   k6 run -e BASE_URL=http://localhost:3001 -e COURSE_ID=12 -e LESSON_ID=345 -e LOAD_USERS="a@test.local:pw" load/learning.js
// The learners must be enrolled in COURSE_ID on the target. Heartbeats never complete a lesson.
import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE, auth, loginAll } from './lib.js'

const COURSE_ID = __ENV.COURSE_ID || '1'
const LESSON_ID = __ENV.LESSON_ID || '1'

export const options = {
  scenarios: {
    watching: { executor: 'constant-vus', vus: Number(__ENV.VUS || 500), duration: __ENV.DURATION || '10m' },
  },
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{name:heartbeat}': ['p(95)<300'], 'http_req_duration{name:curriculum}': ['p(95)<400'] },
}

export function setup() {
  return { tokens: loginAll() }
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length]
  check(http.get(`${BASE}/api/courses/${COURSE_ID}/curriculum`, { ...auth(token), tags: { name: 'curriculum' } }), { 'curriculum 200': (r) => r.status === 200 })
  for (let beat = 1; beat <= 10; beat++) {
    sleep(30)
    const res = http.post(`${BASE}/api/courses/${COURSE_ID}/lessons/${LESSON_ID}/progress`, JSON.stringify({ watchedSeconds: beat * 30 + __ITER, isCompleted: false }), { ...auth(token), tags: { name: 'heartbeat' } })
    check(res, { 'heartbeat 200': (r) => r.status === 200 })
  }
}
