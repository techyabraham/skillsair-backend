import { renderHtml, renderText, withUtm, type EmailBody, type EmailKind, type FooterLinks } from './layout.js'
import { fieldProblems, interpolate, overrideFields, overrideText, type CopySlot, type EmailOverride, type Vars } from './copy.js'
import { getOverride, warnOnce } from './override-store.js'

/**
 * One email template. Each file in src/emails/ exports one, with `subject`, `preheader`,
 * `html`, `text` and `sample` data (used by the admin preview and `npm run emails:preview`).
 * Subject and preheader are written as a pair: the preheader finishes the thought.
 *
 * Wording an admin can edit in Studio lives in `copy` (slots with their default text); the
 * template reads it through the resolver `c`, the last argument of subject, preheader, variants
 * and body: `c.intro()` is the published override if there is one, else the default, with
 * {{placeholders}} filled from the vars passed in, then from the template's standard vars.
 */
export interface RenderedEmail {
  subject: string
  preheader: string
  html: string
  text: string
}

export type CopyResolver<K extends string = string> = Record<K, (vars?: Vars) => string>

/** An account email in the old SkillsAir wrapper (src/emails/account-layout.ts). */
export interface AccountBody {
  html: string
  text: string
}

export interface EmailTemplate<T> {
  id: string
  kind: EmailKind
  /** Lifecycle track and step, for UTM tags and the message log (e.g. 'T', 'T1'). */
  track: string
  stepId: string
  sample: T
  subject(data: T): string
  preheader(data: T): string
  html(data: T, links?: FooterLinks): string
  text(data: T, links?: FooterLinks): string
  /** variant 0 is the main subject line; 1.. are the A/B alternatives. */
  render(data: T, links?: FooterLinks, variant?: number): RenderedEmail
  /** How many subject lines this template has (1 = no A/B test). */
  variantCount: number
  /** Renders the sample data, with placeholder footer links. */
  renderSample(): RenderedEmail
  /** Editable wording (empty for a template without slots). */
  copy: Record<string, CopySlot>
  /** Placeholders every slot can use, with a description each. */
  varDocs: Record<string, string>
}

type Resolve<T, K extends string, R> = (data: T, c: CopyResolver<K>) => R

export interface EmailDefinition<T, K extends string = string> {
  id: string
  kind: EmailKind
  track: string
  stepId: string
  sample: T
  /** Editable wording: slot key → label and default text. Keys never change once committed. */
  copy?: Record<K, CopySlot>
  /** Standard placeholder values for every slot. */
  vars?: (data: T) => Vars
  /** Descriptions of the standard placeholders, for the editor and validation. */
  varDocs?: Record<string, string>
  subject: Resolve<T, K, string>
  preheader: Resolve<T, K, string>
  /** The letter layout's blocks. Account emails use `account` instead. */
  body?: Resolve<T, K, EmailBody>
  /** layout 'account': the old account-email wrapper (welcome, enrolment, access extended, lead summary). */
  account?: Resolve<T, K, AccountBody>
  /** A/B alternatives to subject + preheader (brief section 12). Body stays the same. */
  variants?: Array<{ subject: Resolve<T, K, string>; preheader: Resolve<T, K, string> }>
}

/** "{{firstName}}" with its fallback. */
export const firstNameOf = (name: string | null | undefined) => (name && name.trim() ? name.trim() : 'there')

/** A list slot's text as items (one per line, blank lines dropped). */
export const lines = (text: string): string[] => text.split('\n').map((line) => line.trim()).filter(Boolean)

const SAMPLE_LINKS: FooterLinks = {
  preferencesUrl: 'https://skillsair.com/email-preferences?token=sample',
  unsubscribeUrl: 'https://skillsair.com/email-preferences?token=sample',
}

/** Problems per override object and field, so a published field is checked once, not on every render. */
const checked = new WeakMap<EmailOverride, Map<string, boolean>>()

