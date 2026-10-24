# Assessments

How quizzes, the final exam and certificates work (Learning Quality build). Code:
`src/lib/assessments.ts` (pure rules), `src/lib/assessment-service.ts` (database), `src/endpoints/assessments/`.

## Kinds

| Kind | Where | Questions | Time | Attempts | Pass | Feedback |
| --- | --- | --- | --- | --- | --- | --- |
| `knowledge_check` | After a lesson's video | 3 from the lesson | none | unlimited | not graded for progress | right/wrong and explanation |
| `chapter` | End of each chapter | 10 drawn from the chapter pool (at least 12 approved) | none | 3, then a 10-minute cooldown | 70% | per-question explanations |
| `final_exam` | After every lesson and chapter quiz, once the certificate is paid for | 40 in 60 minutes (30 in 45 under 15 hours), weighted by chapter length, at least 2 per chapter | timed | 3, then 48 hours | 70%; 85%+ is "Passed with distinction" | score and per-chapter scores only |

Per-quiz fields override these defaults, and so does the `EXAM_DEFAULTS` environment variable.
Only chapter quizzes count towards programme completion.

## Rules that keep it fair

- **Answers never reach the browser.** `correctIndexes`, explanations and pools are staff-only fields;
  attempts store the served question ids and each question's shuffled option order, and scoring
  happens on the server against the original indexes.
- **Timer on the server.** `expiresAt` = start + time limit × the learner's `examTimeMultiplier`
  (an admin sets extra time in Learner 360). Submissions are accepted until 30 seconds after; a job
  closes expired attempts every minute and scores what was autosaved.
- **One open attempt per learner and quiz** (a partial unique index); starting again resumes it.
- Autosave every 5 seconds (`PUT /api/quiz-attempts/:id/answers`), rate-limited.

## Certificates: pay, then the exam

1. Paying for the certificate creates a `certificate-entitlements` row (`awaiting_exam`) and sends T12
   "Your final exam is ready".
2. Passing the exam issues the certificate (with the result band), then marks the entitlement `passed`.
   If issuing fails, a job retries every 5 minutes.
3. A programme with no published final exam issues the certificate straight after payment, as before.

## Question bank and item analysis

Questions come from content packs (`npm run content:import`), keyed by a stable `key`; questions
removed from a pack are retired, not deleted, so past attempts keep them. Every night (03:15 Lagos)
item analysis stores each question's p-value and point-biserial discrimination; once a question has
30+ answers it is flagged when over 95% or under 25% of learners get it right, or when its
discrimination is under 0.1. Review flagged questions in Studio → Question bank.

Before publishing: each chapter quiz needs 12+ approved chapter-pool questions, and the exam pool
needs at least 2.5 × the draw count, covering every chapter. Studio shows both checks.
