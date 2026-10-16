/**
 * Creates DRAFT legal pages in the `pages` collection for the owner to complete and the
 * lawyer to review: privacy, terms, refunds, cookies, laptop-rules. Existing slugs are never
 * touched. Drafts are not public; the site shows a holding message until each is published.
 * Dry run by default; nothing is written without --execute.
 *
 * Usage:
 *   npm run seed:legal-pages [-- --execute]
 */
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'

type Node = Record<string, unknown>

const text = (value: string, bold = false): Node => ({ type: 'text', text: value, format: bold ? 1 : 0, version: 1, detail: 0, mode: 'normal', style: '' })
const paragraph = (...children: Node[]): Node => ({ type: 'paragraph', children, direction: 'ltr', format: '', indent: 0, version: 1, textFormat: 0 })
const p = (value: string) => paragraph(text(value))
const h = (value: string): Node => ({ type: 'heading', tag: 'h2', children: [text(value)], direction: 'ltr', format: '', indent: 0, version: 1 })
const list = (items: string[], ordered = false): Node => ({
  type: 'list',
  listType: ordered ? 'number' : 'bullet',
  tag: ordered ? 'ol' : 'ul',
  start: 1,
  children: items.map((item, index) => ({ type: 'listitem', value: index + 1, children: [text(item)], direction: 'ltr', format: '', indent: 0, version: 1 })),
  direction: 'ltr',
  format: '',
  indent: 0,
  version: 1,
})
const doc = (...children: Node[]) => ({ root: { type: 'root', children, direction: 'ltr', format: '', indent: 0, version: 1 } })

const DRAFT_NOTE = p('DRAFT FOR LEGAL REVIEW. Do not publish until the lawyer has approved this text.')

