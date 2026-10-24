// Public catalogue and programme pages' API calls (anonymous visitors).
//   k6 run -e BASE_URL=http://localhost:3001 -e COURSE_ID=12 load/catalog.js
import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE } from './lib.js'

const COURSE_ID = __ENV.COURSE_ID || '1'

export const options = {
  scenarios: {
    browse: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '1m', target: 100 }, { duration: '3m', target: 300 }, { duration: '1m', target: 0 }] },
  },
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{name:courses}': ['p(95)<500'], 'http_req_duration{name:curriculum}': ['p(95)<400'] },
}

export default function () {
  check(http.get(`${BASE}/api/courses?limit=50&depth=1&where[status][equals]=published`, { tags: { name: 'courses' } }), { 'courses 200': (r) => r.status === 200 })
  check(http.get(`${BASE}/api/courses/${COURSE_ID}/curriculum`, { tags: { name: 'curriculum' } }), { 'curriculum 200': (r) => r.status === 200 })
  sleep(1 + Math.random() * 2)
}
