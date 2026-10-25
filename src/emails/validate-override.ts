import { fieldProblems, overrideFields, placeholdersIn, type EmailOverride } from './copy.js'
import { entryById, renderWithOverride } from './catalog.js'
import { honestyProblems } from './honesty-rules.js'
import { SETTINGS_ID } from './override-store.js'
import { SPELLING } from '../lib/content-lint.js'

/**
 * Checks an override before it's saved, previewed or published (brief section 5). Errors block
 * publishing; warnings don't. Every issue names the field it's about (a slot key), or `_render`
 * for a problem found only in the rendered emails, or `_` for the override as a whole.
 */
export interface Issue {
  field: string
  message: string
}

export interface ValidationResult {
  errors: Issue[]
  warnings: Issue[]
}

const VARIANT_KEY = /^variant(\d+)(Subject|Preheader)$/

function settingsIssues(fields: Record<string, string>, errors: Issue[]): void {
  const company = fields.companyLine
  if (company !== undefined && !company.includes('RC 9272398')) errors.push({ field: 'companyLine', message: 'The company line is required legal text and must keep “RC 9272398”.' })
  const help = fields.signOffHelp
  if (help !== undefined && !/\+?\d[\d\s]{7,}\d/.test(help) && !/reply to this email/i.test(help)) {
    errors.push({ field: 'signOffHelp', message: 'Keep a phone number or “Reply to this email” so people know how to reach you.' })
  }
  const sender = fields.senderName
  if (sender !== undefined && /[<>"@\\]/.test(sender)) errors.push({ field: 'senderName', message: 'The sender name can’t contain < > " @ or \\.' })
  for (const [key, value] of Object.entries(fields)) if (placeholdersIn(value).length) errors.push({ field: key, message: 'Settings don’t take placeholders.' })
}

function spelling(field: string, text: string, warnings: Issue[]): void {
  const flagged = new Set<string>()
  for (const word of text.replace(/\{\{[^}]*\}\}/g, ' ').match(/[A-Za-z]+/g) ?? []) {
    const uk = SPELLING[word.toLowerCase()]
    if (uk && !flagged.has(word.toLowerCase())) {
      flagged.add(word.toLowerCase())
      warnings.push({ field, message: `British spelling: “${word}” → “${uk}”.` })
    }
  }
}

/** Points a render problem at the override field whose text contains the offending words, if one does. */
function fieldFor(needle: string | undefined, fields: Record<string, string>): string {
  if (!needle) return '_render'
  const lower = needle.toLowerCase()
  return Object.entries(fields).find(([, text]) => text.toLowerCase().includes(lower))?.[0] ?? '_render'
}

export function validateOverride(templateId: string, override: EmailOverride | null | undefined, options: { render?: boolean } = {}): ValidationResult {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  const entry = entryById(templateId)
  if (!entry) return { errors: [{ field: '_', message: `No email called “${templateId}”.` }], warnings }
  if (!override) return { errors, warnings }

  const fields = overrideFields(override)
  for (const [key, text] of Object.entries(fields)) {
    const slot = entry.copy[key]
    if (!slot) {
      errors.push({ field: key, message: VARIANT_KEY.test(key) ? 'This email doesn’t have that many A/B subject lines.' : 'This field no longer exists in the email.' })
      continue
    }
    const allowed = new Set([...Object.keys(entry.varDocs), ...Object.keys(slot.vars ?? {})])
    for (const message of fieldProblems(slot, text, allowed)) errors.push({ field: key, message })
    if (!text.trim()) continue
    spelling(key, text, warnings)
    const kind = slot.kind ?? 'text'
    if (kind !== 'list' && (text.match(/\*\*(.+?)\*\*/g) ?? []).length > 1) warnings.push({ field: key, message: 'More than one **bold** in a paragraph: keep it to one.' })
  }
  if ((override.variants?.length ?? 0) > entry.variantCount - 1) errors.push({ field: 'variants', message: `This email has ${entry.variantCount - 1} A/B alternative${entry.variantCount === 2 ? '' : 's'}, not ${override.variants?.length}.` })
  if (templateId === SETTINGS_ID) settingsIssues(fields, errors)

  if (options.render !== false) {
    const seen = new Set<string>()
    for (const item of renderWithOverride(templateId, override)) {
      const where = `${item.templateId}${item.scenario ? `, ${item.scenario.label}` : ''}${item.ab ? `, A/B version ${String.fromCharCode(97 + item.ab)}` : ''}`
      for (const problem of honestyProblems(item.templateId, item.rendered)) {
        const field = fieldFor(problem.needle, fields)
        const key = `${field}:${problem.rule}`
        if (seen.has(key)) continue
        seen.add(key)
        errors.push({ field, message: `${problem.message} (${where})` })
      }
      const subjectWarned = seen.has('subject-length') || seen.has(`subject-length:${item.templateId}`)
      if (item.rendered.subject.length > 60 && !subjectWarned && (fields.subject || Object.keys(fields).some((key) => /^subject|Subject$/.test(key)))) {
        seen.add('subject-length')
        warnings.push({ field: 'subject', message: `The subject is ${item.rendered.subject.length} characters: phones cut it off after about 60.` })
      }
      if (item.rendered.preheader && item.rendered.subject && !seen.has('preheader-repeat') && item.rendered.preheader.toLowerCase().startsWith(item.rendered.subject.toLowerCase()) && item.rendered.preheader !== item.rendered.subject) {
        seen.add('preheader-repeat')
        warnings.push({ field: 'preheader', message: 'The preview text repeats the subject: use it to finish the thought instead.' })
      }
    }
  }
  return { errors, warnings }
}

export const hasErrors = (result: ValidationResult) => result.errors.length > 0
