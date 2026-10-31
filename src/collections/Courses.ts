import type { CollectionConfig, PayloadRequest } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { slugify } from '../utils/slugify.js'
import { courseCurriculumEndpoint } from '../endpoints/courses/curriculum.js'
import { coursePlanEndpoint, coursePlanPaceEndpoint, coursePlanResetEndpoint } from '../endpoints/courses/plan.js'
import { courseAssessmentsEndpoint } from '../endpoints/assessments/index.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'
import { copyFromCourse, lintErrors, lintProgrammeCopy } from '../lib/content-lint.js'
import { bumpCourseCacheHook } from '../lib/cache.js'

const staffOnly = ({ req }: { req: PayloadRequest }) => req.user?.role === 'admin' || req.user?.role === 'instructor'

export const Courses: CollectionConfig = {
  slug: 'courses', labels: { singular: 'Programme', plural: 'Programmes' },
  // Root endpoints under /courses/... are added here by mountPrefixedEndpoints (payload.config.ts).
  endpoints: [courseCurriculumEndpoint, courseAssessmentsEndpoint, coursePlanEndpoint, coursePlanPaceEndpoint, coursePlanResetEndpoint],
  hooks: {
    beforeChange: [
      ({ data, originalDoc, req, context }) => {
        // Programme copy managed by content packs (it has a primary keyword) must pass the SEO and
        // copy lint before it's published from Studio. Imports keep their own report.
        if (!req.user || (context as { skipContentLint?: boolean } | undefined)?.skipContentLint) return data
        const merged = { ...(originalDoc ?? {}), ...(data ?? {}) } as Record<string, unknown>
        if (merged.status !== 'published' || !merged.primaryKeyword) return data
        const errors = lintErrors(lintProgrammeCopy(copyFromCourse(merged)))
        if (errors.length) throw new Error(`Fix the programme copy before publishing: ${errors.slice(0, 5).map((issue) => `${issue.field}: ${issue.message}`).join(' ')}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`)
        return data
      },
    ],
    afterChange: [bumpCourseCacheHook('id')],
  },
  admin: {
    group: STUDIO_GROUP.learning,
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'price', 'totalLessons', 'readiness', 'updatedAt'],
    components: { edit: { beforeDocumentControls: ['/src/admin/edit/course#ViewOnSite'] } },
  },
  access: {
    read: ({ req }) => {
      if (req.user?.role === 'admin' || req.user?.role === 'instructor') return true
      return { status: { equals: 'published' } }
    },
    create: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    update: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    {
      name: 'readiness',
      type: 'ui',
      label: 'Ready to publish',
      admin: { position: 'sidebar', components: { Cell: '/src/admin/cells/cells#CompletenessCell', Field: '/src/admin/edit/course#CourseReadyChecklist' } },
    },
    {
      name: 'learningQuality',
      type: 'ui',
      label: 'Learning quality',
      admin: { position: 'sidebar', disableListColumn: true, components: { Field: '/src/admin/edit/learning#CourseLearningQuality' } },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      admin: { position: 'sidebar', components: { Cell: '/src/admin/cells/cells#PublishStatusCell' } },
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
    },
    { name: 'isFeatured', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },
    {
      // Freelancer's Academy, CV & LinkedIn: free to learners with a running programme, or who have
      // paid for at least two months (see src/lib/bonus-access.ts). Not sold on its own.
      name: 'isBonus',
      type: 'checkbox',
      defaultValue: false,
      label: 'Free bonus course',
      admin: { position: 'sidebar', description: 'Free while the learner has an active programme, or for good once they have paid for at least two months. Not sold on its own.' },
    },
    {
      name: 'phoneFriendly',
      type: 'checkbox',
      defaultValue: false,
      admin: { position: 'sidebar', description: 'Tick only if the whole programme can be completed on a phone.' },
    },
    { name: 'publishedAt', type: 'date', admin: { position: 'sidebar' } },
    {
      name: 'instructor',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar' },
      filterOptions: { role: { in: ['instructor', 'admin'] } },
      validate: async (value: unknown, { req }: { req: PayloadRequest }): Promise<string | true> => {
        if (!value) return true
        const instructorId = typeof value === 'object' ? (value as { id: unknown }).id : value
        const user = await req.payload.findByID({ collection: 'users', id: instructorId as string | number, req })
        if (!user || (user.role !== 'instructor' && user.role !== 'admin')) {
          return 'Instructor must have the instructor or admin role'
        }
        return true
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Overview',
          fields: [
            { name: 'title', type: 'text', required: true, maxLength: 200, admin: { components: { Cell: '/src/admin/cells/cells#ProgrammeTitleCell' } } },
            {
              name: 'slug',
              type: 'text',
              unique: true,
              admin: { readOnly: true },
              hooks: {
                beforeValidate: [
                  ({ value, data }) => {
                    if (value) return value
                    const title = typeof data?.title === 'string' ? data.title : ''
                    return slugify(title)
                  },
                ],
              },
            },
            { name: 'shortDescription', type: 'text', maxLength: 300 },
            {
              name: 'description',
              type: 'richText',
              editor: lexicalEditor({}),
            },
            { name: 'thumbnail', type: 'relationship', relationTo: 'media' },
            { name: 'previewVideo', type: 'text' },
            { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true, label: 'Schools' },
          ],
        },
        {
          label: 'Outcomes',
          fields: [
            {
              name: 'objectives',
              type: 'array',
              admin: { description: '6–8 items: action verb + skill + "so you can" + outcome, each up to 120 characters.' },
              fields: [{ name: 'objective', type: 'text', required: true, maxLength: 160 }],
            },
            {
              name: 'requirements',
              type: 'array',
              admin: { description: '3–6 items: device, internet, software (free tiers first), prior knowledge ("None: we start from zero"), time.' },
              fields: [{ name: 'requirement', type: 'text', required: true }],
            },
            {
              name: 'whoItsFor',
              type: 'array',
              label: "Who it's for",
              admin: { description: '3–4 audience lines, e.g. "Graduates and NYSC members who…".' },
              fields: [{ name: 'item', type: 'text', required: true, maxLength: 200 }],
            },
            {
              name: 'toolsCovered',
              type: 'array',
              label: 'Tools covered',
              admin: { description: 'Tools and technologies actually taught in the chapters.' },
              fields: [{ name: 'tool', type: 'text', required: true, maxLength: 80 }],
            },
            {
              name: 'careerPaths',
              type: 'array',
              label: 'Career paths',
              admin: { description: '3–5 honest role titles this prepares learners to pursue. No salary promises.' },
              fields: [{ name: 'role', type: 'text', required: true, maxLength: 100 }],
            },
            {
              name: 'faq',
              type: 'array',
              label: 'FAQ',
              admin: { description: '4–6 questions and answers, shown on the programme page and as FAQPage structured data.' },
              fields: [
                { name: 'question', type: 'text', required: true, maxLength: 200 },
                { name: 'answer', type: 'textarea', required: true, maxLength: 1200 },
              ],
            },
            {
              name: 'primaryKeyword',
              type: 'text',
              maxLength: 120,
              access: { read: staffOnly },
              admin: { description: 'Admin only. The search phrase this page targets; the content lint checks the copy against it.' },
            },
            {
              name: 'secondaryKeywords',
              type: 'array',
              access: { read: staffOnly },
              admin: { description: 'Admin only.' },
              fields: [{ name: 'keyword', type: 'text', required: true, maxLength: 120 }],
            },
          ],
        },
        {
          label: 'History',
          fields: [
            {
              name: 'historyPanel',
              type: 'ui',
              label: 'Earlier versions',
              admin: { disableListColumn: true, components: { Field: '/src/admin/edit/learning#CourseContentHistory' } },
            },
            {
              // Previous programme copy, saved by content:import before it overwrites the live fields.
              // Shown through historyPanel (with Restore); the raw snapshots stay out of the form.
              name: 'contentHistory',
              type: 'array',
              access: { read: staffOnly },
              admin: { hidden: true, readOnly: true, description: 'Earlier versions of the programme copy, saved automatically before each content import.' },
              fields: [
                { name: 'savedAt', type: 'date', required: true },
                { name: 'source', type: 'text' },
                { name: 'snapshot', type: 'json', required: true },
              ],
            },
          ],
        },
        {
          label: 'Curriculum',
          fields: [
            { name: 'outline', type: 'ui', admin: { disableListColumn: true, components: { Field: '/src/admin/edit/course#CourseOutline' } } },
            {
              name: 'sections',
              type: 'join',
              collection: 'sections',
              on: 'course',
              defaultSort: 'order',
              admin: { allowCreate: true, defaultColumns: ['title', 'order', 'updatedAt'] },
            },
            {
              // Set by import:drive-curriculum; captions:import and content:export-sources read the folder.
              name: 'driveFolderId',
              type: 'text',
              access: { read: staffOnly },
              admin: { description: 'Google Drive folder this programme is imported from (set by the importer).' },
            },
            { name: 'totalDuration', type: 'number', defaultValue: 0, admin: { readOnly: true } },
            { name: 'totalLessons', type: 'number', defaultValue: 0, admin: { readOnly: true } },
            { name: 'prerequisites', type: 'relationship', relationTo: 'courses', hasMany: true },
          ],
        },
        {
          label: 'Pricing',
          fields: [
            { name: 'pricingSummary', type: 'ui', admin: { disableListColumn: true, components: { Field: '/src/admin/edit/course#CoursePricing' } } },
            {
              name: 'price',
              type: 'number',
              required: true,
              min: 0,
              defaultValue: 0,
              admin: { description: 'Access Scholarship price (NGN), charged while a scholarship window is open.', components: { Cell: '/src/admin/cells/cells#ProgrammePricesCell' } },
            },
            {
              name: 'standardPrice',
              type: 'number',
              min: 0,
              admin: { description: 'Standard fee (NGN), charged whenever no scholarship window is open.' },
              validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) => {
                if (value === null || value === undefined || value === '') return true
                const price = Number(siblingData?.price ?? 0)
                if (Number(value) < price) return 'The standard fee must be at least the scholarship price'
                return true
              },
            },
            {
              name: 'standardMonthlyPrice',
              type: 'number',
              min: 0,
              admin: { description: 'Display only: the monthly equivalent of the standard fee.' },
            },
            { name: 'durationMonths', type: 'number', defaultValue: 3, min: 1 },
            { name: 'weeklyHours', type: 'number', defaultValue: 8, min: 1 },
          ],
        },
        {
          label: 'Next programmes',
          fields: [
            {
              name: 'nextProgrammes',
              type: 'array',
              maxRows: 3,
              admin: { description: 'Graduate emails (G1–G3): the programmes that pair best with this one, best first. Empty: other programmes in the same school, then phone-friendly ones.' },
              fields: [
                { name: 'programme', type: 'relationship', relationTo: 'courses', required: true },
                { name: 'pairingReason', type: 'textarea', maxLength: 300, admin: { description: 'One sentence, e.g. "Data Analysis plus Product Management means you can find the insight and decide what to build with it."' } },
              ],
            },
          ],
        },
        {
          label: 'Certificate',
          fields: [
            {
              name: 'certificateTemplate',
              type: 'select',
              defaultValue: 'template1',
              options: [
                { label: 'Template 1', value: 'template1' },
                { label: 'Template 2', value: 'template2' },
                { label: 'Template 3', value: 'template3' },
              ],
            },
          ],
        },
      ],
    },
  ],
  timestamps: true,
}