/**
 * Builds the resolver for one template id (or `_shared`). A published field that isn't usable
 * (unknown placeholder, too long, a slot that no longer exists...) falls back to the default,
 * and is logged once per store version. Never throws.
 */
export function makeResolver(templateId: string, copy: Record<string, CopySlot>, standard: Vars, varDocs: Record<string, string>): CopyResolver {
  const override = getOverride(templateId)
  if (override && !checked.has(override)) {
    checked.set(override, new Map())
    for (const key of Object.keys(overrideFields(override))) {
      if (!copy[key]) warnOnce(`${templateId}.${key}`, { templateId, key, problem: 'unknown_slot' })
    }
  }
  const usable = (key: string, slot: CopySlot): string | undefined => {
    const text = overrideText(override, key)
    if (typeof text !== 'string' || !text.trim() || !override) return undefined
    const memo = checked.get(override)!
    let ok = memo.get(key)
    if (ok === undefined) {
      const problems = fieldProblems(slot, text, new Set([...Object.keys(varDocs), ...Object.keys(slot.vars ?? {})]))
      ok = problems.length === 0
      memo.set(key, ok)
      if (!ok) warnOnce(`${templateId}.${key}`, { templateId, key, problems })
    }
    return ok ? text : undefined
  }
  const resolver: CopyResolver = {}
  for (const [key, slot] of Object.entries(copy)) {
    resolver[key] = (vars: Vars = {}) =>
      interpolate(usable(key, slot) ?? slot.default, { ...standard, ...vars }, (name) => warnOnce(`${templateId}.${key}.{{${name}}}`, { templateId, key, problem: 'unknown_placeholder', name }))
  }
  return resolver
}

export function defineEmail<T, K extends string = string>(definition: EmailDefinition<T, K>): EmailTemplate<T> {
  const copy = (definition.copy ?? {}) as Record<string, CopySlot>
  const varDocs = definition.varDocs ?? {}
  const resolverFor = (data: T) => makeResolver(definition.id, copy, definition.vars ? definition.vars(data) : {}, varDocs) as CopyResolver<K>

  const layout = (data: T, links: FooterLinks = {}, variant = 0) => {
    const c = resolverFor(data)
    const alternative = variant > 0 ? definition.variants?.[variant - 1] : undefined
    const body = definition.body!(data, c)
    const button = body.button
      ? { ...body.button, url: withUtm(body.button.url, definition.kind, definition.track, definition.stepId) }
      : undefined
    return {
      kind: definition.kind,
      subject: (alternative?.subject ?? definition.subject)(data, c),
      preheader: (alternative?.preheader ?? definition.preheader)(data, c),
      ...body,
      button,
      ...(definition.kind === 'transactional' ? {} : links),
    }
  }

  const render = (data: T, links?: FooterLinks, variant = 0): RenderedEmail => {
    if (definition.account) {
      const c = resolverFor(data)
      const alternative = variant > 0 ? definition.variants?.[variant - 1] : undefined
      const body = definition.account(data, c)
      return { subject: (alternative?.subject ?? definition.subject)(data, c), preheader: (alternative?.preheader ?? definition.preheader)(data, c), html: body.html, text: body.text }
    }
    const input = layout(data, links, variant)
    return { subject: input.subject, preheader: input.preheader, html: renderHtml(input), text: renderText(input) }
  }

  const template: EmailTemplate<T> = {
    id: definition.id,
    kind: definition.kind,
    track: definition.track,
    stepId: definition.stepId,
    sample: definition.sample,
    subject: (data) => definition.subject(data, resolverFor(data)),
    preheader: (data) => definition.preheader(data, resolverFor(data)),
    html: (data, links) => (definition.account ? render(data, links).html : renderHtml(layout(data, links))),
    text: (data, links) => (definition.account ? render(data, links).text : renderText(layout(data, links))),
    variantCount: 1 + (definition.variants?.length ?? 0),
    render,
    renderSample: () => template.render(definition.sample, SAMPLE_LINKS),
    copy,
    varDocs,
  }
  return template
}
