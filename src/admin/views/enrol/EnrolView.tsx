/**
 * /admin/enrol: enrol a list of people on a programme for a set number of months or days, with no
 * payment. The rules live in src/lib/manual-enrolment.ts; EnrolClient does the picking and shows a
 * result for every email. Admins only.
 */
import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { isAdmin } from '../../data/auth'
import { EnrolClient } from './EnrolClient'

export async function EnrolView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!isAdmin(req)) return <NotAvailable props={props} title="Enrol learners" />
  const courses = (await req.payload.find({
    collection: 'courses',
    where: { and: [{ status: { equals: 'published' } }, { isBonus: { not_equals: true } }] },
    sort: 'title',
    limit: 200,
    depth: 0,
    overrideAccess: true,
    select: { title: true } as never,
  })).docs as unknown as Array<{ id: number; title: string }>

  return (
    <StudioPage
      props={props}
      title="Enrol learners"
      icon="enrollments"
      eyebrow="Learners"
      intro="Give people a programme for a set time, with no payment. New emails get an account and a link to set their password."
    >
      <EnrolClient courses={courses} />
    </StudioPage>
  )
}
