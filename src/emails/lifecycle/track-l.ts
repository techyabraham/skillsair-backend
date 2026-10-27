import { blocks, greeting, lifecycleEmail } from './shared.js'
import type { MessageData, PlanEmailData } from '../../lib/lifecycle/context.js'

/**
 * Track L: the guided 12-week plan, Monday to Friday (service, never selling). Sent by the
 * guided-plan job to guided learners only (never chapter view); respects "Learning reminders"
 * and unsubscribe like Track I.
 * L1 every Monday morning: this week, one day at a time. L2 on Thursday evening: a kind catch-up note.
 */

const PLAN_VARS = {
  planWeek: 'This week of their plan, e.g. 3',
  planWeeks: 'Weeks in their plan, e.g. 12',
  dailyMinutes: 'Average minutes a weekday this week, e.g. 15',
  daysBehind: 'Weekdays behind, e.g. "2 days" or "1 week"',
  nextItemTitle: 'The next lesson’s title',
  nextItemMinutes: 'How long the next lesson takes in minutes, e.g. 12',
}

/** Only the placeholders a slot uses (the editor offers these; subjects stay short). */
const pick = (...keys: Array<keyof typeof PLAN_VARS>) => Object.fromEntries(keys.map((key) => [key, PLAN_VARS[key]]))

const planVars = (plan: PlanEmailData) => ({
  planWeek: plan.week,
  planWeeks: plan.weeks,
  dailyMinutes: plan.dailyMinutes,
  daysBehind: plan.daysBehindLabel,
  nextItemTitle: plan.nextTitle,
  nextItemMinutes: plan.nextMinutes,
})

/** A plan email renders only with plan data (the job always passes it). */
const planOf = (d: MessageData): PlanEmailData => d.plan ?? { week: 1, weeks: 12, days: [], dailyMinutes: 0, behind: false, daysBehind: 0, daysBehindLabel: '', ahead: false, nextTitle: '', nextMinutes: 0, nextUrl: d.resumeUrl, planUrl: d.dashboardUrl }

export const L1 = lifecycleEmail({
  id: 'L1',
  kind: 'service',
  track: 'L',
  stepId: 'L1',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your week {{planWeek}} plan, {{firstName}}: a lesson a day', vars: pick('planWeek') },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'About {{dailyMinutes}} minutes a weekday, Monday to Friday.', vars: pick('dailyMinutes') },
    catchUp: {
      label: 'Opening line (behind)',
      default: "Life happens. You're {{daysBehind}} behind, and that's okay: catch up this week, or move your plan so it fits.",
      vars: pick('daysBehind'),
    },
    intro: { label: 'This week', default: "It's week {{planWeek}} of your **{{programme}}** plan. Here's your week, one day at a time:", vars: pick('planWeek', 'planWeeks') },
    dayLine: { label: 'One day in the list', default: '{{dayTitles}} · {{dayMinutes}} min', vars: { dayTitles: 'That day’s lesson titles', dayMinutes: 'That day’s minutes' } },
    practise: {
      label: 'Practise and go ahead',
      default: "Practise each one straight after you watch it. That's what makes it stick. Feeling keen? You can always go ahead of the class.",
    },
    move: { label: 'Move my plan (behind; the link follows)', default: 'Move my plan:' },
    ctaStart: { label: 'Button (on track)', kind: 'button', default: "Start Monday's lesson" },
    ctaAhead: { label: 'Button (already ahead)', kind: 'button', default: 'Keep going' },
    ctaBehind: { label: 'Button (behind)', kind: 'button', default: 'Catch up now' },
    ps: { label: 'P.S.', default: 'Busy week? You can move your plan from your dashboard so it fits.' },
  },
  subject: (d, c) => c.subject(planVars(planOf(d))),
  preheader: (d, c) => c.preheader(planVars(planOf(d))),
  body: (d, c) => {
    const plan = planOf(d)
    const vars = planVars(plan)
    return {
      blocks: blocks([
        greeting(d),
        plan.behind ? c.catchUp(vars) : '',
        c.intro(vars),
        plan.days.length ? { rows: plan.days.map((day) => ({ label: day.label, value: c.dayLine({ dayTitles: day.titles, dayMinutes: day.minutes }) })) } : '',
        c.practise(vars),
        plan.behind ? `${c.move(vars)} ${plan.planUrl}` : '',
      ]),
      button: { label: plan.behind ? c.ctaBehind() : plan.ahead ? c.ctaAhead() : c.ctaStart(), url: plan.nextUrl },
      ps: plan.behind ? undefined : c.ps(vars),
    }
  },
})

export const L2 = lifecycleEmail({
  id: 'L2',
  kind: 'service',
  track: 'L',
  stepId: 'L2',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: "You're a little behind" },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'One short lesson gets you moving again.' },
    intro: {
      label: 'Opening line',
      default: "It's been about a week since your last lesson in {{programme}}, and you're {{daysBehind}} behind your plan. Life happens, I know.",
      vars: pick('daysBehind'),
    },
    next: { label: 'Next lesson', default: 'Your next lesson is "{{nextItemTitle}}". It takes about {{nextItemMinutes}} minutes.', vars: pick('nextItemTitle', 'nextItemMinutes') },
    move: { label: 'Move my plan (the link follows)', default: 'If your weeks have changed, move your plan so it fits:' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Continue my plan' },
  },
  subject: (d, c) => c.subject(planVars(planOf(d))),
  preheader: (d, c) => c.preheader(planVars(planOf(d))),
  body: (d, c) => {
    const plan = planOf(d)
    const vars = planVars(plan)
    return {
      blocks: blocks([greeting(d), c.intro(vars), plan.nextTitle ? c.next(vars) : '', `${c.move(vars)} ${plan.planUrl}`]),
      button: { label: c.ctaLabel(), url: plan.nextUrl },
    }
  },
})

export const TRACK_L = [L1, L2]
