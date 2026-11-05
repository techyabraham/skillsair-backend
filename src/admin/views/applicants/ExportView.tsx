/**
 * /admin/applicants/export: download applicants' names, phone numbers and programmes for
 * follow-up calls, as CSV, Excel or a plain text list. The rules live in
 * src/lib/applicant-export.ts; ExportClient picks the filters, previews and downloads. Admins only.
 */
import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { isAdmin } from '../../data/auth'
import { ExportClient } from './ExportClient'

export async function ExportView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!isAdmin(req)) return <NotAvailable props={props} title="Export applicants" />
  const programmes = (await req.payload.find({
    collection: 'courses',
    where: { isBonus: { not_equals: true } },
    sort: 'title',
    limit: 200,
    depth: 0,
    overrideAccess: true,
    select: { title: true } as never,
  })).docs as unknown as Array<{ id: number; title: string }>

  return (
    <StudioPage
      props={props}
      title="Export applicants"
      icon="leads"
      eyebrow="Admissions"
      intro="Download applicants’ names, phone numbers and programmes to call and follow up. Starts with everyone who hasn’t paid yet."
    >
      <ExportClient programmes={programmes.map(({ id, title }) => ({ id, title }))} />
    </StudioPage>
  )
}
