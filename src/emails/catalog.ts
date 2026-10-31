import type { CopySlot, EmailOverride } from './copy.js'
import type { RenderedEmail } from './define.js'
import type { EmailKind } from './layout.js'
import { COMPANY_LINE, SIGN_OFF_HELP, SIGN_OFF_NAME } from './layout.js'
import { emailTemplates } from './index.js'
import { LIFECYCLE_TEMPLATES, SAMPLE } from './lifecycle/index.js'
import { SHARED_COPY } from './lifecycle/shared.js'
import { LIFECYCLE_VAR_DOCS } from './copy-vars.js'
import { SAMPLE_FOOTER_LINKS, SCENARIOS, type Scenario } from './scenarios.js'
import { SETTINGS_ID, SHARED_ID, withOverrides } from './override-store.js'
import { SEQUENCES, type Step } from '../lib/lifecycle/sequences.js'

/**
 * Everything the Studio email editor can edit: every template, the shared phrases (`_shared`) and
 * the email settings (`_settings`), with a readable name, group and "when it's sent" sentence.
 */
export type EditorGroup = 'account' | 'learning' | 'applications' | 'shared' | 'settings'

export const GROUP_LABEL: Record<EditorGroup, string> = {
  account: 'Account and receipts',
  learning: 'Learning',
  applications: 'Applications and offers',
  shared: 'Shared phrases',
  settings: 'Email settings',
}

export interface EditableEntry {
  id: string
  name: string
  group: EditorGroup
  kind: EmailKind | 'shared' | 'settings'
  track: string
  stepId: string
  whenSent: string
  copy: Record<string, CopySlot>
  varDocs: Record<string, string>
  variantCount: number
}

/** Email settings (`_settings`): stored on the Email content global; empty uses the constant. */
export const SETTINGS_COPY: Record<string, CopySlot> = {
  senderName: { label: 'Sender name', default: process.env.EMAIL_FROM_NAME ?? 'Imisi from SkillsAir', maxLength: 60, help: 'The name inboxes show. The sending addresses don’t change.' },
  signOffName: { label: 'Sign-off name', default: SIGN_OFF_NAME, maxLength: 60 },
  signOffHelp: { label: 'Sign-off help line', default: SIGN_OFF_HELP, maxLength: 200, help: 'Must keep a phone number or “Reply to this email”.' },
  companyLine: { label: 'Company line (legal)', default: COMPANY_LINE, maxLength: 200, help: 'Required legal text: it can be edited but must keep “RC 9272398”.' },
}

const NAMES: Record<string, string> = {
  'password-reset': 'Password reset', 'email-verification': 'Confirm your email', 'account-welcome': 'Welcome (account created)',
  'account-enrolment': 'Enrolment confirmation', 'account-access-extended': 'Access extended', 'account-admin-enrolment': 'Enrolled by an admin', 'lead-daily-summary': 'Daily lead summary (internal)',
  A0: 'Scholarship offer', A1: 'Two questions everyone asks', A2: 'Why it’s ₦2,000 a month', A3: 'What the job is like', A4: '5 things in your offer',
  A5: 'Your seat is still open', A6: 'Scholarship closes in 2 days', A7: 'Closes tonight', W1: 'Scholarship open again',
  P1: 'The scholarship closed', P2: 'A free exercise', P3: 'No laptop?', P4: 'How to spot a fake course', P5: 'Still thinking about it?', P6: 'A day in the life',
  B1: 'Payment didn’t finish', B2: 'Need a hand finishing?', B3: 'Last step for checkout', X1: 'Should I keep writing?',
  T1: 'Welcome and receipt', T2: 'Monthly receipt', T3: 'Renewal reminder', T4: 'Card expiring', T5: 'Plan cancelled', T6: 'Access paused',
  T7: 'Welcome back', T8: 'You finished', T9: 'Certificate ready', T10: 'Next month due (transfer)', T11: 'Paid month ended (transfer)', T12: 'Final exam ready',
  D1: 'Renewal failed', D2: 'Payment still due', D3: 'Access pauses tonight',
  I0: 'First lesson nudge', I1: 'Pick up where you stopped', I2: 'Is something in the way?', I3: '20 minutes this week?',
  R1: 'Progress is waiting', R2: 'What happened?', R3: 'Plan to finish', R4: 'Your rate is still here', R5: 'Ready to finish? (repeats)',
  C1: 'What employers see', C2: 'Certificate unlocks 3 things', C2L: 'Laptop applications close', C3: 'Is the certificate worth it?', C4: 'Certificate waiting', C5: 'Certificate reminder (repeats)',
  G1: 'What to learn next', G2: 'Two certificates beat one', G3: 'Your next skill', G4: 'Graduate tips (repeats)',
}

