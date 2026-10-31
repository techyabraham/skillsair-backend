import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeStages, pickActiveTrack, TRACK_PRIORITY } from './stage.js'
import { planPerson, idempotencyKey } from './plan.js'
import { isDryRun, isLive, liveTracks } from './live.js'
import { leadAllowsMarketing, userAllowsMarketing } from '../marketing-permission.js'
import { DAY, HOUR, inQuietHours, isSundayInLagos } from './timing.js'
import type { LogEntry, PersonSnapshot, Stage, WindowState } from './types.js'

const at = (iso: string) => Date.parse(iso)
// Monday 19 October 2026, 10:00 in Lagos.
const T0 = at('2026-10-19T09:00:00Z')
const openWindow: WindowState = { open: true, opensAt: at('2026-10-01T00:00:00+01:00'), closesAt: at('2026-10-31T23:59:00+01:00'), lastClosedAt: null }
const config = (now: number) => ({ now, graceDays: 3, staleAfterMs: 3 * DAY })

function person(overrides: Partial<PersonSnapshot> = {}): PersonSnapshot {
  return {
    key: 'user:1', kind: 'user', id: 1, createdAt: T0, email: 'tobi@example.com', phone: '+2348000000000',
    emailSuppressed: false, marketingEmailAllowed: true, marketingWhatsAppAllowed: true, learningReminders: true,
    sunsetAt: null, lastEngagedAt: T0, lastLearningAt: null,
    lead: { id: 7, status: 'new', createdAt: T0, courseId: 3 },
    orders: [], subscriptions: [], enrollments: [], certificates: [],
    ...overrides,
  }
}

const stage = (track: Stage['track'], enteredAt = T0): Stage => ({ track, subjectId: `${track}:1`, enteredAt, cycle: 0 })

test('timing: quiet hours and Sundays are in Lagos time', () => {
  assert.equal(inQuietHours(at('2026-10-19T06:30:00Z')), true) // 7:30am Lagos
  assert.equal(inQuietHours(at('2026-10-19T07:00:00Z')), false) // 8:00am
  assert.equal(inQuietHours(at('2026-10-19T19:00:00Z')), true) // 8:00pm
  assert.equal(isSundayInLagos(at('2026-10-25T10:00:00Z')), true)
  assert.equal(isSundayInLagos(at('2026-10-24T23:30:00Z')), true) // 00:30 Sunday in Lagos
})

test('pickActiveTrack follows the priority D → B → R → C → I → A → Apost → G', () => {
  for (let high = 0; high < TRACK_PRIORITY.length; high++) {
    for (let low = high + 1; low < TRACK_PRIORITY.length; low++) {
      const winner = pickActiveTrack([stage(TRACK_PRIORITY[low]!), stage(TRACK_PRIORITY[high]!)])
      assert.equal(winner?.track, TRACK_PRIORITY[high], `${TRACK_PRIORITY[high]} over ${TRACK_PRIORITY[low]}`)
    }
  }
  assert.equal(pickActiveTrack([]), null)
})

test('computeStages: lead in an open window is A; closed window is Apost; paying ends both', () => {
  assert.deepEqual(computeStages(person(), openWindow, T0 + HOUR).map((s) => s.track), ['A'])
  const closed: WindowState = { open: false, opensAt: null, closesAt: null, lastClosedAt: at('2026-10-31T23:59:00+01:00') }
  assert.deepEqual(computeStages(person(), closed, at('2026-11-02T10:00:00Z')).map((s) => s.track), ['Apost'])
  const paid = person({ orders: [{ id: 1, type: 'subscription', status: 'success', courseId: 3, createdAt: T0 + HOUR }] })
  assert.deepEqual(computeStages(paid, openWindow, T0 + 2 * HOUR).map((s) => s.track), [])
})