const PAGES: Array<{ slug: string; title: string; content: ReturnType<typeof doc> }> = [
  {
    slug: 'privacy',
    title: 'Privacy notice',
    content: doc(
      DRAFT_NOTE,
      p('Paste the existing SkillsAir privacy policy here, then make sure it covers each heading below (Nigeria Data Protection Act 2023 and the NDPC General Application and Implementation Directive 2025).'),
      h('Who we are'),
      p('The data controller is SKILLS AIR LIMITED (RC 9272398), Osifila Street, Anifowose, Ikeja, Lagos. Email hello@skillsair.com.'),
      h('What we collect'),
      list(['Your name, email address and WhatsApp number', 'Your application answers (school, programme, current status, device, weekly time)', 'Account, learning progress, payments and certificates', 'Usage data, and analytics data only if you accept measurement cookies', 'Where you came from (campaign links, referring site, landing page)']),
      h('Why we use it'),
      list(['To send the offer you asked for and run your account and programme', 'To answer your questions on WhatsApp and email', 'To send updates, scholarship deadlines and offers, only if you ticked the consent box', 'To process payments, prevent fraud and meet legal duties']),
      h('Marketing consent'),
      p('Marketing messages are only sent if you ticked the unticked consent box. We record the wording you agreed to and when. Reply STOP on WhatsApp or use the unsubscribe link in any email to stop at any time.'),
      h('WhatsApp messages'),
      p('We use the Meta WhatsApp Business (Cloud) API to send your offer and reply to you.'),
      h('Who processes your data for us'),
      list(['Paystack (payments)', 'Meta / WhatsApp (messaging)', 'Resend (email)', 'Our hosting and database providers', 'Google Analytics and Meta Pixel, only with your consent']),
      h('How long we keep it'),
      p('[Owner and lawyer to set retention periods.]'),
      h('Your rights'),
      p('You can ask to access, correct, delete or move your data, object to processing, or withdraw consent. You can also complain to the Nigeria Data Protection Commission.'),
      h('Data-protection contact'),
      p('Blessing Edeh, blessingedeh888@gmail.com'),
    ),
  },
  {
    slug: 'terms',
    title: 'Terms',
    content: doc(DRAFT_NOTE, p('Paste the existing SkillsAir terms of service here for the lawyer to review. Include programme access (monthly plans keep access while the subscription is active), the certificate fee, the refund policy, acceptable use and the governing law (Nigeria).')),
  },
  {
    slug: 'refunds',
    title: 'Refund policy',
    content: doc(
      DRAFT_NOTE,
      p('You can request a refund of your programme fee within 24 hours of payment, provided you have completed at least one chapter or five lessons of the programme. Email hello@skillsair.com or WhatsApp +234 818 212 6524 with your payment reference. Approved refunds are returned to your original payment method. The certificate fee (₦10,000) is non-refundable once your certificate has been issued.'),
      p('[Owner to confirm the certificate clause: {{CERT_REFUND_CONFIRM}}]'),
      h('If you were debited but the payment failed'),
      p('Banks normally reverse failed payments automatically. If yours hasn’t, send your payment reference to us on WhatsApp and we’ll resolve it within 24 hours.'),
    ),
  },
  {
    slug: 'cookies',
    title: 'Cookie policy',
    content: doc(
      DRAFT_NOTE,
      h('Essential cookies'),
      list(['Your sign-in session (sa_backend_access, sa_backend_refresh, sa_user_id)', 'Your application session so you can see your offer (sa_lead)', 'Your cookie choice (sa_consent)', 'Where you first came from, used to understand which campaigns work (sa_attr, 90 days)', 'Which version of a page you see, for testing improvements (sa_exp, 90 days)']),
      h('Measurement cookies (only if you accept)'),
      list(['Google Analytics 4', 'Meta Pixel']),
      p('You can choose "Only essential" in the cookie banner. To change your choice, clear this site’s cookies in your browser.'),
    ),
  },
  {
    slug: 'laptop-rules',
    title: 'SkillsAir Laptop Support: Official Rules',
    content: doc(
      DRAFT_NOTE,
      p('These rules must match the FCCPC approval exactly.'),
      list(
        [
          'Organiser: SKILLS AIR LIMITED (RC 9272398), Osifila Street, Anifowose, Ikeja, Lagos.',
          'What’s offered: 2 laptops per cohort. The current cohort is everyone who enrols between October 2026 and January 2027. SkillsAir may add more laptops through partners; any increase will be announced on this page.',
          'Who can apply: learners who enrolled in the cohort and have been issued their SkillsAir certificate for a programme in that cohort.',
          'How to apply: from your dashboard, submit one application per cohort telling us your story, why you need a laptop and how you’ll use it.',
          'How recipients are chosen: a SkillsAir panel reviews every application and selects the applicants with the greatest need and most compelling case. The panel’s decision is final.',
          'Timeline: applications close {{LAPTOP_APPLICATION_DEADLINE}}. Recipients are contacted by WhatsApp and email within {{LAPTOP_NOTIFY_DAYS}} days, and the laptops are delivered or collected {{LAPTOP_DELIVERY_METHOD}}.',
          'Publicity: recipients may choose to have their first name, photo and story shared. This is optional and does not affect selection.',
          'Approval: this promotion is approved by the Federal Competition and Consumer Protection Commission ({{FCCPC_APPROVAL_REFERENCE}}).',
          'Contact: hello@skillsair.com.',
        ],
        true,
      ),
    ),
  },
]

async function run(): Promise<void> {
  const execute = process.argv.includes('--execute')
  await loadEnv()
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  for (const page of PAGES) {
    const existing = await payload.find({ collection: 'pages', where: { slug: { equals: page.slug } }, limit: 1, depth: 0, overrideAccess: true })
    if (existing.totalDocs) {
      console.log(`- ${page.slug}: already exists (status ${existing.docs[0]?.status}), left unchanged`)
      continue
    }
    if (execute) {
      await payload.create({ collection: 'pages', data: { title: page.title, slug: page.slug, status: 'draft', content: page.content } as never, overrideAccess: true })
      console.log(`- ${page.slug}: created as DRAFT`)
    } else {
      console.log(`- ${page.slug}: would be created as DRAFT`)
    }
  }
  console.log(execute ? 'Done.' : 'DRY RUN: nothing written. Re-run with --execute to create the drafts.')
  process.exit(0)
}

void run()
