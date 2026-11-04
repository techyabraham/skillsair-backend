import { describe, expect, it } from 'vitest'
import { manualEnrolSchema } from './manual-enrol.js'

const duration = { unit: 'months', amount: 3 }

describe('POST /api/studio/manual-enrolment body', () => {
  it('takes each learner with their own programmes', () => {
    const body = manualEnrolSchema.parse({ entries: [{ email: 'ada@x.com', courseIds: [1, 2] }, { email: 'tobi@x.com', courseIds: [2] }], duration })
    expect(body.entries).toHaveLength(2)
    expect(body.notify).toBe(true)
  })

  it('still takes the older one-programme form', () => {
    const body = manualEnrolSchema.parse({ courseId: 4, emails: ['ada@x.com'], duration })
    expect(body).toMatchObject({ courseId: 4, emails: ['ada@x.com'] })
  })

  it('refuses an empty request and more than 50 learner-programme pairs', () => {
    expect(manualEnrolSchema.safeParse({ duration }).success).toBe(false)
    const entries = Array.from({ length: 26 }, (_, i) => ({ email: `p${i}@x.com`, courseIds: [1, 2] }))
    expect(manualEnrolSchema.safeParse({ entries, duration }).success).toBe(false)
    expect(manualEnrolSchema.safeParse({ entries: entries.slice(0, 25), duration }).success).toBe(true)
  })
})
