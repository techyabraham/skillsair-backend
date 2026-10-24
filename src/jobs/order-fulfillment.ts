import { jobScheduler } from './scheduler.js'

const cron = jobScheduler('order-fulfillment')
import { getPayload } from 'payload'
import type { SanitizedConfig } from 'payload'
import { fulfillOrder } from '../lib/order-fulfillment.js'
import { logger } from '../lib/logger.js'

export function registerOrderFulfillmentJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const payload = await getPayload({ config })
      const orders = await payload.find({ collection: 'orders', where: { and: [{ status: { equals: 'success' } }, { fulfilledAt: { exists: false } }] }, limit: 100, depth: 0, overrideAccess: true })
      for (const order of orders.docs) {
        try { await fulfillOrder(payload, order.id) }
        catch (err) { logger.error({ err, orderId: order.id }, 'order_fulfillment_retry_failed') }
      }
    } catch (err) { logger.error({ err }, 'order_fulfillment_job_failed') }
  })
}