test('computeStages: lapse (R), completion (C), certificate (G), learning (I), failed payment (D)', () => {
  const enrollment = { id: 5, courseId: 3, status: 'active', enrolledAt: T0, completedAt: null, cycle: 1, subscriptionBased: true }
  const base = { lead: null, orders: [{ id: 1, type: 'subscription', status: 'success', courseId: 3, createdAt: T0 }] }
  const learning = person({ ...base, enrollments: [enrollment], subscriptions: [{ id: 9, courseId: 3, status: 'active', lastFailedAt: null, currentPeriodEnd: T0 + 30 * DAY, failedAttempts: 0, updatedAt: T0 }] })
  assert.deepEqual(computeStages(learning, openWindow, T0 + DAY).map((s) => s.track), ['I'])
  const pastDue = person({ ...base, enrollments: [enrollment], subscriptions: [{ id: 9, courseId: 3, status: 'past_due', lastFailedAt: T0 + 30 * DAY, currentPeriodEnd: T0 + 30 * DAY, failedAttempts: 1, updatedAt: T0 }] })
  assert.deepEqual(computeStages(pastDue, openWindow, T0 + 31 * DAY).map((s) => s.track).sort(), ['D', 'I'])
  const lapsed = person({ ...base, enrollments: [enrollment], subscriptions: [{ id: 9, courseId: 3, status: 'expired', lastFailedAt: T0 + 30 * DAY, currentPeriodEnd: T0 + 30 * DAY, failedAttempts: 1, updatedAt: T0 + 33 * DAY }] })
  const r = computeStages(lapsed, openWindow, T0 + 34 * DAY)
  assert.deepEqual(r.map((s) => [s.track, s.cycle]), [['R', 1]])
  const done = person({ ...base, enrollments: [{ ...enrollment, status: 'completed', completedAt: T0 + 40 * DAY }] })
  assert.deepEqual(computeStages(done, openWindow, T0 + 41 * DAY).map((s) => s.track), ['C'])
  const certified = person({ ...base, enrollments: [{ ...enrollment, status: 'completed', completedAt: T0 + 40 * DAY }], certificates: [{ courseId: 3, issuedAt: T0 + 42 * DAY }] })
  assert.deepEqual(computeStages(certified, openWindow, T0 + 43 * DAY).map((s) => s.track), ['G'])
})

test('imported one-off learners (no monthly plan) get no nudges or win-back', () => {
  const legacy = person({ lead: null, enrollments: [{ id: 5, courseId: 3, status: 'active', enrolledAt: T0 - 400 * DAY, completedAt: null, cycle: 0, subscriptionBased: false }] })
  assert.deepEqual(computeStages(legacy, openWindow, T0), [])
})

const sent = (key: string, stepId: string, sentAt: number, kind: LogEntry['kind'] = 'marketing', channel: LogEntry['channel'] = 'email'): LogEntry => ({
  idempotencyKey: key, track: key.split(':')[0]!, stepId, kind, channel, status: 'sent', sentAt,
})

