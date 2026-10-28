# SkillsAir backend

Payload CMS provides content and admin editing; the custom endpoints handle student actions and Paystack payments. See [MIGRATION.md](MIGRATION.md) for the Tutor LMS import sequence.

The Payload admin panel is a separate Next.js service. See [ADMIN-DEPLOYMENT.md](ADMIN-DEPLOYMENT.md) for its Coolify setup.

## Learning flow

- A course has ordered sections and lessons, optional prerequisite courses, and published quizzes. A prerequisite is satisfied by a completed enrollment.
- Free courses use `POST /courses/:courseId/enroll`. Paid courses use `POST /payments/initiate` with `type: "course"` and `courseId`.
- A plan belongs to exactly one course. `POST /subscriptions/subscribe` with `planId` starts recurring billing for that course. A student can subscribe to multiple courses. The generic payment initiation endpoint also accepts `type: "subscription"` with `planId`.
- Subscription access ends at `currentPeriodEnd`. Cancellation takes `subscriptionId` in `POST /subscriptions/cancel` and preserves access until that period ends. An admin can grant an additional course-specific period through `/admin/extend-access`.
- `POST /courses/:courseId/lessons/:lessonId/progress` records viewing progress. Published lessons and quizzes must be complete before the course completes. `POST /quizzes/:quizId/submit` accepts `{ "answers": [{ "questionId": 1, "optionIndex": 0 }] }` and grades on the server.
- Enrolled students can post reviews with `POST /courses/:courseId/reviews` and discussions with `POST /courses/:courseId/discussions` (`body`, optional `lessonId` and `parentId`). Published quiz questions, reviews, and discussions can be read through Payload's collection API. Correct quiz answer indices are restricted to staff.
- When `CERTIFICATE_PRICE_NGN` is greater than zero, completion does not issue a certificate. The student buys one through `POST /certificates/purchase`. Admins may issue one manually. Set the price to zero for automatic issuance on completion.

## Payment recovery

Successful orders carry `fulfilledAt`. The webhook and verification endpoint fulfill orders immediately. A job retries successful orders without `fulfilledAt` every five minutes. Set the Paystack webhook URL to `/payments/webhook`; the `/subscriptions/webhook` alias handles the same events. Paystack subscription creation and paid invoice events link and extend the matching course subscription.

Run `npm run typecheck` after making changes. Schema changes require applying the corresponding Payload database migration before deploying the new code. Set `BACKEND_URL` to the public API origin.

## Tests

`npm test` runs the Vitest specs (`src/**/*.spec.ts`) and then the older node:test files (`npm run test:legacy`). Integration specs boot Payload's local API against a disposable local Postgres named by `TEST_DATABASE_URI`, apply every registered migration the way `npm run migrate:fallback` does, and empty tables between tests. Without `TEST_DATABASE_URI` they are skipped with a message. Never point it at staging or production: the harness refuses any host other than localhost. Redis is replaced by an in-memory fake in specs (`src/test/fake-redis.ts`).

```sh
initdb -D ./.local-dev/pg -U postgres --auth=trust
pg_ctl -D ./.local-dev/pg -o "-p 55432" start
createdb -h localhost -p 55432 -U postgres amb_test
TEST_DATABASE_URI=postgres://postgres@localhost:55432/amb_test npm test
```
