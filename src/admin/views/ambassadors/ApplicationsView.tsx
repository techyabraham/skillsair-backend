import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { Card, EmptyState, StatusPill } from '../../ui/primitives'
import { isAdmin } from '../../data/auth'
import { AmbassadorApplications } from './AmbassadorApplications'

export async function ApplicationsView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!isAdmin(req)) return <NotAvailable props={props} title="Ambassador applications" />
  const result = await req.payload.find({ collection: 'ambassadors', where: { status: { equals: 'pending' } }, sort: '-createdAt', limit: 100, depth: 1, overrideAccess: true }).catch(() => null)
  const applications = (result?.docs ?? []).map((row) => {
    const ambassador = row as unknown as { id: number; code: string; username: string; status: string; emailVerifiedAt?: string | null; promotionPlan?: string; about?: string; heardAbout?: string; createdAt: string; user?: { firstName?: string; lastName?: string; email?: string } }
    return { id: ambassador.id, code: ambassador.code, username: ambassador.username, emailVerified: Boolean(ambassador.emailVerifiedAt), promotionPlan: ambassador.promotionPlan ?? '', about: ambassador.about ?? '', heardAbout: ambassador.heardAbout ?? '', createdAt: ambassador.createdAt, firstName: ambassador.user?.firstName ?? '', lastName: ambassador.user?.lastName ?? '', email: ambassador.user?.email ?? '' }
  })
  return <StudioPage props={props} title="Applications" icon="ambassadors" eyebrow="Ambassadors" intro="Review self-applications and verify each applicant before approval.">
    {!result ? <Card><EmptyState icon={<span>!</span>} title="Applications could not load">Refresh the page or check the API logs.</EmptyState></Card> : <AmbassadorApplications initial={applications} />}
  </StudioPage>
}
