/**
 * Copy slots: every piece of wording an admin can edit in Studio (Emails). A slot's text is the
 * published override if there is one, else the code default; then {{name}} placeholders are
 * filled in. Pure and synchronous: rendering never waits for the database.
 *
 * Safety: the interpolator knows only {{name}} (no expressions). Output still goes through the
 * layout's escaping, so an override can never inject HTML; **bold** keeps working.
 */
export type SlotKind = 'text' | 'subject' | 'preheader' | 'button' | 'ps' | 'list'

export interface CopySlot {
  /** What the editor shows, e.g. "Opening line". */
  label: string
  /** The current wording, with {{placeholders}}. */
  default: string
  /** A list slot holds one item per line. */
  kind?: SlotKind
  /** Placeholders that must stay (e.g. ['amount'] on receipts). */
  required?: string[]
  /** Defaults: subject 90, preheader 140, button 40. */
  maxLength?: number
  /** Optional note shown under the field. */
  help?: string
  /** Placeholders only this slot gets (passed in by the template), with a description each. */
  vars?: Record<string, string>
}

/** The live (or draft) wording for one template, `_shared` or `_settings`. */
export interface EmailOverride {
  subject?: string
  preheader?: string
  variants?: Array<{ subject?: string; preheader?: string }>
  slots?: Record<string, string>
}

export type Vars = Record<string, string | number | null | undefined>

export const DEFAULT_MAX_LENGTH: Partial<Record<SlotKind, number>> = { subject: 90, preheader: 140, button: 40 }

export const maxLengthOf = (slot: CopySlot): number | undefined => slot.maxLength ?? DEFAULT_MAX_LENGTH[slot.kind ?? 'text']

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g

/** Placeholder names used in a text, in order of first appearance. */
export function placeholdersIn(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(PLACEHOLDER)) if (!names.includes(match[1]!)) names.push(match[1]!)
  return names
}

/**
 * Replaces {{name}} with vars[name] in one pass (a value is never interpolated again). Unknown
 * names render as an empty string and are reported through onUnknown.
 */
export function interpolate(text: string, vars: Vars, onUnknown?: (name: string) => void): string {
  return text.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined
    if (value === undefined || value === null) {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) onUnknown?.(name)
      return ''
    }
    return String(value)
  })
}

/**
 * Override keys: the main subject and preheader live at the top of the override, A/B variants in
 * `variants`, everything else in `slots`. In a template's `copy` map they're the slot keys
 * `subject`, `preheader`, `variant1Subject`, `variant1Preheader`, … .
 */
const VARIANT_KEY = /^variant(\d+)(Subject|Preheader)$/

export function overrideText(override: EmailOverride | null | undefined, key: string): string | undefined {
  if (!override || typeof override !== 'object') return undefined
  if (key === 'subject') return override.subject
  if (key === 'preheader') return override.preheader
  const variant = VARIANT_KEY.exec(key)
  if (variant) {
    const item = Array.isArray(override.variants) ? override.variants[Number(variant[1]) - 1] : undefined
    return variant[2] === 'Subject' ? item?.subject : item?.preheader
  }
  return override.slots && typeof override.slots === 'object' ? override.slots[key] : undefined
}

/** Every field an override sets, as slot key → text (the inverse of fromFields). */
export function overrideFields(override: EmailOverride | null | undefined): Record<string, string> {
  const fields: Record<string, string> = {}
  if (!override || typeof override !== 'object') return fields
  if (typeof override.subject === 'string') fields.subject = override.subject
  if (typeof override.preheader === 'string') fields.preheader = override.preheader
  if (Array.isArray(override.variants)) override.variants.forEach((item, index) => {
    if (typeof item?.subject === 'string') fields[`variant${index + 1}Subject`] = item.subject
    if (typeof item?.preheader === 'string') fields[`variant${index + 1}Preheader`] = item.preheader
  })
  const slots = override.slots && typeof override.slots === 'object' ? override.slots : {}
  for (const [key, value] of Object.entries(slots)) if (typeof value === 'string') fields[key] = value
  return fields
}

/** Builds an override from slot key → text. Empty (whitespace-only) fields mean "use the default" and are left out. */
export function fromFields(fields: Record<string, string>): EmailOverride | null {
  const override: EmailOverride = {}
  for (const [key, raw] of Object.entries(fields)) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const value = raw.replace(/\r\n?/g, '\n')
    if (key === 'subject') override.subject = value
    else if (key === 'preheader') override.preheader = value
    else {
      const variant = VARIANT_KEY.exec(key)
      if (variant) {
        const index = Number(variant[1]) - 1
        override.variants ??= []
        while (override.variants.length <= index) override.variants.push({})
        override.variants[index]![variant[2] === 'Subject' ? 'subject' : 'preheader'] = value
      } else {
        override.slots ??= {}
        override.slots[key] = value
      }
    }
  }
  return Object.keys(override).length ? override : null
}

/**
 * Checks one field's text on its own (no rendering): returns the problems that make it unusable.
 * Used at render time (an invalid published field falls back to the default) and by the validator.
 */
export function fieldProblems(slot: CopySlot, text: string, allowed: Set<string>): string[] {
  const problems: string[] = []
  const kind = slot.kind ?? 'text'
  if (!text.trim()) problems.push('Leave the field empty to use the original wording; it can’t be only spaces.')
  const max = maxLengthOf(slot)
  if (max !== undefined && text.length > max) problems.push(`Too long: ${text.length} characters (the limit is ${max}).`)
  if (/<\s*\/?\s*[a-z!][^>]*>/i.test(text)) problems.push('HTML tags aren’t allowed. Use **bold** for emphasis.')
  if (/javascript\s*:/i.test(text)) problems.push('“javascript:” isn’t allowed.')
  if (kind !== 'list' && /\n/.test(text)) problems.push('This field is one line (only lists take one item per line).')
  const lines = kind === 'list' ? text.split('\n') : [text]
  for (const line of lines) if (((line.match(/\*\*/g) ?? []).length) % 2 !== 0) problems.push('Unbalanced **: every **bold** needs an opening and a closing **.')
  const used = placeholdersIn(text)
  for (const name of used) if (!allowed.has(name)) problems.push(`Unknown placeholder {{${name}}}.`)
  for (const name of slot.required ?? []) if (!used.includes(name)) problems.push(`{{${name}}} must stay in this field.`)
  if (/\{\{|\}\}/.test(text.replace(PLACEHOLDER, ''))) problems.push('A placeholder isn’t closed: write it as {{name}}.')
  return [...new Set(problems)]
}
