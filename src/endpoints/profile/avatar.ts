import type { Endpoint, PayloadRequest } from 'payload'
import { asyncHandler, sendSuccess } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import { AppError } from '../../types/index.js'

async function handler(req: PayloadRequest): Promise<Response> {
  const user = await requireAuth(req)
  if (!req.formData) throw new AppError('VALIDATION_ERROR', 'Multipart uploads are not supported by this request')
  const form = await req.formData()
  const upload = form.get('file')
  if (!(upload instanceof File)) throw new AppError('VALIDATION_ERROR', 'An image file is required')
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(upload.type)) {
    throw new AppError('VALIDATION_ERROR', 'Use a JPG, PNG, WEBP, or GIF image')
  }
  if (upload.size > 2 * 1024 * 1024) throw new AppError('VALIDATION_ERROR', 'Image must be no larger than 2 MB')

  const bytes = Buffer.from(await upload.arrayBuffer())
  const media = await req.payload.create({
    collection: 'media',
    data: { alt: `${user.email} profile photo` },
    file: { data: bytes, name: upload.name, mimetype: upload.type, size: upload.size },
    overrideAccess: true,
  })
  const updatedUser = await req.payload.update({
    collection: 'users',
    id: user.id,
    data: { avatar: media.id },
    overrideAccess: true,
  })
  const avatar = typeof updatedUser.avatar === 'object' && updatedUser.avatar ? updatedUser.avatar.url : ''
  return sendSuccess({ id: media.id, url: avatar })
}

export const uploadAvatarEndpoint: Endpoint = {
  path: '/profile/avatar',
  method: 'post',
  handler: asyncHandler(handler),
}
