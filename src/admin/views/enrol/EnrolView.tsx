/**
 * /admin/enrol: enrol people on one or more programmes for a set number of months or days, with
 * no payment, or move learners from one programme to another. The rules live in
 * src/lib/manual-enrolment.ts and src/lib/programme-change.ts; EnrolClient does the picking and
 * shows a result for every email. Admins only.
 */
import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { isAdmin } from '../../data/auth'
import { EnrolClient } from './EnrolClient'

export async function EnrolView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!isAdmin(req)) return <NotAvailable props={props} title="Enrol learners" />
  const all = (await req.payload.find({
    collection: 'courses',
    where: { isBonus: { not_equals: true } },
    sort: 'title',
    limit: 200,
    depth: 0,
    overrideAccess: true,
    select: { title: true, slug: true, status: true } as never,
  })).docs as unknown as Array<{ id: number; title: string; slug: string; status?: string | null }>
  const programme = ({ id, title, slug }: (typeof all)[number]) => ({ id, title, slug })
  const courses = all.filter((course) => course.status === 'published').map(programme)
  // Learners can still be moved off a programme that has been unpublished.
  const movable = all.map((course) => (course.status === 'published' ? programme(course) : { ...programme(course), title: `${course.title} (not published)` }))

  return (
    <StudioPage
      props={props}
      title="Enrol learners"
      icon="enrollments"
      eyebrow="Learners"
      intro="Give people one or more programmes for a set time, with no payment, or move learners to another programme. New emails get an account and a link to set their password."
    >
      <EnrolClient courses={courses} movable={movable} />
    </StudioPage>
  )
}