test('caps: one marketing email a day, three a week; no marketing on Sundays or outside 8am–8pm', () => {
  const p = person()
  const cycle = Math.floor((openWindow.closesAt! + HOUR) / DAY)
  const key = (id: string) => idempotencyKey('A', id, 'lead:7', cycle)
  // A2 is due at T0+24h; A1 went at T0+1h. Same Lagos day as another marketing email → deferred.
  const sameDay = planPerson(p, openWindow, [sent(key('A1'), 'A1', T0 + 25 * HOUR - 1)], config(T0 + 25 * HOUR))
  assert.ok(sameDay.deferred.some((d) => d.reason === 'daily_cap'))
  // A3 was clicked, so its WhatsApp follow-up doesn't go and A4 is next in line.
  // A1–A5 are exempt from the weekly cap: A4 goes on day 4 after A1–A3.
  const week = [sent(key('A1'), 'A1', T0 + HOUR), sent(key('A2'), 'A2', T0 + 24 * HOUR), { ...sent(key('A3'), 'A3', T0 + 48 * HOUR), clickedAt: T0 + 50 * HOUR }]
  const fourth = planPerson(p, openWindow, week, config(T0 + 72 * HOUR + HOUR))
  assert.ok(fourth.actions.some((a) => a.type === 'send' && a.stepId === 'A4'))
  // Other tracks keep the cap: three Track R emails this week hold back a fourth marketing email.
  const lapsedKey = (id: string) => idempotencyKey('R', id, 'enr:5', 1)
  const rWeek = [sent(lapsedKey('R1'), 'R1', T0 - 5 * DAY), { ...sent(lapsedKey('R2'), 'R2', T0 - 3 * DAY), clickedAt: T0 - 3 * DAY + HOUR }, sent(lapsedKey('R3'), 'R3', T0 - DAY)]
  const lapsed = person({
    lead: null,
    orders: [{ id: 1, type: 'subscription', status: 'success', courseId: 3, createdAt: T0 - 60 * DAY }],
    subscriptions: [{ id: 9, courseId: 3, status: 'expired', lastFailedAt: null, currentPeriodEnd: T0 - 30 * DAY, failedAttempts: 0, updatedAt: T0 - 30 * DAY }],
    enrollments: [{ id: 5, courseId: 3, status: 'active', enrolledAt: T0 - 60 * DAY, completedAt: null, cycle: 1, subscriptionBased: true }],
  })
  const capped = planPerson(lapsed, openWindow, rWeek, config(T0 + HOUR))
  assert.ok(capped.deferred.some((d) => d.reason === 'weekly_cap'))
  assert.ok(planPerson(p, openWindow, [], config(at('2026-10-19T19:30:00Z'))).deferred.some((d) => d.reason === 'quiet_hours'))
  const sunday = person({ createdAt: at('2026-10-25T08:00:00Z'), lead: { id: 7, status: 'new', createdAt: at('2026-10-25T08:00:00Z'), courseId: 3 } })
  assert.ok(planPerson(sunday, openWindow, [], config(at('2026-10-25T10:00:00Z'))).deferred.some((d) => d.reason === 'sunday'))
})

test('no consent: no marketing; transactional still goes', () => {
  const p = person({ marketingEmailAllowed: false, marketingWhatsAppAllowed: false })
  const plan = planPerson(p, openWindow, [], config(T0 + 2 * HOUR))
  assert.deepEqual(plan.actions.map((a) => a.type === 'sunset' ? 'sunset' : `${a.type}:${a.stepId}:${'reason' in a ? a.reason : ''}`), ['skip:A1:no_consent'])
  const checkout = person({ marketingEmailAllowed: false, orders: [{ id: 4, type: 'subscription', status: 'pending', courseId: 3, createdAt: T0 }] })
  const b = planPerson(checkout, openWindow, [], config(T0 + 90 * 60 * 1000))
  assert.ok(b.actions.some((a) => a.type === 'send' && a.stepId === 'B1'))
})

test('idempotency: a logged step is never planned again', () => {
  const p = person()
  const first = planPerson(p, openWindow, [], config(T0 + 2 * HOUR))
  const a1 = first.actions.find((a) => a.type === 'send')
  assert.ok(a1 && a1.type === 'send' && a1.stepId === 'A1')
  const second = planPerson(p, openWindow, [sent(a1.idempotencyKey, 'A1', T0 + 2 * HOUR)], config(T0 + 3 * HOUR))
  assert.equal(second.actions.filter((a) => a.type === 'send').length, 0)
})

test('sunset: 90 days without engagement sends X1 once, then stops marketing after 14 more days', () => {
  const quiet = person({ lastEngagedAt: T0 - 100 * DAY, createdAt: T0 - 100 * DAY, lead: { id: 7, status: 'new', createdAt: T0 - 100 * DAY, courseId: 3 } })
  const closed: WindowState = { open: false, opensAt: null, closesAt: null, lastClosedAt: T0 - 60 * DAY }
  const now = T0 + HOUR
  const x = planPerson(quiet, closed, [], config(now)).actions.find((a) => a.type === 'send' && a.stepId === 'X1')
  assert.ok(x)
  const later = planPerson(quiet, closed, [sent(idempotencyKey('X', 'X1', 'user:1', 0), 'X1', now)], config(now + 15 * DAY))
  assert.ok(later.actions.some((a) => a.type === 'sunset'))
})

/**
 * The whole journey for one person (brief section 12): lead → checkout not finished → paid →
 * inactive → payment failed → lapsed → renewed → completed → certified → second programme.
 * Event-driven messages (A0, T1, T3, D1, T6, T7, T8, T9) are added when the event happens,
 * as events.ts does; everything else comes from the planner, run every hour.
 */
