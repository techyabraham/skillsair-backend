import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import { seoPlugin } from '@payloadcms/plugin-seo'
import { resendAdapter } from '@payloadcms/email-resend'

import { Users } from './src/collections/Users.js'
import { Media } from './src/collections/Media.js'
import { Categories } from './src/collections/Categories.js'
import { Plans } from './src/collections/Plans.js'
import { Courses } from './src/collections/Courses.js'
import { Sections } from './src/collections/Sections.js'
import { Lessons } from './src/collections/Lessons.js'
import { Enrollments } from './src/collections/Enrollments.js'
import { LessonProgress } from './src/collections/LessonProgress.js'
import { Orders } from './src/collections/Orders.js'
import { Certificates } from './src/collections/Certificates.js'
import { CertificateEntitlements } from './src/collections/CertificateEntitlements.js'
import { Subscriptions } from './src/collections/Subscriptions.js'
import { Affiliates } from './src/collections/Affiliates.js'
import { Referrals } from './src/collections/Referrals.js'
import { AccessExtensions } from './src/collections/AccessExtensions.js'
import { Pages } from './src/collections/Pages.js'
import { Posts } from './src/collections/Posts.js'
import { Quizzes } from './src/collections/Quizzes.js'
import { QuizQuestions } from './src/collections/QuizQuestions.js'
import { QuizAttempts } from './src/collections/QuizAttempts.js'
import { Reviews } from './src/collections/Reviews.js'
import { Discussions } from './src/collections/Discussions.js'
import { NewsletterSubscribers } from './src/collections/NewsletterSubscribers.js'
import { Leads } from './src/collections/Leads.js'
import { LaptopApplications } from './src/collections/LaptopApplications.js'
import { Messages } from './src/collections/Messages.js'
import { EmailOverrideHistory, EmailOverrides } from './src/collections/EmailOverrides.js'
import { Ambassadors } from './src/collections/ambassadors/Ambassadors.js'
import { AmbassadorBankAccounts } from './src/collections/ambassadors/AmbassadorBankAccounts.js'
import { ReferralClicks } from './src/collections/ambassadors/ReferralClicks.js'
import { ReferralAttributions } from './src/collections/ambassadors/ReferralAttributions.js'
import { AmbassadorLedger } from './src/collections/ambassadors/AmbassadorLedger.js'
import { AmbassadorPayouts } from './src/collections/ambassadors/AmbassadorPayouts.js'
import { AmbassadorAuditLog } from './src/collections/ambassadors/AmbassadorAuditLog.js'
import { ScholarshipWindow } from './src/globals/ScholarshipWindow.js'
import { AmbassadorSettings } from './src/globals/AmbassadorSettings.js'
import { EmailContent } from './src/globals/EmailContent.js'

