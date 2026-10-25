import type { RenderedEmail } from './define.js'
import { BANNED_CLAIMS, LEVEL_WORDS } from '../lib/content-lint.js'

/**
 * Honest-copy rules for every email (brief section 16), shared by honesty.test.ts and the Studio
 * override validator, so the two can never drift apart. Each check returns the problems in one
 * rendered email; an empty list means it passes.
 */
export { HONESTY_VARIANTS } from './scenarios.js'

/** Receipts and dunning emails state an amount charged, so "₦2,000" may stand alone there. */
export const EXEMPT = new Set(['T1', 'T2', 'T3', 'T4', 'T7', 'T9', 'T10', 'T11', 'T12', 'D1', 'D2', 'D3', 'B1'])
export const BANNED = ['one time', 'one-time', '₦2,000 once', '3 months to finish', 'up to 3 months', 'most learners', 'limited seats', 'guaranteed']
/** Owner, 2026-10-18: the certificate fee is shown only once a learner has finished and goes to claim it. */
export const AFTER_FINISHING = new Set(['T8', 'T9', 'C1', 'C2', 'C2L', 'C3', 'C4', 'C5'])
const LIFECYCLE_ID = /^(A\d|W\d|P\d|B\d|T\d+|D\d|I\d|R\d|C\d|C2L|G\d|X\d)$/

export interface HonestyProblem {
  rule: string
  message: string
  /** The text that broke the rule, to point at the field that contains it. */
  needle?: string
}

const BAD_TOKEN = /undefined|null|NaN|\[object|\{\{|\}\}/
const BARE_MONTHLY = /₦2,000(?!(\s|-)a(\s|-)month|\/month)/g

export function copyOf(rendered: RenderedEmail): string {
  return `${rendered.subject}\n${rendered.preheader}\n${rendered.text}`
}

/** No "undefined", "null", "NaN", "[object" or a leftover placeholder anywhere in the output. */
export function badTokens(rendered: RenderedEmail): HonestyProblem[] {
  const all = `${copyOf(rendered)}\n${rendered.html}`
  const match = BAD_TOKEN.exec(`${rendered.subject} ${rendered.preheader} ${rendered.text}`) ?? (/\{\{|\}\}/.exec(all))
  return match ? [{ rule: 'bad_token', message: `The email shows “${match[0]}”: a value is missing or a placeholder isn’t written as {{name}}.`, needle: match[0] }] : []
}

/** Every ₦2,000 says "a month" (offers and marketing). */
export function bareMonthly(templateId: string, rendered: RenderedEmail): HonestyProblem[] {
  if (EXEMPT.has(templateId) || !LIFECYCLE_ID.test(templateId)) return []
  const copy = copyOf(rendered)
  return copy.match(BARE_MONTHLY) ? [{ rule: 'monthly', message: '₦2,000 must always say “a month” (e.g. “₦2,000 a month”).', needle: '₦2,000' }] : []
}

export function bannedPhrases(text: string): HonestyProblem[] {
  const lower = text.toLowerCase()
  return BANNED.filter((phrase) => lower.includes(phrase)).map((phrase) => ({ rule: 'banned', message: `Banned phrase “${phrase}”.`, needle: phrase }))
}

/** No job or income guarantees, and no level words (programmes have no levels). */
export function claims(text: string): HonestyProblem[] {
  const problems: HonestyProblem[] = []
  for (const [pattern, label] of BANNED_CLAIMS) {
    const match = pattern.exec(text)
    if (match) problems.push({ rule: 'claim', message: `No job or income promises: ${label}.`, needle: match[0] })
  }
  const level = LEVEL_WORDS.exec(text)
  if (level) problems.push({ rule: 'level', message: `Level word “${level[0]}”: programmes have no levels.`, needle: level[0] })
  return problems
}

export function certificateFeeTooEarly(templateId: string, rendered: RenderedEmail): HonestyProblem[] {
  if (AFTER_FINISHING.has(templateId) || !LIFECYCLE_ID.test(templateId)) return []
  return copyOf(rendered).includes('₦10,000') ? [{ rule: 'certificate_fee', message: 'The certificate fee only appears after someone has finished.', needle: '₦10,000' }] : []
}

/** Owner: only T8 offers the locked rate to graduates (within 3 days of finishing). */
export function graduatesLockedRate(templateId: string, rendered: RenderedEmail): HonestyProblem[] {
  return /^G\d$/.test(templateId) && rendered.text.toLowerCase().includes('locked') ? [{ rule: 'graduates_locked', message: 'Track G never promises the locked rate.', needle: 'locked' }] : []
}

export function subjectIsPreheader(rendered: RenderedEmail): HonestyProblem[] {
  return rendered.preheader && rendered.subject === rendered.preheader ? [{ rule: 'subject_preheader', message: 'The preview text repeats the subject.' }] : []
}

/** Every rule for one rendered email. */
export function honestyProblems(templateId: string, rendered: RenderedEmail): HonestyProblem[] {
  const copy = copyOf(rendered)
  return [
    ...badTokens(rendered),
    ...bareMonthly(templateId, rendered),
    ...bannedPhrases(copy),
    ...claims(copy),
    ...certificateFeeTooEarly(templateId, rendered),
    ...graduatesLockedRate(templateId, rendered),
    ...subjectIsPreheader(rendered),
  ]
}
