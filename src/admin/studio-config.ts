/**
 * SkillsAir Studio navigation: groups (in order), friendly labels and each entity's place.
 * Labels only: slugs, API routes and GraphQL names are unchanged (GraphQL names come from slugs).
 * Collections import STUDIO_GROUP for `admin.group`; the custom nav (src/admin/nav) uses the
 * order below. Kept free of React so the API build (tsc over src/**\/*.ts) can import it.
 */

export const STUDIO_GROUP = {
  overview: 'Overview',
  admissions: 'Admissions',
  revenue: 'Revenue',
  ambassadors: 'Ambassadors',
  learning: 'Learning',
  learners: 'Learners',
  messaging: 'Messaging',
  website: 'Website',
} as const

export type StudioGroup = (typeof STUDIO_GROUP)[keyof typeof STUDIO_GROUP]

/** Group order and, inside each group, entity order (collection or global slugs). */
export const STUDIO_NAV_ORDER: Array<{ group: StudioGroup; slugs: string[] }> = [
  { group: STUDIO_GROUP.admissions, slugs: ['leads', 'scholarship-window', 'laptop-applications'] },
  { group: STUDIO_GROUP.revenue, slugs: ['orders', 'subscriptions', 'plans', 'affiliates', 'referrals'] },
  {
    group: STUDIO_GROUP.ambassadors,
    slugs: [
      'ambassadors', 'ambassador-payouts', 'ambassador-ledger', 'referral-attributions', 'referral-clicks',
      'ambassador-bank-accounts', 'ambassador-audit-log', 'ambassador-settings',
    ],
  },
  { group: STUDIO_GROUP.learning, slugs: ['courses', 'sections', 'lessons', 'quizzes', 'quiz-questions', 'certificates'] },
  {
    group: STUDIO_GROUP.learners,
    slugs: ['users', 'enrollments', 'lesson-progress', 'quiz-attempts', 'access-extensions', 'reviews', 'discussions'],
  },
  { group: STUDIO_GROUP.messaging, slugs: ['messages', 'email-content', 'email-overrides', 'email-override-history', 'newsletter-subscribers'] },
  { group: STUDIO_GROUP.website, slugs: ['categories', 'pages', 'posts', 'media'] },
]

/** Imisi's working hours (owner input; default Mon–Sat 9am–6pm WAT). */
export const WORKING_HOURS = { days: [1, 2, 3, 4, 5, 6], startHour: 9, endHour: 18, label: 'Mon–Sat 9–6' }

export const ADMIN_ROUTE = '/admin'
