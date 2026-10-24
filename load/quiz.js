// Chapter quizzes: start, autosave answers, submit. Use a chapter quiz (the final exam needs a paid
// certificate). Each learner gets 3 attempts, then a cooldown: those 429s count as expected here.
//   k6 run -e BASE_URL=http://localhost:3001 -e QUIZ_ID=21 -e LOAD_USERS="a@test.local:pw" load/quiz.js
import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE, auth, loginAll } from './lib.js'

const QUIZ_ID = __ENV.QUIZ_ID || '1'
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 429))

export const options = {
  scenarios: { quizzes: { executor: 'per-vu-iterations', vus: Number(__ENV.VUS || 100), iterations: 3, maxDuration: '15m' } },
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{name:start}': ['p(95)<800'], 'http_req_duration{name:submit}': ['p(95)<800'] },
}

export function setup() {
  return { tokens: loginAll() }
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length]
  const start = http.post(`${BASE}/api/quizzes/${QUIZ_ID}/start`, '{}', { ...auth(token), tags: { name: 'start' } })
  if (start.status === 429) {
    sleep(5)
    return
  }
  check(start, { 'start 201': (r) => r.status === 201 || r.status === 200 })
  const attemptId = start.json('data.attemptId')
  const questions = start.json('data.questions') || []
  if (!attemptId) return
  const answers = {}
  questions.forEach((question, index) => {
    answers[String(question.id)] = [Math.floor(Math.random() * ((question.options || []).length || 4))]
    if ((index + 1) % 5 === 0) {
      http.put(`${BASE}/api/quiz-attempts/${attemptId}/answers`, JSON.stringify({ answers }), { ...auth(token), tags: { name: 'save' } })
      sleep(5)
    }
  })
  check(http.post(`${BASE}/api/quiz-attempts/${attemptId}/submit`, JSON.stringify({ answers }), { ...auth(token), tags: { name: 'submit' } }), { 'submit 200': (r) => r.status === 200 })
  sleep(2)
}
