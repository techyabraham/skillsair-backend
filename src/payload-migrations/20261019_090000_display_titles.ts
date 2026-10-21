import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * SkillsAir Studio, human record titles (brief 6.3): adds `display_title` to the collections
 * that used to show as a bare id, and backfills it with the same text the beforeChange hook
 * (src/hooks/display-title.ts) writes for new and changed records. Adds a column only; no
 * existing column is changed.
 */
const TABLES = [
  'enrollments',
  'subscriptions',
  'messages',
  'reviews',
  'discussions',
  'laptop_applications',
  'access_extensions',
  'lesson_progress',
  'quiz_attempts',
  'referrals',
  'affiliates',
] as const

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const table of TABLES) {
    await db.execute(sql.raw(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "display_title" varchar;`))
  }

  for (const statement of BACKFILL) await db.execute(sql.raw(statement))
}

/** "First Last", else the email (same rule as the hook's nameOf). */
const name = (alias: string, last = true) =>
  `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM(${alias}.first_name), ''), ${last ? `NULLIF(TRIM(${alias}.last_name), '')` : 'NULL'})), ''), NULLIF(${alias}.email, ''))`

const BACKFILL = [
  `UPDATE "enrollments" t SET "display_title" = LEFT(CONCAT_WS(' · ', ${name('u')}, NULLIF(c.title, '')), 160)
   FROM "enrollments" e LEFT JOIN "users" u ON u.id = e.student_id LEFT JOIN "courses" c ON c.id = e.course_id
   WHERE t.id = e.id`,
  `UPDATE "subscriptions" t SET "display_title" = LEFT(CONCAT_WS(' · ', ${name('u')}, NULLIF(c.title, ''),
     CASE WHEN p.price IS NULL THEN NULL ELSE '₦' || TO_CHAR(p.price, 'FM999,999,999,990') || CASE WHEN p.interval = 'annually' THEN '/yr' ELSE '/mo' END END), 160)
   FROM "subscriptions" s LEFT JOIN "users" u ON u.id = s.user_id LEFT JOIN "courses" c ON c.id = s.course_id LEFT JOIN "plans" p ON p.id = s.plan_id
   WHERE t.id = s.id`,
  `UPDATE "messages" t SET "display_title" = LEFT(CONCAT_WS(' · ', NULLIF(m.step_id, ''), m.channel::text, COALESCE(${name('u')}, ${name('l', false)})), 160)
   FROM "messages" m LEFT JOIN "messages_rels" r ON r.parent_id = m.id AND r.path = 'person'
   LEFT JOIN "users" u ON u.id = r.users_id LEFT JOIN "leads" l ON l.id = r.leads_id
   WHERE t.id = m.id`,
  `UPDATE "reviews" t SET "display_title" = LEFT(CONCAT_WS(' · ', '★' || r.rating::int, ${name('u')}, NULLIF(c.title, '')), 160)
   FROM "reviews" r LEFT JOIN "users" u ON u.id = r.student_id LEFT JOIN "courses" c ON c.id = r.course_id
   WHERE t.id = r.id`,
  `UPDATE "discussions" t SET "display_title" = CASE WHEN LENGTH(f.flat) > 60 THEN RTRIM(LEFT(f.flat, 59)) || '…' ELSE NULLIF(f.flat, '') END
   FROM (SELECT id, TRIM(REGEXP_REPLACE(COALESCE(body, ''), '[[:space:]]+', ' ', 'g')) AS flat FROM "discussions") f
   WHERE t.id = f.id`,
  `UPDATE "laptop_applications" t SET "display_title" = LEFT(CONCAT_WS(' · ', ${name('u')},
     CASE WHEN a.cohort_label IS NULL OR a.cohort_label = '' THEN NULL WHEN a.cohort_label ~* 'cohort$' THEN a.cohort_label ELSE a.cohort_label || ' cohort' END), 160)
   FROM "laptop_applications" a LEFT JOIN "users" u ON u.id = a.user_id
   WHERE t.id = a.id`,
  `UPDATE "access_extensions" t SET "display_title" = LEFT(CONCAT_WS(' · ', ${name('u')}, COALESCE(NULLIF(c.title, ''), 'All programmes'),
     CASE WHEN x.days_added IS NULL THEN NULL ELSE '+' || x.days_added::int || ' days' END), 160)
   FROM "access_extensions" x LEFT JOIN "users" u ON u.id = x.student_id LEFT JOIN "courses" c ON c.id = x.course_id
   WHERE t.id = x.id`,
  `UPDATE "lesson_progress" t SET "display_title" = LEFT(CONCAT_WS(' · ', ${name('u')}, NULLIF(le.title, '')), 160)
   FROM "lesson_progress" p LEFT JOIN "users" u ON u.id = p.student_id LEFT JOIN "lessons" le ON le.id = p.lesson_id
   WHERE t.id = p.id`,
  `UPDATE "quiz_attempts" t SET "display_title" = LEFT(CONCAT_WS(' · ', ${name('u')}, NULLIF(q.title, ''), CASE WHEN a.score IS NULL THEN NULL ELSE a.score::int || '%' END), 160)
   FROM "quiz_attempts" a LEFT JOIN "users" u ON u.id = a.student_id LEFT JOIN "quizzes" q ON q.id = a.quiz_id
   WHERE t.id = a.id`,
  `UPDATE "referrals" t SET "display_title" = LEFT(CASE WHEN ${name('f')} IS NOT NULL AND ${name('r')} IS NOT NULL THEN ${name('f')} || ' → ' || ${name('r')} ELSE COALESCE(${name('f')}, ${name('r')}) END, 160)
   FROM "referrals" x LEFT JOIN "users" f ON f.id = x.referrer_id LEFT JOIN "users" r ON r.id = x.referred_user_id
   WHERE t.id = x.id`,
  `UPDATE "affiliates" t SET "display_title" = LEFT(CONCAT_WS(' · ', ${name('u')}, NULLIF(a.affiliate_code, '')), 160)
   FROM "affiliates" a LEFT JOIN "users" u ON u.id = a.user_id
   WHERE t.id = a.id`,
]

export async function down({ db }: MigrateDownArgs): Promise<void> {
  for (const table of TABLES) {
    await db.execute(sql.raw(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "display_title";`))
  }
}
