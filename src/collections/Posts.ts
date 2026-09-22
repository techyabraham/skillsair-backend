import type { CollectionConfig } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { slugify } from '../utils/slugify.js'

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
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
    { name: 'excerpt', type: 'text', maxLength: 300 },
    {
      name: 'content',
      type: 'richText',
      editor: lexicalEditor({}),
    },
    { name: 'featuredImage', type: 'relationship', relationTo: 'media' },
    { name: 'author', type: 'relationship', relationTo: 'users', required: true },
    { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true },
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