import { ambassadorTrackEndpoint } from './src/endpoints/ambassadors/track.js'
import { ambassadorAdminEndpoints } from './src/endpoints/ambassadors/admin.js'
import { ambassadorPayoutListEndpoint, ambassadorPayoutRequestEndpoint } from './src/endpoints/ambassadors/payouts.js'
import {
  ambassadorApplyEndpoint,
  ambassadorBanksEndpoint,
  ambassadorConfigEndpoint,
  ambassadorResendVerificationEndpoint,
  ambassadorResolveBankEndpoint,
  ambassadorVerifyEmailEndpoint,
} from './src/endpoints/ambassadors/public.js'
import {
  ambassadorBankAccountEndpoint,
  ambassadorEarningsEndpoint,
  ambassadorMeEndpoint,
  ambassadorReferralsEndpoint,
  ambassadorSummaryEndpoint,
} from './src/endpoints/ambassadors/me.js'
import { registerEndpoint } from './src/endpoints/auth/register.js'
import { loginEndpoint } from './src/endpoints/auth/login.js'
import { logoutEndpoint } from './src/endpoints/auth/logout.js'
import { refreshEndpoint } from './src/endpoints/auth/refresh.js'
import { forgotPasswordEndpoint } from './src/endpoints/auth/forgot-password.js'
import { resetPasswordEndpoint } from './src/endpoints/auth/reset-password.js'
import { enrollEndpoint } from './src/endpoints/courses/enroll.js'
import { progressEndpoint } from './src/endpoints/courses/progress.js'
import { completeEndpoint } from './src/endpoints/courses/complete.js'
import { reviewEndpoint } from './src/endpoints/courses/review.js'
import { discussEndpoint } from './src/endpoints/courses/discuss.js'
import { mountPrefixedEndpoints } from './src/lib/endpoint-mounting.js'
import { quizSubmitEndpoint } from './src/endpoints/courses/quiz-submit.js'
import { lessonResourceEndpoint, videoStreamEndpoint } from './src/endpoints/stream/video.js'
import { lessonCaptionsEndpoint } from './src/endpoints/stream/captions.js'
import { queueCaptionsImportEndpoint, restoreContentHistoryEndpoint, retryWorkTaskEndpoint } from './src/endpoints/admin/learning.js'
import { initiatePaymentEndpoint } from './src/endpoints/payments/initiate.js'
import { paystackWebhookEndpoint } from './src/endpoints/payments/webhook.js'
import { verifyPaymentEndpoint } from './src/endpoints/payments/verify.js'
import { generateCertificateEndpoint } from './src/endpoints/certificates/generate.js'
import { verifyCertificateEndpoint } from './src/endpoints/certificates/verify.js'
import { purchaseCertificateEndpoint } from './src/endpoints/certificates/purchase.js'
import { subscribeEndpoint } from './src/endpoints/subscriptions/subscribe.js'
import { cancelSubscriptionEndpoint } from './src/endpoints/subscriptions/cancel.js'
import { subscriptionWebhookEndpoint } from './src/endpoints/subscriptions/webhook.js'
import { affiliateDashboardEndpoint } from './src/endpoints/affiliates/dashboard.js'
import { trackAffiliateEndpoint } from './src/endpoints/affiliates/track.js'
import { extendAccessEndpoint } from './src/endpoints/admin/extend-access.js'
import { manualEnrolEndpoint } from './src/endpoints/admin/manual-enrol.js'
import { graphqlGetEndpoint, graphqlPostEndpoint } from './src/endpoints/graphql/handler.js'
import { updateProfileEndpoint } from './src/endpoints/profile/update.js'
import { getPreferencesEndpoint, updatePreferencesEndpoint } from './src/endpoints/profile/preferences.js'
import { changePasswordEndpoint } from './src/endpoints/profile/password.js'
import { uploadAvatarEndpoint } from './src/endpoints/profile/avatar.js'
import { newsletterSubscribeEndpoint } from './src/endpoints/newsletter/subscribe.js'
import { getOfferEndpoint } from './src/endpoints/offers/get.js'
import { getEmailPreferencesEndpoint, saveEmailPreferencesEndpoint, oneClickUnsubscribeEndpoint, unsubscribeLandingEndpoint } from './src/endpoints/email/preferences.js'
import { resendWebhookEndpoint } from './src/endpoints/email/webhook.js'
import { emailPreviewEndpoint } from './src/endpoints/email/preview.js'
import { emailEditorEndpoints } from './src/endpoints/email/editor.js'
import { myPlansEndpoint, studioPlanResetEndpoint } from './src/endpoints/courses/plan.js'
import { updateCardEndpoint } from './src/endpoints/billing/update-card.js'
import { whatsappVerifyEndpoint, whatsappWebhookEndpoint } from './src/endpoints/whatsapp/webhook.js'

import { graphQLQueries } from './src/lib/graphql-extensions.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? ''
  const configured = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  return [...new Set([...configured, 'https://ambassador.skillsair.com'])]
}

const migrating = Boolean(process.env.PAYLOAD_MIGRATING) || process.argv.some((arg) => /migrate/.test(arg))
const viaPgBouncer = Boolean(process.env.PGBOUNCER_URL) && !migrating

