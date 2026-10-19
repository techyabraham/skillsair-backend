import type { Payload } from 'payload'
import { AppError } from '../types/index.js'

interface SubscriptionEvent {
  subscription_code?: string
  email_token?: string
  next_payment_date?: string | null
  customer?: { email?: string }
  plan?: { plan_code?: string }
}

/** Link Paystack's subscription identifier to the paid local subscription. */
export async function linkSubscription(payload: Payload, event: SubscriptionEvent): Promise<void> {
  if (!event.subscription_code || !event.customer?.email || !event.plan?.plan_code) throw new AppError('VALIDATION_ERROR', 'Incomplete subscription event')
  const users = await payload.find({ collection: 'users', where: { email: { equals: event.customer.email.toLowerCase() } }, limit: 1, overrideAccess: true })
  const plans = await payload.find({ collection: 'plans', where: { paystackPlanCode: { equals: event.plan.plan_code } }, limit: 1, overrideAccess: true })
  if (!users.totalDocs || !plans.totalDocs) throw new AppError('NOT_FOUND', 'Subscription customer or plan not found')
  const userId = users.docs[0]!.id
  const planId = plans.docs[0]!.id
  const subscriptions = await payload.find({ collection: 'subscriptions', where: { and: [{ user: { equals: userId } }, { plan: { equals: planId } }, { status: { equals: 'active' } }] }, sort: '-createdAt', limit: 10, depth: 0, overrideAccess: true })
  const local = subscriptions.docs.find((item) => item.paystackSubscriptionCode === event.subscription_code || !item.paystackSubscriptionCode)
  if (!local) throw new AppError('NOT_FOUND', 'Paid subscription has not been fulfilled yet')
  const nextPayment = event.next_payment_date ? new Date(event.next_payment_date) : null
  await payload.update({ collection: 'subscriptions', id: local.id, data: {
    paystackSubscriptionCode: event.subscription_code,
    paystackEmailToken: event.email_token,
    ...(nextPayment && !Number.isNaN(nextPayment.getTime()) && nextPayment.getTime() > Date.now() ? { currentPeriodEnd: nextPayment.toISOString() } : {}),
  }, overrideAccess: true })
}

interface InvoiceEvent {
  invoice_code?: string
  paid?: boolean
  status?: string
  period_start?: string
  period_end?: string
  subscription?: { subscription_code?: string; next_payment_date?: string | null }
  transaction?: { reference?: string; status?: string; amount?: number; currency?: string }
}

/**
 * A paid renewal invoice: extends the period. A subscription that was past due (or had lapsed)
 * is active again. Returns what changed, or null when there was nothing to apply.
 */
export async function applyPaidInvoice(payload: Payload, event: InvoiceEvent): Promise<{ subscriptionId: number; recovered: boolean } | null> {
  if (!event.paid || event.status !== 'success') return null
  const code = event.subscription?.subscription_code
  if (!code || !event.invoice_code || !event.transaction?.reference || event.transaction.status !== 'success') {
    throw new AppError('VALIDATION_ERROR', 'Incomplete paid invoice event')
  }
  const found = await payload.find({ collection: 'subscriptions', where: { paystackSubscriptionCode: { equals: code } }, limit: 1, depth: 0, overrideAccess: true })
  const subscription = found.docs[0]
  if (!subscription) throw new AppError('NOT_FOUND', 'Subscription has not been linked yet')
  if (subscription.lastInvoiceCode === event.invoice_code) return null
  if (event.transaction.currency !== 'NGN' || !event.transaction.amount || event.transaction.amount <= 0) {
    throw new AppError('VALIDATION_ERROR', 'Invoice payment is invalid')
  }
  const candidateDates = [event.period_end, event.subscription?.next_payment_date]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
  const nextEnd = candidateDates.sort((a, b) => b.getTime() - a.getTime())[0]
  if (!nextEnd || nextEnd.getTime() <= new Date(subscription.currentPeriodEnd ?? 0).getTime()) return null
  const recovered = subscription.status === 'past_due' || subscription.status === 'expired'
  await payload.update({ collection: 'subscriptions', id: subscription.id, data: {
    status: 'active', currentPeriodStart: event.period_start ?? new Date().toISOString(),
    currentPeriodEnd: nextEnd.toISOString(), lastInvoiceCode: event.invoice_code,
    ...(recovered ? { failedAttempts: 0 } : {}),
  }, overrideAccess: true })
  return { subscriptionId: Number(subscription.id), recovered }
}