test('integration: the full journey sends exactly the expected messages, in order', () => {
  const snap = person()
  const log: LogEntry[] = []
  const timeline: string[] = []
  const event = (stepId: string, now: number) => {
    log.push({ idempotencyKey: `T:${stepId}:${now}`, track: 'T', stepId, kind: 'transactional', channel: 'email', status: 'sent', sentAt: now })
    timeline.push(stepId)
  }
  const course = 3
  const enrollment = { id: 5, courseId: course, status: 'active', enrolledAt: 0, completedAt: null as number | null, cycle: 0, subscriptionBased: true }
  const events: Array<[number, () => void]> = [
    [T0, () => event('A0', T0)],
    // Day 3, 4pm: starts checkout and doesn't finish.
    [T0 + 3 * DAY + 6 * HOUR, () => snap.orders.push({ id: 40, type: 'subscription', status: 'pending', courseId: course, createdAt: T0 + 3 * DAY + 6 * HOUR })],
    // Day 4, 2pm: pays.
    [T0 + 4 * DAY + 4 * HOUR, () => {
      const paidAt = T0 + 4 * DAY + 4 * HOUR
      snap.orders.push({ id: 41, type: 'subscription', status: 'success', courseId: course, createdAt: paidAt })
      snap.lead!.status = 'paid'
      snap.subscriptions.push({ id: 9, courseId: course, status: 'active', lastFailedAt: null, currentPeriodEnd: paidAt + 30 * DAY, failedAttempts: 0, updatedAt: paidAt })
      snap.enrollments.push({ ...enrollment, enrolledAt: paidAt })
      event('T1', paidAt)
    }],
    // Day 8: does one lesson, then goes quiet.
    [T0 + 8 * DAY + 2 * HOUR, () => { snap.lastLearningAt = T0 + 8 * DAY + 2 * HOUR }],
    // Day 31: upcoming-charge notice (Paystack invoice.create, 3 days before).
    [T0 + 31 * DAY + 4 * HOUR, () => event('T3', T0 + 31 * DAY + 4 * HOUR)],
    // Day 34: renewal fails.
    [T0 + 34 * DAY + 4 * HOUR, () => {
      const failedAt = T0 + 34 * DAY + 4 * HOUR
      Object.assign(snap.subscriptions[0]!, { status: 'past_due', lastFailedAt: failedAt, failedAttempts: 1, updatedAt: failedAt })
      event('D1', failedAt)
    }],
    // Day 37: grace over, access paused.
    [T0 + 37 * DAY + 5 * HOUR, () => {
      const endedAt = T0 + 37 * DAY + 5 * HOUR
      Object.assign(snap.subscriptions[0]!, { status: 'expired', updatedAt: endedAt })
      snap.enrollments[0]!.cycle = 1
      event('T6', endedAt)
    }],
    // Day 46: restarts at the locked rate.
    [T0 + 46 * DAY + 3 * HOUR, () => {
      const at46 = T0 + 46 * DAY + 3 * HOUR
      snap.orders.push({ id: 42, type: 'subscription', status: 'success', courseId: course, createdAt: at46 })
      snap.subscriptions.push({ id: 10, courseId: course, status: 'active', lastFailedAt: null, currentPeriodEnd: at46 + 30 * DAY, failedAttempts: 0, updatedAt: at46 })
      snap.lastLearningAt = at46 + HOUR
      event('T7', at46)
    }],
    // Day 60: finishes; billing stops (plan runs to the end of the month).
    [T0 + 60 * DAY + 3 * HOUR, () => {
      const doneAt = T0 + 60 * DAY + 3 * HOUR
      snap.lastLearningAt = doneAt
      Object.assign(snap.enrollments[0]!, { status: 'completed', completedAt: doneAt })
      Object.assign(snap.subscriptions[1]!, { status: 'cancelled', updatedAt: doneAt })
      event('T8', doneAt)
    }],
    // Day 68: buys the certificate.
    [T0 + 68 * DAY + 3 * HOUR, () => {
      snap.certificates.push({ courseId: course, issuedAt: T0 + 68 * DAY + 3 * HOUR })
      event('T9', T0 + 68 * DAY + 3 * HOUR)
    }],
    // Day 84: starts a second programme.
    [T0 + 84 * DAY + 3 * HOUR, () => {
      const at84 = T0 + 84 * DAY + 3 * HOUR
      snap.orders.push({ id: 43, type: 'subscription', status: 'success', courseId: 8, createdAt: at84 })
      snap.subscriptions.push({ id: 11, courseId: 8, status: 'active', lastFailedAt: null, currentPeriodEnd: at84 + 30 * DAY, failedAttempts: 0, updatedAt: at84 })
      snap.enrollments.push({ id: 6, courseId: 8, status: 'active', enrolledAt: at84, completedAt: null, cycle: 0, subscriptionBased: true })
      snap.lastLearningAt = at84 + HOUR
      event('T1', at84)
    }],
  ]

  let next = 0
  for (let now = T0; now <= T0 + 90 * DAY; now += HOUR) {
    while (next < events.length && events[next]![0] <= now) events[next++]![1]()
    // The scholarship window closes on 31 October; the next one opens later.
    const window: WindowState = now < openWindow.closesAt! ? openWindow : { open: false, opensAt: null, closesAt: null, lastClosedAt: openWindow.closesAt }
    const plan = planPerson(snap, window, log, config(now))
    for (const action of plan.actions) {
      if (action.type === 'sunset') continue
      log.push({ idempotencyKey: action.idempotencyKey, track: action.stage.track, stepId: action.stepId, kind: action.kind, channel: action.channel, status: action.type === 'send' ? 'sent' : 'skipped', skipReason: action.type === 'skip' ? action.reason : null, sentAt: now })
      if (action.type === 'send') timeline.push(action.stepId)
    }
  }

  if (process.env.PRINT_TIMELINE) console.log('TIMELINE', JSON.stringify(timeline))
  assert.deepEqual(timeline, [
    // Track A: A1–A5 daily (exempt from the weekly cap); A3's WhatsApp a day after A3, before A4 the same morning.
    'A0', 'A1', 'A2', 'A3', 'A3-WA', 'A4',
    // Checkout not finished: B1 after 1 hour, the WhatsApp payment help after 2. They pay before B2.
    'B1', 'B1-WA',
    // Paid: welcome; no lesson in 48 hours (I0); one lesson on day 8, then quiet (I1 5d, I2 10d, its WhatsApp, I3 18d).
    'T1', 'I0', 'I1', 'I2', 'I2-WA', 'I3',
    // Upcoming charge, failed renewal (D1–D3 in the grace days), access paused, win-back (R1, R2 and its WhatsApp).
    'T3', 'D1', 'D2', 'D3', 'T6', 'R1', 'R2', 'R2-WA',
    // Restarts (welcome back) and learns, goes quiet again (I1, I2, WhatsApp).
    'T7', 'I1', 'I2', 'I2-WA',
    // Finishes: completion email; certificate track until they buy it.
    'T8', 'C1', 'C2', 'C2-WA', 'T9',
    // Certified: next-programme emails until they start one; then it's learning again.
    'G1', 'G2', 'G2-WA', 'T1', 'I1',
  ])

  // Acceptance (brief section 16): across the run, the frequency and timing rules held.
  const marketing = log.filter((entry) => entry.status === 'sent' && entry.kind === 'marketing')
  const marketingEmail = marketing.filter((entry) => entry.channel === 'email')
  for (const entry of marketing) {
    assert.ok(!isSundayInLagos(entry.sentAt), `${entry.stepId} on a Sunday`)
    assert.ok(!inQuietHours(entry.sentAt), `${entry.stepId} outside 8am–8pm`)
  }
  for (const entry of marketingEmail) {
    const sameDay = marketingEmail.filter((other) => Math.floor((other.sentAt + HOUR) / DAY) === Math.floor((entry.sentAt + HOUR) / DAY))
    assert.equal(sameDay.length, 1, `two marketing emails on the day of ${entry.stepId}`)
    const counted = marketingEmail.filter((other) => !(other.track === 'A' && ['A1', 'A2', 'A3', 'A4', 'A5'].includes(other.stepId)))
    const week = counted.filter((other) => other.sentAt <= entry.sentAt && other.sentAt > entry.sentAt - 7 * DAY)
    assert.ok(week.length <= 3, `more than 3 capped marketing emails in the week before ${entry.stepId}`)
  }
  // Selling (A, R, C, G) never went out while a programme was being studied (I or D active).
  const sellingWhileLearning = marketing.filter((entry) => ['A', 'R', 'C', 'G'].includes(entry.track) && log.some((other) => other.track === 'I' && Math.abs(other.sentAt - entry.sentAt) < HOUR))
  assert.deepEqual(sellingWhileLearning.map((entry) => entry.stepId), [])
})

