# Tutor LMS replacement data import

These importers consume normalized CSV files. Map the existing WordPress/Tutor LMS export to these columns before running them. They do not connect to WordPress directly. Run each command without `--execute` first; that mode reports planned changes and row failures without writing records.

## Order

1. `npm run migrate:import:users -- users.csv --execute`
2. `npm run migrate:import:media -- media.csv --execute`
3. `npm run migrate:import:courses -- courses.csv --execute`
4. Create subscription plans in Payload, then `npm run migrate:import:enrollments -- enrollments.csv --execute`
5. `npm run migrate:import:orders -- orders.csv --execute`
6. `npm run migrate:import:learning -- subscriptions subscriptions.csv --execute`
7. `npm run migrate:import:learning -- prerequisites prerequisites.csv --execute`
8. `npm run migrate:import:learning -- quizzes quizzes.csv --execute`
9. `npm run migrate:import:learning -- progress progress.csv --execute`
10. `npm run migrate:import:learning -- quiz-attempts quiz-attempts.csv --execute`
11. `npm run migrate:import:learning -- reviews reviews.csv --execute`
12. `npm run migrate:import:learning -- discussions discussions.csv --execute`
13. `npm run migrate:import:learning -- certificates certificates.csv --execute`

For a dry run, remove `--execute`. Existing import scripts document their primary columns. `media.csv` requires `source_url`, `local_path`, and `alt`; files must already exist locally. Course rows now accept `is_published` (defaults to the course status), `course_short_description`, `course_description_json`, `course_thumbnail_source_url`, `course_preview_video`, `lesson_content_json`, and `lesson_attachment_source_urls_json`. Rich text JSON must be in Payload Lexical format. Each course row describes one lesson.

## Additional CSV columns

| Kind | Required columns | Optional columns |
| --- | --- | --- |
| subscriptions | `student_email`, `course_slug`, `plan_name`, `current_period_end` | `current_period_start`, `status`, `paystack_subscription_code`, `paystack_email_token` |
| prerequisites | `course_slug`, `prerequisite_slug` | |
| progress | `student_email`, `course_slug`, `lesson_slug` | `watched_seconds`, `is_completed`, `completed_at` |
| quizzes | `course_slug`, `quiz_title`, `question`, `options_json`, `correct_index` | `passing_score` |
| quiz-attempts | `student_email`, `course_slug`, `quiz_title`, `score` | `passed` |
| reviews | `student_email`, `course_slug`, `rating`, `body` | |
| discussions | `external_id`, `student_email`, `course_slug`, `body` | `lesson_slug`, `parent_external_id` |
| certificates | `student_email`, `course_slug`, `certificate_code`, `pdf_url` | `issued_at` |

`options_json` is a JSON array of option strings; `correct_index` starts at zero. Quiz rows with the same course and title form one quiz. Discussion parent rows must precede replies. Historical certificate PDF URLs must continue to resolve after cutover.

## Reconciliation before cutover

Compare user, course, section, lesson, enrollment, completed enrollment, order, subscription, quiz, progress, review, discussion, and certificate counts with the source export. Spot-check at least one free and one paid course, a prerequisite chain, a passing and failing quiz, an expired student with a course extension, a cancelled subscription, and a paid certificate. Confirm imported slugs and media URLs against the frontend. Imported WordPress passwords cannot be reused; send students through password reset.

Each subscription plan must point to one course and have a matching Paystack plan code. Paystack sends subscription identifiers and renewal invoices by webhook. Historical subscription entitlements require the separate subscription export because the order CSV does not contain billing period or Paystack subscription code.
