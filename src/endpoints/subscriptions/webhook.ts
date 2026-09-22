import type { Endpoint } from 'payload'
import { asyncHandler } from '../../middleware/validate.js'
import { handlePaystackWebhook } from '../payments/webhook.js'

export const subscriptionWebhookEndpoint: Endpoint = {
  path: '/subscriptions/webhook',
  method: 'post',
  handler: asyncHandler(handlePaystackWebhook),
}
