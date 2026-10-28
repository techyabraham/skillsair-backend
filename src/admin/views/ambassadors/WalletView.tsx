import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { Card, EmptyState, Money, StatusPill } from '../../ui/primitives'
import { isAdmin } from '../../data/auth'
import { AmbassadorWalletActions } from './AmbassadorWalletActions'

const param = (value: unknown): string => Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : ''
export async function WalletView(props: AdminViewServerProps) {
  if (!isAdmin(props.initPageResult.req)) return <NotAvailable props={props} title="Ambassador wallet" />
  const id = Number(param((props.searchParams as Record<string, unknown> | undefined)?.ambassadorId))
  if (!Number.isSafeInteger(id) || id < 1) return <StudioPage props={props} title="Wallet and actions" icon="ambassadors" eyebrow="Ambassadors"><Card><EmptyState icon={<span>!</span>} title="Choose an ambassador">Open this view from an ambassador or payout record.</EmptyState></Card></StudioPage>
  const result = await props.initPageResult.req.payload.findByID({ collection: 'ambassadors', id, depth: 1, overrideAccess: true }).catch(() => null)
  if (!result) return <StudioPage props={props} title="Wallet and actions" icon="ambassadors" eyebrow="Ambassadors"><Card><EmptyState icon={<span>!</span>} title="Ambassador not found">Return to the ambassador list and choose a valid record.</EmptyState></Card></StudioPage>
  const ambassador = result as unknown as { id: number; code: string; username: string; status: 'pending' | 'active' | 'blocked'; user?: { firstName?: string; lastName?: string; email?: string }; riskFlags?: Array<{ kind: string; note?: string; openedAt?: string; resolvedAt?: string | null; resolvedBy?: number | { id: number } }>; blockedReason?: string | null }
  const user = ambassador.user
  return <StudioPage props={props} title="Wallet and actions" icon="ambassadors" eyebrow="Ambassadors" intro={`${user?.firstName ?? ''} ${user?.lastName ?? ''} · ${user?.email ?? ''} · @${ambassador.username} · ${ambassador.code}`}>
    <AmbassadorWalletActions ambassadorId={id} initialStatus={ambassador.status} initialReason={ambassador.blockedReason ?? ''} initialFlags={(ambassador.riskFlags ?? []).map((flag, index) => ({ ...flag, index }))} />
  </StudioPage>
}