/** What starts each track's clock, for "N days after …". */
const STAGE: Record<string, string> = {
  A: 'they apply', Apost: 'the scholarship window closes', B: 'they start checkout without paying', D: 'a renewal fails',
  I: 'their last lesson (or payment, if they haven’t started)', R: 'their access pauses', C: 'they finish', G: 'they get their certificate',
}

const EVENTS: Record<string, string> = {
  A0: 'Straight after they apply.', T1: 'When their first payment goes through.', T2: 'When a monthly payment goes through.',
  T3: 'A few days before a card renewal.', T4: 'When their card is about to expire.', T5: 'When they cancel their plan.', T6: 'When their access pauses.',
  T7: 'When they pay again after a pause.', T8: 'When they finish the programme.', T9: 'When their certificate is issued.',
  T10: 'A few days before a month paid by transfer or OPay ends.', T11: 'When a month paid by transfer or OPay ends.', T12: 'When the certificate fee is paid.',
  D1: 'When a card renewal fails.', X1: 'After 90 days without opening or clicking anything.',
}

const CONDITIONS: Record<string, string> = {
  A1: 'skipped if the window closes too soon', A2: 'skipped if the window closes too soon', A3: 'skipped if the window closes too soon',
  A4: 'skipped if the window closes too soon', A5: 'skipped if the window closes too soon', W1: 'only for people who applied before this window opened',
  P2: 'only when their school has a free exercise', I0: 'if they haven’t started', C2: 'unless laptop applications close soon', C2L: 'only when laptop applications close soon',
  D3: 'on the last grace day',
}

function duration(hours: number): string {
  if (hours === 0) return 'Straight after'
  if (hours % 24 === 0) return `${hours / 24} day${hours === 24 ? '' : 's'} after`
  return `${hours} hour${hours === 1 ? '' : 's'} after`
}

/** A readable sentence from sequences.ts, e.g. "2 days after they apply, skipped if the window closes too soon." */
export function whenSent(templateId: string): string {
  const step: Step | undefined = SEQUENCES.find((item) => item.template === templateId && item.channel === 'email')
  if (!step) return ''
  let sentence: string
  if (step.anchor === 'event') sentence = EVENTS[templateId] ?? 'When it happens.'
  else if (step.anchor === 'window_closes') sentence = `${Math.abs(step.offsetHours)} hours before the scholarship window closes`
  else if (step.anchor === 'window_close_day') sentence = `At ${step.offsetHours}am on the day the scholarship window closes`
  else if (templateId === 'D3') sentence = 'The morning of the last grace day'
  else sentence = `${duration(step.offsetHours)} ${STAGE[step.track] ?? 'the stage starts'}`
  if (step.anchor !== 'event') {
    const extra = [CONDITIONS[templateId], step.repeatEveryDays ? `then every ${step.repeatEveryDays} days, up to ${step.maxRepeats ?? 1} more times` : ''].filter(Boolean)
    sentence = `${sentence}${extra.length ? `, ${extra.join(', ')}` : ''}.`
  }
  return sentence
}

const ACCOUNT_WHEN: Record<string, string> = {
  'password-reset': 'When someone asks to reset their password.',
  'email-verification': 'When someone needs to confirm their email address.',
  'account-welcome': 'When an account is created.',
  'account-enrolment': 'When someone is enrolled on a programme.',
  'account-access-extended': 'When an admin extends someone’s access.',
  'account-admin-enrolment': 'When an admin enrols someone from Studio, or adds time to their access. New accounts get a set-password button.',
  'lead-daily-summary': 'Every morning, to the team (internal).',
}

function groupOf(track: string, id: string): EditorGroup {
  if (['T', 'D', 'internal'].includes(track) || !LIFECYCLE_TEMPLATES[id]) return 'account'
  if (['I', 'R', 'C', 'G', 'L'].includes(track)) return 'learning'
  return 'applications'
}

