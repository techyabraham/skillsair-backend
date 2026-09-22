import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'
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
import { Subscriptions } from './src/collections/Subscriptions.js'
import { Affiliates } from './src/collections/Affiliates.js'
import { Referrals } from './src/collections/Referrals.js'
import { AccessExtensions } from './src/collections/AccessExtensions.js'
import { Pages } from './src/collections/Pages.js'
import { Posts } from './src/collections/Posts.js'

import { registerEndpoint } from './src/endpoints/auth/register.js'
import { loginEndpoint } from './src/endpoints/auth/login.js'
import { logoutEndpoint } from './src/endpoints/auth/logout.js'
import { refreshEndpoint } from './src/endpoints/auth/refresh.js'
import { forgotPasswordEndpoint } from './src/endpoints/auth/forgot-password.js'
import { resetPasswordEndpoint } from './src/endpoints/auth/reset-password.js'
import { enrollEndpoint } from './src/endpoints/courses/enroll.js'
import { progressEndpoint } from './src/endpoints/courses/progress.js'
import { completeEndpoint } from './src/endpoints/courses/complete.js'
import { videoStreamEndpoint } from './src/endpoints/stream/video.js'
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
import { graphqlGetEndpoint, graphqlPostEndpoint } from './src/endpoints/graphql/handler.js'

import { graphQLQueries } from './src/lib/graphql-extensions.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? ''
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

export default buildConfig({
  serverURL: process.env.FRONTEND_URL,
  secret: process.env.PAYLOAD_SECRET ?? '',
  cors: corsOrigins(),
  csrf: corsOrigins(),
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI,
    },
  }),
  editor: lexicalEditor({}),
  email: resendAdapter({
    apiKey: process.env.RESEND_API_KEY ?? '',
    defaultFromAddress: process.env.EMAIL_FROM ?? 'noreply@skillsair.com',
    defaultFromName: process.env.EMAIL_FROM_NAME ?? 'SkillsAir',
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
    Subscriptions,
    Affiliates,
    Referrals,
    AccessExtensions,
    Pages,
    Posts,
  ],
  endpoints: [
    registerEndpoint,
    loginEndpoint,
    logoutEndpoint,
    refreshEndpoint,
    forgotPasswordEndpoint,
    resetPasswordEndpoint,
    enrollEndpoint,
    progressEndpoint,
    completeEndpoint,
    videoStreamEndpoint,
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
    graphqlGetEndpoint,
    graphqlPostEndpoint,
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
})
