import { renderHtml, renderText, withUtm, type EmailBody, type EmailKind, type FooterLinks } from './layout.js'

/**
 * One email template. Each file in src/emails/ exports one, with `subject`, `preheader`,
 * `html`, `text` and `sample` data (used by the admin preview and `npm run emails:preview`).
 * Subject and preheader are written as a pair: the preheader finishes the thought.
 */
export interface RenderedEmail {
  subject: string
  preheader: string
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
  render(data: T, links?: FooterLinks): RenderedEmail
  /** Renders the sample data, with placeholder footer links. */
  renderSample(): RenderedEmail
}

export interface EmailDefinition<T> {
  id: string
  kind: EmailKind
  track: string
  stepId: string
  sample: T
  subject: (data: T) => string
  preheader: (data: T) => string
  body: (data: T) => EmailBody
}

/** "{{firstName}}" with its fallback. */
export const firstNameOf = (name: string | null | undefined) => (name && name.trim() ? name.trim() : 'there')

const SAMPLE_LINKS: FooterLinks = {
  preferencesUrl: 'https://skillsair.com/email-preferences?token=sample',
  unsubscribeUrl: 'https://skillsair.com/email-preferences?token=sample',
}

export function defineEmail<T>(definition: EmailDefinition<T>): EmailTemplate<T> {
  const layout = (data: T, links: FooterLinks = {}) => {
    const body = definition.body(data)
    const button = body.button
      ? { ...body.button, url: withUtm(body.button.url, definition.kind, definition.track, definition.stepId) }
      : undefined
    return {
      kind: definition.kind,
      subject: definition.subject(data),
      preheader: definition.preheader(data),
      ...body,
      button,
      ...(definition.kind === 'transactional' ? {} : links),
    }
  }
  const template: EmailTemplate<T> = {
    id: definition.id,
    kind: definition.kind,
    track: definition.track,
    stepId: definition.stepId,
    sample: definition.sample,
    subject: definition.subject,
    preheader: definition.preheader,
    html: (data, links) => renderHtml(layout(data, links)),
    text: (data, links) => renderText(layout(data, links)),
    render: (data, links) => {
      const input = layout(data, links)
      return { subject: input.subject, preheader: input.preheader, html: renderHtml(input), text: renderText(input) }
    },
    renderSample: () => template.render(definition.sample, SAMPLE_LINKS),
  }
  return template
}
