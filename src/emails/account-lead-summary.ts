import { defineEmail, lines } from './define.js'
import { accountInline, escapeAccountHtml, wrapAccountHtml } from './account-layout.js'

export interface LeadSummaryInput {
  dateLabel: string
  newLeads: number
  bySchool: Array<{ label: string; count: number }>
  bySource: Array<{ label: string; count: number }>
  offersViewed: number
  accountsCreated: number
  payments: number
  queueSize: number
  topLeads: Array<{ firstName: string; programme: string; score: number; needsHuman: boolean; adminUrl: string }>
}

/** Internal daily summary for the team. Contains first names only, no contact details. Rows are data, so they stay in code. */
export const leadDailySummary = defineEmail({
  id: 'lead-daily-summary',
  kind: 'transactional',
  track: 'internal',
  stepId: 'lead_daily_summary',
  sample: {
    dateLabel: '24 October 2026',
    newLeads: 14,
    bySchool: [{ label: 'School of Data', count: 9 }],
    bySource: [{ label: 'instagram', count: 10 }],
    offersViewed: 11,
    accountsCreated: 6,
    payments: 3,
    queueSize: 2,
    topLeads: [{ firstName: 'Tobi', programme: 'Data Analysis', score: 82, needsHuman: true, adminUrl: 'https://studio.skillsair.com/admin/collections/leads/1' }],
  } as LeadSummaryInput,
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: 'SkillsAir leads: {{newLeads}} new, {{queueSize}} waiting for Imisi ({{dateLabel}})' },
    heading: { label: 'Heading', default: '**Last 24 hours**' },
    statsList: {
      label: 'Numbers (one per line)',
      kind: 'list',
      default: ['New leads: {{newLeads}}', 'Offers viewed: {{offersViewed}}', 'Accounts created: {{accountsCreated}}', 'Payments: {{payments}}', "Imisi's queue right now: {{queueSize}}"].join('\n'),
    },
    bySchool: { label: 'By school heading', default: '**New leads by school**' },
    bySource: { label: 'By source heading', default: '**New leads by source**' },
    top: { label: 'Top leads heading', default: '**Top 10 open leads by score**' },
    none: { label: 'Empty list', default: 'None' },
    needsImisi: { label: 'Marker for leads that need Imisi', default: 'needs Imisi' },
    textHeading: { label: 'Plain text: heading', default: 'Last 24 hours ({{dateLabel}})' },
    textStatsList: {
      label: 'Plain text: numbers (one per line)',
      kind: 'list',
      default: ['New leads: {{newLeads}}', 'Offers viewed: {{offersViewed}}', 'Accounts created: {{accountsCreated}}', 'Payments: {{payments}}', "Imisi's queue: {{queueSize}}"].join('\n'),
    },
    textBySchool: { label: 'Plain text: by school', default: 'By school:' },
    textBySource: { label: 'Plain text: by source', default: 'By source:' },
    textTop: { label: 'Plain text: top leads', default: 'Top leads:' },
  },
  vars: (input) => ({
    dateLabel: input.dateLabel,
    newLeads: input.newLeads,
    offersViewed: input.offersViewed,
    accountsCreated: input.accountsCreated,
    payments: input.payments,
    queueSize: input.queueSize,
  }),
  varDocs: {
    dateLabel: 'The day the summary covers',
    newLeads: 'New leads in the last 24 hours',
    offersViewed: 'Offers viewed',
    accountsCreated: 'Accounts created',
    payments: 'Payments',
    queueSize: 'Leads waiting in Imisi’s queue',
  },
  subject: (_input, c) => c.subject(),
  preheader: () => '',
  account: (input, c) => {
    const none = `<li>${accountInline(c.none())}</li>`
    const list = (rows: Array<{ label: string; count: number }>) => (rows.length ? rows.map((row) => `<li>${escapeAccountHtml(row.label)}: ${row.count}</li>`).join('') : none)
    const top = input.topLeads.length
      ? input.topLeads
          .map((lead) => `<li><a href="${lead.adminUrl}">${escapeAccountHtml(lead.firstName)}</a>, ${escapeAccountHtml(lead.programme)} (score ${lead.score}${lead.needsHuman ? `, ${escapeAccountHtml(c.needsImisi())}` : ''})</li>`)
          .join('')
      : none
    const stats = lines(c.statsList()).map((item) => `<li>${accountInline(item)}</li>`).join('\n      ')
    const html = wrapAccountHtml(
      `
    <p>${accountInline(c.heading())}</p>
    <ul>
      ${stats}
    </ul>
    <p>${accountInline(c.bySchool())}</p><ul>${list(input.bySchool)}</ul>
    <p>${accountInline(c.bySource())}</p><ul>${list(input.bySource)}</ul>
    <p>${accountInline(c.top())}</p><ol>${top}</ol>
  `,
      'Internal SkillsAir lead summary.',
    )
    const text = [
      c.textHeading(),
      ...lines(c.textStatsList()),
      '',
      c.textBySchool(),
      ...input.bySchool.map((row) => `- ${row.label}: ${row.count}`),
      '',
      c.textBySource(),
      ...input.bySource.map((row) => `- ${row.label}: ${row.count}`),
      '',
      c.textTop(),
      ...input.topLeads.map((lead) => `- ${lead.firstName}, ${lead.programme} (score ${lead.score}) ${lead.adminUrl}`),
    ].join('\n')
    return { html, text }
  },
})
