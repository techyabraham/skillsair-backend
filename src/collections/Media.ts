import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    useAsTitle: 'filename',
  },
  access: {
    read: () => true,
    create: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    update: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'instructor',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  upload: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'],
    imageSizes: [
      { name: 'thumbnail', width: 150, height: 150, position: 'centre' },
      { name: 'card', width: 400, height: 225, position: 'centre' },
      { name: 'full', width: 1200, height: 675, position: 'centre' },
    ],
    adminThumbnail: 'thumbnail',
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data, req }) => {
        const file = req.file
        if (!file) return data
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf']
        const mimeExtensionMap: Record<string, string[]> = {
          'image/jpeg': ['.jpg', '.jpeg'],
          'image/png': ['.png'],
          'image/webp': ['.webp'],
          'image/gif': ['.gif'],
          'application/pdf': ['.pdf'],
        }
        const filename = file.name.toLowerCase()
        const ext = filename.slice(filename.lastIndexOf('.'))
        const expectedExtensions = mimeExtensionMap[file.mimetype]
        if (!allowedExtensions.includes(ext) || !expectedExtensions?.includes(ext)) {
          throw new Error('File extension does not match its content type')
        }
        return data
      },
    ],
  },
}