test('live settings: hand-typed values are forgiven, and anything but "false" stays dry-run', () => {
  const before = { dry: process.env.LIFECYCLE_DRY_RUN, tracks: process.env.LIFECYCLE_LIVE_TRACKS }
  const set = (dry: string | undefined, tracks: string | undefined) => {
    if (dry === undefined) delete process.env.LIFECYCLE_DRY_RUN
    else process.env.LIFECYCLE_DRY_RUN = dry
    if (tracks === undefined) delete process.env.LIFECYCLE_LIVE_TRACKS
    else process.env.LIFECYCLE_LIVE_TRACKS = tracks
  }
  try {
    for (const dry of ['false', 'False', 'FALSE', ' false ', '"false"', "'false'"]) {
      set(dry, 'T,D,B,A')
      assert.equal(isDryRun(), false, `"${dry}" should turn dry-run off`)
      assert.equal(isLive('T'), true)
    }
    for (const dry of [undefined, '', 'true', 'no', '0', 'flase']) {
      set(dry, 'all')
      assert.equal(isDryRun(), true, `"${dry}" should stay dry-run`)
      assert.equal(isLive('T'), false)
    }
    for (const tracks of ['T,D,B,A', 'T,D.B.A', 't, d, b, a', '"T,D,B,A"', 'T D;B,A']) {
      set('false', tracks)
      assert.deepEqual(liveTracks(), ['t', 'd', 'b', 'a'], tracks)
      for (const track of ['T', 'D', 'B', 'A']) assert.equal(isLive(track), true, `${track} in "${tracks}"`)
      assert.equal(isLive('Apost'), false)
      assert.equal(isLive('R'), false)
    }
    set('false', 'T,Apost')
    assert.equal(isLive('Apost'), true)
    set('false', 'all')
    assert.equal(isLive('X'), true)
    set('false', '')
    assert.equal(isLive('T'), false)
  } finally {
    set(before.dry, before.tracks)
  }
})

