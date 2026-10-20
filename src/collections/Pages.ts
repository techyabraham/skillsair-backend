import type { CollectionConfig } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { slugify } from '../utils/slugify.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'

export const Pages: CollectionConfig = {
  slug: 'pages', labels: { singular: 'Page', plural: 'Pages' },
  admin: {
    group: STUDIO_GROUP.website,
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'status', 'updatedAt'],
  },
  access: {
    read: ({ req }) => {
      if (req.user?.role === 'admin') return true
      return { status: { equals: 'published' } }
    },
    create: ({ req }) => req.user?.role === 'admin',
    update: ({ req }) => req.user?.role === 'admin',
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
      name: 'content',
      type: 'richText',
      editor: lexicalEditor({}),
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
    { name: 'publishedAt', type: 'date' },
  ],
  timestamps: true,
}