export function editableEntries(): EditableEntry[] {
  const templates = Object.values(emailTemplates).map((template) => {
    const full = emailTemplates[template.id] as unknown as { copy: Record<string, CopySlot>; varDocs: Record<string, string>; variantCount: number }
    return {
      id: template.id,
      name: NAMES[template.id] ?? template.id,
      group: groupOf(template.track, template.id),
      kind: template.kind,
      track: template.track,
      stepId: template.stepId,
      whenSent: ACCOUNT_WHEN[template.id] ?? whenSent(template.id),
      copy: full.copy,
      varDocs: full.varDocs,
      variantCount: full.variantCount,
    } satisfies EditableEntry
  })
  return [
    ...templates,
    { id: SHARED_ID, name: 'Shared phrases', group: 'shared', kind: 'shared', track: '', stepId: '', whenSent: 'Used by many lifecycle emails: change once, it changes everywhere.', copy: SHARED_COPY, varDocs: LIFECYCLE_VAR_DOCS, variantCount: 1 },
    { id: SETTINGS_ID, name: 'Email settings', group: 'settings', kind: 'settings', track: '', stepId: '', whenSent: 'Sender name, sign-off and company line on every email.', copy: SETTINGS_COPY, varDocs: {}, variantCount: 1 },
  ]
}

export function entryById(id: string): EditableEntry | undefined {
  return editableEntries().find((entry) => entry.id === id)
}

export interface RenderCase {
  templateId: string
  scenario: Scenario | null
  ab: number
  rendered: RenderedEmail
}

interface Renderable {
  id: string
  variantCount: number
  render(data: unknown, links?: typeof SAMPLE_FOOTER_LINKS, variant?: number): RenderedEmail
  renderSample(): RenderedEmail
}

/** Renders one template for every scenario and A/B variant (others: their sample), with no substitution. */
export function renderCases(templateId: string): RenderCase[] {
  const lifecycle = LIFECYCLE_TEMPLATES[templateId]
  if (lifecycle) {
    return SCENARIOS.flatMap((scenario) =>
      Array.from({ length: lifecycle.variantCount }, (_, ab) => ({ templateId, scenario, ab, rendered: lifecycle.render({ ...SAMPLE, ...scenario.data }, SAMPLE_FOOTER_LINKS, ab) })),
    )
  }
  const template = emailTemplates[templateId] as unknown as Renderable | undefined
  if (!template) return []
  return Array.from({ length: template.variantCount }, (_, ab) => ({ templateId, scenario: null, ab, rendered: ab === 0 ? template.renderSample() : template.render((template as unknown as { sample: unknown }).sample, SAMPLE_FOOTER_LINKS, ab) }))
}

/** The templates an override of this entry affects. */
export function affectedTemplates(entryId: string): string[] {
  if (entryId === SHARED_ID) return Object.keys(LIFECYCLE_TEMPLATES)
  if (entryId === SETTINGS_ID) return Object.keys(emailTemplates)
  return emailTemplates[entryId] ? [entryId] : []
}

/** Renders everything an override affects, with the override in place of the published one. */
export function renderWithOverride(entryId: string, override: EmailOverride | null): RenderCase[] {
  return withOverrides({ [entryId]: override }, () => affectedTemplates(entryId).flatMap(renderCases))
}

/** One preview render: a template with a scenario and A/B variant, with these overrides substituted. */
export function renderPreview(templateId: string, substitute: Record<string, EmailOverride | null>, scenarioId?: string, ab = 0): RenderedEmail | null {
  const lifecycle = LIFECYCLE_TEMPLATES[templateId]
  const template = emailTemplates[templateId] as unknown as Renderable | undefined
  if (!template) return null
  return withOverrides(substitute, () => {
    if (lifecycle) {
      const scenario = SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0]!
      return lifecycle.render({ ...SAMPLE, ...scenario.data }, lifecycle.kind === 'transactional' ? {} : SAMPLE_FOOTER_LINKS, Math.min(Math.max(0, ab), lifecycle.variantCount - 1))
    }
    return ab > 0 ? template.render((template as unknown as { sample: unknown }).sample, SAMPLE_FOOTER_LINKS, Math.min(ab, template.variantCount - 1)) : template.renderSample()
  })
}