// Endpoints under a collection's slug (e.g. /courses/..., /certificates/...) are mounted on that collection.
export default buildConfig(mountPrefixedEndpoints({
  admin: {
    user: 'users',
    meta: {
      titleSuffix: '· SkillsAir Studio',
      defaultOGImageType: 'dynamic',
    },
    dateFormat: 'd MMM yyyy, HH:mm',
    components: {
      Nav: '/src/admin/nav/StudioNav#StudioNav',
      graphics: {
        Icon: '/src/admin/brand/StudioBrand#StudioIcon',
        Logo: '/src/admin/brand/StudioBrand#StudioLogo',
      },
      beforeLogin: ['/src/admin/brand/StudioBrand#StudioLoginPanel'],
      settingsMenu: ['/src/admin/nav/StudioSettingsMenu#StudioSettingsMenu'],
      actions: ['/src/admin/command/CommandBar#CommandBar'],
      header: ['/src/admin/command/EnvRibbon#EnvRibbon'],
      providers: ['/src/admin/a11y/A11yPatches#A11yPatches'],
      views: {
        dashboard: {
          Component: '/src/admin/views/overview/OverviewView#OverviewView',
          meta: { title: 'Overview · SkillsAir Studio' },
        },
        queue: {
          Component: '/src/admin/views/queue/QueueView#QueueView',
          path: '/queue',
          meta: { title: "Imisi's queue" },
        },
        guide: {
          Component: '/src/admin/views/guide/GuideView#GuideView',
          path: '/guide',
          meta: { title: 'Studio guide' },
        },
        studioKit: {
          Component: '/src/admin/views/StudioKitView#StudioKitView',
          path: '/studio-kit',
          meta: { title: 'Studio kit' },
        },
        lifecycle: {
          Component: '/src/admin/views/lifecycle/LifecycleView#LifecycleView',
          path: '/lifecycle',
          meta: { title: 'Lifecycle emails' },
        },
        emails: {
          Component: '/src/admin/views/emails/EmailsView#EmailsView',
          path: '/emails',
          meta: { title: 'Emails' },
        },
        questionBank: {
          Component: '/src/admin/views/question-bank/QuestionBankView#QuestionBankView',
          path: '/question-bank',
          meta: { title: 'Question bank' },
        },
        enrolLearners: {
          Component: '/src/admin/views/enrol/EnrolView#EnrolView',
          path: '/enrol',
          meta: { title: 'Enrol learners' },
        },
        ambassadorApplications: {
          Component: '/src/admin/views/ambassadors/ApplicationsView#ApplicationsView',
          path: '/ambassadors/applications',
          meta: { title: 'Ambassador applications · SkillsAir Studio' },
        },
        ambassadorPayouts: {
          Component: '/src/admin/views/ambassadors/PayoutsView#PayoutsView',
          path: '/ambassadors/payouts',
          meta: { title: 'Ambassador payouts · SkillsAir Studio' },
        },
        ambassadorDirectory: {
          Component: '/src/admin/views/ambassadors/DirectoryView#DirectoryView',
          path: '/ambassadors/directory',
          meta: { title: 'Ambassadors · SkillsAir Studio' },
        },
        ambassadorWallet: {
          Component: '/src/admin/views/ambassadors/WalletView#WalletView',
          path: '/ambassadors/wallet',
          meta: { title: 'Ambassador wallet · SkillsAir Studio' },
        },
      },
    },
  },
  serverURL: process.env.BACKEND_URL ?? 'http://localhost:3001',
  secret: process.env.PAYLOAD_SECRET ?? '',
  sharp,
  cors: corsOrigins(),
  csrf: corsOrigins(),
  db: postgresAdapter({
    pool: {
      // At scale the API instances connect through PgBouncer (transaction pooling); migrations
      // (PAYLOAD_MIGRATING / `payload migrate`) always use the direct DATABASE_URI.
      connectionString: viaPgBouncer ? process.env.PGBOUNCER_URL : process.env.DATABASE_URI,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      // Never wait forever: a request that can't get a connection fails with an error instead of
      // leaving the visitor on a spinner. pg's default is to wait with no limit.
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 10_000),
      // A stuck query or forgotten transaction gives its connection back. PgBouncer in transaction
      // mode rejects these as start-up settings, and migrations can legitimately run for longer.
      ...(viaPgBouncer || migrating
        ? {}
        : {
            statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000),
            idle_in_transaction_session_timeout: Number(process.env.DB_IDLE_TRANSACTION_TIMEOUT_MS ?? 60_000),
          }),
    },
    migrationDir: path.resolve(dirname, 'src/payload-migrations'),
  }),
  editor: lexicalEditor({}),
  email: resendAdapter({
    apiKey: process.env.RESEND_API_KEY ?? '',
    defaultFromAddress: process.env.EMAIL_FROM_TRANSACTIONAL ?? process.env.EMAIL_FROM ?? 'imisi@notify.skillsair.com',
    defaultFromName: process.env.EMAIL_FROM_NAME ?? 'Imisi from SkillsAir',
  }),
  collections: [
    Users,
    Media,
    Categories,
    Plans,
    Courses,
    Sections,
    Lessons,
    Enrollments,
    LessonProgress,
    Orders,
    Certificates,
    CertificateEntitlements,
    Subscriptions,
    Affiliates,
    Referrals,
    AccessExtensions,
    Pages,
    Posts,
    Quizzes,
    QuizQuestions,
    QuizAttempts,
    Reviews,
    Discussions,
    NewsletterSubscribers,
    Leads,
    LaptopApplications,
    Messages,
    EmailOverrides,
    EmailOverrideHistory,
    Ambassadors,
    AmbassadorBankAccounts,
    ReferralClicks,
    ReferralAttributions,
    AmbassadorLedger,
    AmbassadorPayouts,
    AmbassadorAuditLog,
  ],
  globals: [ScholarshipWindow, EmailContent, AmbassadorSettings],
  endpoints: [
    ambassadorTrackEndpoint,
    ambassadorConfigEndpoint,
    ambassadorBanksEndpoint,
    ambassadorResolveBankEndpoint,
    ambassadorApplyEndpoint,
    ambassadorVerifyEmailEndpoint,
    ambassadorResendVerificationEndpoint,
    ambassadorMeEndpoint,
    ambassadorSummaryEndpoint,
    ambassadorEarningsEndpoint,
    ambassadorReferralsEndpoint,
    ambassadorBankAccountEndpoint,
    ambassadorPayoutRequestEndpoint,
    ambassadorPayoutListEndpoint,
    ...ambassadorAdminEndpoints,
    registerEndpoint,
    loginEndpoint,
    logoutEndpoint,
    refreshEndpoint,
    forgotPasswordEndpoint,
    resetPasswordEndpoint,
    enrollEndpoint,
    progressEndpoint,
    completeEndpoint,
    quizSubmitEndpoint,
    reviewEndpoint,
    discussEndpoint,
    videoStreamEndpoint,
    lessonResourceEndpoint,
    lessonCaptionsEndpoint,
    queueCaptionsImportEndpoint,
    restoreContentHistoryEndpoint,
    retryWorkTaskEndpoint,
    initiatePaymentEndpoint,
    paystackWebhookEndpoint,
    verifyPaymentEndpoint,
    generateCertificateEndpoint,
    verifyCertificateEndpoint,
    purchaseCertificateEndpoint,
    subscribeEndpoint,
    cancelSubscriptionEndpoint,
    subscriptionWebhookEndpoint,
    affiliateDashboardEndpoint,
    trackAffiliateEndpoint,
    extendAccessEndpoint,
    manualEnrolEndpoint,
    graphqlGetEndpoint,
    graphqlPostEndpoint,
    updateProfileEndpoint,
    getPreferencesEndpoint,
    updatePreferencesEndpoint,
    changePasswordEndpoint,
    uploadAvatarEndpoint,
    newsletterSubscribeEndpoint,
    getOfferEndpoint,
    whatsappVerifyEndpoint,
    whatsappWebhookEndpoint,
    getEmailPreferencesEndpoint,
    saveEmailPreferencesEndpoint,
    oneClickUnsubscribeEndpoint,
    unsubscribeLandingEndpoint,
    resendWebhookEndpoint,
    emailPreviewEndpoint,
    ...emailEditorEndpoints,
    updateCardEndpoint,
    myPlansEndpoint,
    studioPlanResetEndpoint,
  ],
  graphQL: {
    queries: graphQLQueries,
    disablePlaygroundInProduction: true,
    disableIntrospectionInProduction: true,
  },
  plugins: [
    seoPlugin({
      collections: ['courses', 'pages', 'posts'],
    }),
    s3Storage({
      collections: {
        media: true,
      },
      bucket: process.env.R2_BUCKET ?? '',
      config: {
        region: 'auto',
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
        },
        endpoint: process.env.R2_ACCOUNT_ID
          ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
          : undefined,
      },
    }),
  ],
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
}))
