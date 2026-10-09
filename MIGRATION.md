# Tutor LMS replacement data import

These importers consume normalized CSV files. Map/export the existing WordPress and Tutor LMS data to these columns before running them. They do not connect to WordPress directly. Run each command without `--execute` first; that mode reports planned changes and row failures without writing records.

The user collection now includes student audience, WordPress source-role, and communication-consent fields. Generate and apply a Payload/PostgreSQL schema migration containing these fields before running the importers; the data import scripts do not create database columns.

## Import every WordPress user and identify students

Export the complete WordPress user directory, not only users with the `student` or `subscriber` role. WordPress roles are not a reliable Tutor LMS enrollment list: keep them as source metadata and use the enrollment export to identify historical students.

The user CSV requires `email`; `first_name` and `last_name` are recommended. Optional columns are:

| Column | Meaning |
| --- | --- |
| `wp_user_id` | Original WordPress user ID, used for reconciliation. |
| `phone` | Optional E.164 phone number, for example `+2348012345678`. An invalid phone is omitted with a warning; the user record still imports. |
| `wp_roles` | Original WordPress roles, separated by `|`, `,`, or `;`. |
| `is_student` | Explicit student audience flag (`true`/`false`, `yes`/`no`, or `1`/`0`). Defaults to false when omitted. |
| `is_active` | Set false only when the source account should be disabled in SkillsAir. Defaults to true. |
| `marketing_consent` | `opted_in`, `opted_out`, or `unknown`; common yes/no equivalents are accepted. Blank defaults to `unknown`. |
| `marketing_consent_at` | ISO date/time for the recorded consent decision. |
| `marketing_consent_source` | Where/how that decision was recorded, if available. |

Example header and row:

```csv
wp_user_id,email,first_name,last_name,phone,wp_roles,is_student,is_active,marketing_consent,marketing_consent_at,marketing_consent_source
123,alex@example.com,Alex,Example,+2348012345678,subscriber,false,true,unknown,,
```

`import-users` creates every valid contact as a lowest-privilege SkillsAir account and retains WordPress roles in `wordpressRoles`. A WordPress administrator is **not** made a SkillsAir administrator. The SkillsAir `isStudent` flag is separate from the backend account role and does not grant course access by itself. A person who has any imported Tutor enrollment is automatically marked as a student, including completed or refunded historical enrollments. Set `is_student=true` in the user CSV for students who have no enrollment row. During a merge, the importer does not clear an existing true student flag; this preserves historical student membership when a later export omits or contradicts it. Reconcile false positives manually.

Marketing consent is not inferred from having a WordPress account, purchasing a course, or being a student. Blank consent imports as `unknown`; use `opted_in` for marketing only when the source export contains an affirmative record. Keep transactional notices separate from marketing lists and honor opt-outs in the sending system.

All rows need a valid, unique email. Resolve shared or invalid emails before importing. WordPress password hashes are not reused: imported users receive random inaccessible passwords and should use the password reset flow. User and enrollment imports suppress the normal welcome and enrollment-confirmation emails, so the migration does not automatically send messages to the directory. If an email already exists in SkillsAir, the user importer updates migration metadata only; it does not overwrite the existing name, phone, password, or SkillsAir role. Existing known marketing consent is preserved rather than overwritten from a potentially older export. Conflicting WordPress IDs and duplicate export rows are reported as failures for manual reconciliation.

After import, create a consent-filtered audience CSV without sending email:

```sh
node --loader ts-node/esm src/migrations/export-communications.ts students-opted-in.csv --segment=students --consent=opted_in
node --loader ts-node/esm src/migrations/export-communications.ts all-opted-in.csv --segment=all --consent=opted_in
```

By default, exports include active accounts only. Add `--include-inactive` to include deactivated accounts. Choose `--consent=unknown`, `--consent=opted_out`, or `--consent=all` only when you have a specific purpose and have checked the applicable communication rules. The export contains email, name, active/student flags, original WordPress roles, and consent fields; it omits phone numbers. It refuses to overwrite a file unless `--force` is supplied.

## Order

1. Export all WordPress users to `users.csv`, then run `npm run migrate:import:users -- users.csv` and review the dry-run output. Execute with `--execute` after resolving failures. This imports non-students too; enrollment rows mark students automatically.
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
