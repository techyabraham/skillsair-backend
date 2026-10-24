# Load tests (k6)

Scripts for [k6](https://k6.io/docs/get-started/installation/). Run them against **staging or a local
stack**, never production: `lib.js` refuses the production hosts. Use test learner accounts that exist
only on the target. Pass them in `LOAD_USERS` and never commit them.

| Script | What it simulates | Targets (p95) |
| --- | --- | --- |
| `catalog.js` | Anonymous visitors: catalogue and curriculum, ramping to 300 VUs | courses < 500 ms, curriculum < 400 ms |
| `learning.js` | Learners watching: curriculum, then a progress heartbeat every 30 s (500 VUs ≈ 17 requests/s) | heartbeat < 300 ms |
| `quiz.js` | Chapter quizzes: start, autosave, submit (3 attempts each, then the cooldown's 429s) | start and submit < 800 ms |

```bash
k6 run -e BASE_URL=http://localhost:3001 -e COURSE_ID=12 load/catalog.js
k6 run -e BASE_URL=http://localhost:3001 -e COURSE_ID=12 -e LESSON_ID=345 -e LOAD_USERS="learner1@test.local:pw" load/learning.js
k6 run -e BASE_URL=http://localhost:3001 -e QUIZ_ID=21 -e LOAD_USERS="learner1@test.local:pw" load/quiz.js
```

Notes:

- Rate limits are per IP, so from one machine you hit them first. Raise them on staging for the run, or
  run k6 from several machines.
- Watch the database while testing (PgBouncer pool use, slow queries) and Redis (the curriculum and
  quiz pools are cached for 10 minutes and retired when the programme changes).
- Record the results with the deployment revision and date in the pull request or DEPLOYMENT.md.
