export interface PaystackInitializeRequest {
  amount: number
  email: string
  reference: string
  callback_url: string
  metadata: Record<string, unknown>
  currency?: string
  plan?: string
  channels?: string[]
}

export interface PaystackInitializeData {
  authorization_url: string
  access_code: string
  reference: string
}

export interface PaystackInitializeResponse {
  status: boolean
  message: string
  data: PaystackInitializeData
}

export interface PaystackVerifyCustomer {
  id: number
  email: string
  customer_code: string
}

export interface PaystackVerifyData {
  id: number
  domain: string
  status: 'success' | 'failed' | 'abandoned'
  reference: string
  amount: number
  currency: string
  paid_at: string | null
  created_at: string
  channel: string
  customer: PaystackVerifyCustomer
  metadata: Record<string, unknown> | null
}

export interface PaystackVerifyResponse {
  status: boolean
  message: string
  data: PaystackVerifyData
}

export interface PaystackChargeSuccessEvent {
  event: 'charge.success'
  data: PaystackVerifyData
}

export interface PaystackSubscriptionData {
  id: number
  domain: string
  status: string
  subscription_code: string
  email_token: string
  amount: number
  cron_expression: string
  next_payment_date: string | null
  createdAt: string
  customer: PaystackVerifyCustomer
  plan: {
    id: number
    name: string
    plan_code: string
    interval: string
  }
}

export interface PaystackSubscriptionDisableEvent {
  event: 'subscription.disable'
  data: PaystackSubscriptionData
}

export interface PaystackInvoicePaymentFailedEvent {
  event: 'invoice.payment_failed'
  data: {
    subscription: PaystackSubscriptionData
    customer: PaystackVerifyCustomer
    amount: number
  }
}

export type PaystackWebhookEvent =
  | PaystackChargeSuccessEvent
  | PaystackSubscriptionDisableEvent
  | PaystackInvoicePaymentFailedEvent
  | { event: string; data: Record<string, unknown> }

/** https://paystack.com/docs/payments/refunds/ — refund webhook, not the Refund API object. */
export interface PaystackRefundProcessedData {
  status: 'processed'
  transaction_reference: string
  refund_reference?: string | null
  id?: number
  amount: string | number
  currency: string
}

export interface PaystackTransferRecipientData {
  recipient_code: string
  active: boolean
  currency: string
}

export interface PaystackTransferData {
  id: number
  reference: string
  transfer_code?: string | null
  amount: number
  currency: string
  status: 'success' | 'pending' | 'otp' | 'failed' | 'reversed' | 'received' | 'blocked' | 'abandoned' | 'rejected' | string
  createdAt?: string
  updatedAt?: string
}

export interface PaystackTransferEventData extends PaystackTransferData {
  reason?: string | null
}

export type PaystackTransferEventName = 'transfer.success' | 'transfer.failed' | 'transfer.reversed'
