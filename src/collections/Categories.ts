import type { CollectionConfig } from 'payload'
import { slugify } from '../utils/slugify.js'
import { STUDIO_GROUP } from '../admin/studio-config.js'

export const Categories: CollectionConfig = {
  slug: 'categories', labels: { singular: 'School', plural: 'Schools' },
  admin: {
    group: STUDIO_GROUP.website,
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'parent', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: ({ req }) => req.user?.role === 'admin',
    update: ({ req }) => req.user?.role === 'admin',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
      maxLength: 150,
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      admin: { readOnly: true },
      hooks: {
        beforeValidate: [
          ({ value, data }) => {
            if (value) return value
            const name = typeof data?.name === 'string' ? data.name : ''
            return slugify(name)
          },
        ],
      },
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'freeExercise',
      type: 'textarea',
      maxLength: 600,
      admin: {
        description:
          'Nurture email P2: a free 20-minute exercise for this school, 2–4 sentences with a free tool. e.g. "Open Google Sheets, paste in your last month of spending, and make a chart of where the money went." Leave empty to skip P2.',
      },
    },
    {
      name: 'icon',
      type: 'text',
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'categories',
    },
    {
      name: 'courses',
      type: 'relationship',
      relationTo: 'courses',
      hasMany: true,
    },
  ],
}