test('marketing is on by default, and an opt-out always wins', () => {
  const OUT = '2026-10-20T10:00:00.000Z'
  // Anyone who gave an email or number, ticked or not.
  assert.equal(leadAllowsMarketing({}), true)
  assert.equal(leadAllowsMarketing({ optedOutAt: null }), true)
  assert.equal(userAllowsMarketing({}), true)
  assert.equal(userAllowsMarketing({ marketingConsent: 'unknown', lifecycle: { emailPrefs: { offers: false } } }), true)
  assert.equal(userAllowsMarketing({ marketingConsent: 'opted_in', lifecycle: { emailPrefs: { offers: true } } }), true)
  // Unsubscribe, STOP or the preference centre.
  assert.equal(leadAllowsMarketing({ optedOutAt: OUT }), false)
  assert.equal(leadAllowsMarketing(null), false)
  assert.equal(userAllowsMarketing({ marketingConsent: 'opted_out' }), false)
  assert.equal(userAllowsMarketing({ marketingConsent: 'opted_out', lifecycle: { emailPrefs: { offers: true } } }), false)
  assert.equal(userAllowsMarketing({ marketingConsent: 'opted_in', lifecycle: { emailPrefs: { offers: false } } }), false)
  // A STOP on the application still counts after they create an account.
  assert.equal(userAllowsMarketing({ marketingConsent: 'unknown' }, { optedOutAt: OUT }), false)
  assert.equal(userAllowsMarketing({ marketingConsent: 'opted_in', lifecycle: { emailPrefs: { offers: true } } }, { optedOutAt: OUT }), false)
})
