import { blocks, greeting, lifecycleEmail } from './shared.js'
import type { MessageData, PlanEmailData } from '../../lib/lifecycle/context.js'
import type { CopyResolver } from '../define.js'

/**
 * Track L: the guided 12-week plan (service, never selling). Sent by the guided-plan job to
 * guided learners only; respects "Learning reminders" and unsubscribe like Track I.
 * L1 every Monday morning: this week's goals. L2 on Thursday evening: a kind catch-up note.
 */

const PLAN_VARS = {
  planWeek: 'This week of their plan, e.g. 3',
  planWeeks: 'Weeks in their plan, e.g. 12',
  planTime: 'Time for this week’s steps, e.g. 2 h 10 min',
  planItemCount: 'How many steps are left this week, e.g. 3',
  nextItemTitle: 'The next step’s title',
  nextItemMinutes: 'How long the next step takes in minutes, e.g. 19',
  overdueCount: 'Steps still waiting from earlier weeks, e.g. 2',
}

/** Only the placeholders a slot uses (the editor offers these; subjects stay short). */
const pick = (...keys: Array<keyof typeof PLAN_VARS>) => Object.fromEntries(keys.map((key) => [key, PLAN_VARS[key]]))

const planVars = (plan: PlanEmailData) => ({
  planWeek: plan.week,
  planWeeks: plan.weeks,
  planTime: plan.timeLabel,
  planItemCount: plan.items.length,
  nextItemTitle: plan.nextTitle,
  nextItemMinutes: plan.nextMinutes,
  overdueCount: plan.overdueCount,
})

/** A plan email renders only with plan data (the job always passes it). */
const planOf = (d: MessageData): PlanEmailData => d.plan ?? { week: 1, weeks: 12, items: [], timeLabel: '', behind: false, overdueCount: 0, nextTitle: '', nextMinutes: 0, nextUrl: d.resumeUrl, planUrl: d.dashboardUrl }

const itemLines = (plan: PlanEmailData, c: CopyResolver<'itemLine'>) => plan.items.map((item) => c.itemLine({ itemTitle: item.title, itemMinutes: item.minutes }))

export const L1 = lifecycleEmail({
  id: 'L1',
  kind: 'service',
  track: 'L',
  stepId: 'L1',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'Your week {{planWeek}} plan', vars: pick('planWeek') },
    preheader: { label: 'Preview text', kind: 'preheader', default: '{{planItemCount}} short steps, about {{planTime}} in all.', vars: pick('planItemCount', 'planTime') },
    catchUp: {
      label: 'Opening line (behind)',
      default: "Life happens. A few steps from earlier weeks are still waiting, and that's okay: catch up this week, or move your plan so it fits.",
      vars: pick('overdueCount'),
    },
    intro: { label: 'This week', default: 'Here is week {{planWeek}} of {{planWeeks}} for {{programme}}:', vars: pick('planWeek', 'planWeeks') },
    itemLine: { label: 'One step in the list', default: '{{itemTitle}} ({{itemMinutes}} min)', vars: { itemTitle: 'The step’s title', itemMinutes: 'How long it takes in minutes' } },
    total: { label: 'Total time', default: "That's about {{planTime}} in all. Short sessions on a few evenings work well.", vars: pick('planTime') },
    move: { label: 'Move my plan (behind; the link follows)', default: 'Move my plan:' },
    ctaLabel: { label: 'Button', kind: 'button', default: 'Continue my plan' },
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
        plan.items.length ? { list: itemLines(plan, c) } : '',
        plan.timeLabel ? c.total(vars) : '',
        plan.behind ? `${c.move(vars)} ${plan.planUrl}` : '',
      ]),
      button: { label: c.ctaLabel(), url: plan.nextUrl },
    }
  },
})

export const L2 = lifecycleEmail({
  id: 'L2',
  kind: 'service',
  track: 'L',
  stepId: 'L2',
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: "You're a little behind", vars: pick('overdueCount') },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'One short step gets you moving again.', vars: pick('nextItemTitle') },
    intro: {
      label: 'Opening line',
      default: "It's been about a week since your last lesson in {{programme}}, and {{overdueCount}} steps from earlier weeks are still waiting. Life happens, I know.",
      vars: pick('overdueCount'),
    },
    next: { label: 'Next step', default: 'Your next step is "{{nextItemTitle}}". It takes about {{nextItemMinutes}} minutes.', vars: pick('nextItemTitle', 'nextItemMinutes') },
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
