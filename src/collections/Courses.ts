import type { CollectionConfig, PayloadRequest } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { slugify } from '../utils/slugify.js'
import { courseCurriculumEndpoint } from '../endpoints/courses/curriculum.js'

export const Courses: CollectionConfig = {
  slug: 'courses',
  endpoints: [courseCurriculumEndpoint],
  admin: {
    group: 'Learning',
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'level', 'price', 'totalLessons', 'updatedAt'],
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
    { name: 'title', type: 'text', required: true, maxLength: 200 },
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
    {
      name: 'description',
      type: 'richText',
      editor: lexicalEditor({}),
    },
    { name: 'shortDescription', type: 'text', maxLength: 300 },
    { name: 'thumbnail', type: 'relationship', relationTo: 'media' },
    { name: 'previewVideo', type: 'text' },
    {
      name: 'price',
      type: 'number',
      required: true,
      min: 0,
      defaultValue: 0,
      admin: { description: 'Access Scholarship price (NGN), charged while a scholarship window is open.' },
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
    {
      name: 'phoneFriendly',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Tick only if the whole programme can be completed on a phone.' },
    },
    {
      name: 'level',
      type: 'select',
      required: true,
      options: [
        { label: 'Beginner', value: 'beginner' },
        { label: 'Intermediate', value: 'intermediate' },
        { label: 'Advanced', value: 'advanced' },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
    },
    { name: 'isFeatured', type: 'checkbox', defaultValue: false },
    {
      name: 'instructor',
      type: 'relationship',
      relationTo: 'users',
      filterOptions: { role: { in: ['instructor', 'admin'] } },
      validate: async (value: unknown, { req }: { req: PayloadRequest }): Promise<string | true> => {
        if (!value) return true
        const instructorId = typeof value === 'object' ? (value as { id: unknown }).id : value
        const user = await req.payload.findByID({ collection: 'users', id: instructorId as string | number })
        if (!user || (user.role !== 'instructor' && user.role !== 'admin')) {
          return 'Instructor must have the instructor or admin role'
        }
        return true
      },
    },
    { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true },
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
    { name: 'totalDuration', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    { name: 'totalLessons', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    {
      name: 'requirements',
      type: 'array',
      fields: [{ name: 'requirement', type: 'text', required: true }],
    },
    {
      name: 'objectives',
      type: 'array',
      fields: [{ name: 'objective', type: 'text', required: true }],
    },
    {
      name: 'sections',
      type: 'join',
      collection: 'sections',
      on: 'course',
      defaultSort: 'order',
      admin: { allowCreate: true, defaultColumns: ['title', 'order', 'updatedAt'] },
    },
    { name: 'prerequisites', type: 'relationship', relationTo: 'courses', hasMany: true },
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
    { name: 'publishedAt', type: 'date' },
  ],
  timestamps: true,
}
