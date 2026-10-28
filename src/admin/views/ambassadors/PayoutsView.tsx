import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { isAdmin } from '../../data/auth'
import { AmbassadorPayoutQueue } from './AmbassadorPayoutQueue'

export async function PayoutsView(props: AdminViewServerProps) {
  if (!isAdmin(props.initPageResult.req)) return <NotAvailable props={props} title="Ambassador payouts" />
  return <StudioPage props={props} title="Payouts" icon="ambassador-payouts" eyebrow="Ambassadors" intro="Review withdrawals, bank snapshots and current risk flags. Approval starts the Paystack transfer."><AmbassadorPayoutQueue /></StudioPage>
}
