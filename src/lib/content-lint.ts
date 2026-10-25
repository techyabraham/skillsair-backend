/**
 * Programme copy rules (Learning Quality build, section 3): lengths, keyword placement, banned words,
 * no levels, no prices, objective and FAQ counts, British spelling. Pure: used by content:import,
 * content:lint, the Studio checklist and the save hook on programmes.
 */

export interface ProgrammeCopy {
  seoTitle?: string | null
  metaDescription?: string | null
  shortDescription?: string | null
  /** Plain text of the description (Markdown or rich text flattened), with headings on their own lines prefixed "#". */
  description?: string | null
  objectives?: string[]
  requirements?: string[]
  whoItsFor?: string[]
  toolsCovered?: string[]
  careerPaths?: string[]
  faq?: Array<{ question: string; answer: string }>
  primaryKeyword?: string | null
  secondaryKeywords?: string[]
}

export interface LintIssue {
  level: 'error' | 'warning'
  field: string
  message: string
}

export const LEVEL_WORDS = /\b(beginners?|intermediate|advanced|expert|experts|expert-level)\b/i
export const BANNED_CLAIMS: Array<[RegExp, string]> = [
  // "no job guarantees" is the honest disclaimer; promising one is banned.
  [/(?<!\bno\s)(?<!\bnot\s)\bguarantee(d)?\s+(a\s+)?job\b|(?<!\bno\s)\bjob\s+guarantee/i, '"guaranteed job" (no job guarantees)'],
  [/\bbecome an expert\b/i, '"become an expert…"'],
  [/\b(100%|hundred percent)\s+(job|placement|success)/i, 'success or placement guarantees'],
  [/\bget rich\b|\bearn\s+millions?\b/i, 'income promises'],
]
const PRICE = /₦\s?\d|\bNGN\s?\d|\b\d[\d,]*\s?naira\b|\bnaira\b|\b\d+k\s+(a|per)\s+month\b/i
// American spellings to flag (British English): US form -> UK form.
export const SPELLING: Record<string, string> = {
  color: 'colour', colors: 'colours', colored: 'coloured', favorite: 'favourite', behavior: 'behaviour', behaviors: 'behaviours',
  center: 'centre', centers: 'centres', analyze: 'analyse', analyzes: 'analyses', analyzing: 'analysing', analyzed: 'analysed',
  optimize: 'optimise', optimizing: 'optimising', optimized: 'optimised', organize: 'organise', organizing: 'organising', organized: 'organised',
  organization: 'organisation', organizations: 'organisations', customize: 'customise', customized: 'customised', recognize: 'recognise',
  visualize: 'visualise', visualization: 'visualisation', visualizations: 'visualisations', prioritize: 'prioritise', summarize: 'summarise',
  license: 'licence (noun)', catalog: 'catalogue', dialog: 'dialogue (outside UI names)', enrollment: 'enrolment', enroll: 'enrol',
  fulfill: 'fulfil', modeling: 'modelling', labeled: 'labelled', traveling: 'travelling', canceled: 'cancelled', gray: 'grey', defense: 'defence', offense: 'offence',
}

const words = (text: string) => (text.match(/[A-Za-z0-9’'-]+/g) ?? []).length
const firstSentence = (text: string) => text.replace(/^#.*$/gm, '').trim().split(/(?<=[.!?])\s/)[0] ?? ''
const containsKeyword = (text: string, keyword: string) => text.toLowerCase().includes(keyword.toLowerCase())
const countKeyword = (text: string, keyword: string) => keyword ? text.toLowerCase().split(keyword.toLowerCase()).length - 1 : 0

function checkWords(field: string, text: string, issues: LintIssue[]): void {
  if (!text) return
  const level = LEVEL_WORDS.exec(text)
  if (level) issues.push({ level: 'error', field, message: `Level word "${level[0]}": programmes have no levels (say "start from zero").` })
  for (const [pattern, label] of BANNED_CLAIMS) if (pattern.test(text)) issues.push({ level: 'error', field, message: `Banned claim: ${label}.` })
  if (PRICE.test(text)) issues.push({ level: 'error', field, message: 'Prices never appear in programme copy (the offer page shows them).' })
  for (const word of text.match(/[A-Za-z]+/g) ?? []) {
    const uk = SPELLING[word.toLowerCase()]
    if (uk) issues.push({ level: 'warning', field, message: `British spelling: "${word}" → "${uk}".` })
  }
}

export function lintProgrammeCopy(copy: ProgrammeCopy): LintIssue[] {
  const issues: LintIssue[] = []
  const err = (field: string, message: string) => issues.push({ level: 'error', field, message })
  const warn = (field: string, message: string) => issues.push({ level: 'warning', field, message })
  const keyword = (copy.primaryKeyword ?? '').trim()

  const seoTitle = (copy.seoTitle ?? '').trim()
  if (!seoTitle) err('seoTitle', 'SEO title is missing.')
  else {
    if (seoTitle.length > 60) err('seoTitle', `SEO title is ${seoTitle.length} characters (max 60).`)
    if (!/·\s*SkillsAir$/.test(seoTitle)) warn('seoTitle', 'SEO title should end "· SkillsAir".')
    if (keyword && !seoTitle.toLowerCase().startsWith(keyword.toLowerCase().split(' ')[0] ?? '')) warn('seoTitle', 'Put the primary keyword first in the SEO title.')
    if (keyword && !containsKeyword(seoTitle, keyword)) err('seoTitle', 'SEO title must contain the primary keyword.')
  }

  const meta = (copy.metaDescription ?? '').trim()
  if (!meta) err('metaDescription', 'Meta description is missing.')
  else {
    if (meta.length < 140 || meta.length > 155) err('metaDescription', `Meta description is ${meta.length} characters (140–155).`)
    if (keyword && !containsKeyword(meta, keyword)) warn('metaDescription', 'Meta description should include the primary keyword.')
    if (!/12-week/i.test(meta)) warn('metaDescription', 'Meta description should mention the guided 12-week plan.')
  }

  const short = (copy.shortDescription ?? '').trim()
  if (!short) err('shortDescription', 'Short description is missing.')
  else if (short.length > 160) err('shortDescription', `Short description is ${short.length} characters (max 160).`)

  const description = (copy.description ?? '').trim()
  const count = words(description)
  if (!description) err('description', 'Description is missing.')
  else {
    if (count < 600 || count > 900) err('description', `Description is ${count} words (600–900).`)
    if (keyword) {
      if (!containsKeyword(firstSentence(description), keyword)) err('description', 'The primary keyword must be in the first sentence.')
      const headings = description.split('\n').filter((line) => /^#{1,6}\s/.test(line))
      if (!headings.some((heading) => containsKeyword(heading, keyword))) warn('description', 'Use the primary keyword in at least one heading.')
      const uses = countKeyword(description, keyword)
      const allowed = Math.max(3, Math.ceil((count / 600) * 3))
      if (uses > allowed) err('description', `Primary keyword used ${uses} times (keyword stuffing; at most ${allowed} here).`)
    }
  }

  const objectives = copy.objectives ?? []
  if (objectives.length < 6 || objectives.length > 8) err('objectives', `${objectives.length} objectives (6–8).`)
  objectives.forEach((objective, index) => {
    if (objective.length > 120) err('objectives', `Objective ${index + 1} is ${objective.length} characters (max 120).`)
    if (!/\bso you can\b/i.test(objective)) warn('objectives', `Objective ${index + 1} should read "… so you can …".`)
  })
  const requirements = copy.requirements ?? []
  if (requirements.length < 3 || requirements.length > 6) err('requirements', `${requirements.length} requirements (3–6).`)
  const who = copy.whoItsFor ?? []
  if (who.length && (who.length < 3 || who.length > 4)) warn('whoItsFor', `${who.length} "who it's for" lines (3–4).`)
  const careers = copy.careerPaths ?? []
  if (careers.length && (careers.length < 3 || careers.length > 5)) warn('careerPaths', `${careers.length} career paths (3–5).`)
  const faq = copy.faq ?? []
  if (faq.length < 4 || faq.length > 6) err('faq', `${faq.length} FAQs (4–6).`)
  if (!keyword) warn('primaryKeyword', 'No primary keyword set: keyword checks were skipped.')

  for (const [field, text] of [
    ['seoTitle', seoTitle], ['metaDescription', meta], ['shortDescription', short], ['description', description],
    ['objectives', objectives.join('\n')], ['requirements', requirements.join('\n')], ['whoItsFor', who.join('\n')], ['careerPaths', careers.join('\n')],
    ['faq', faq.map((item) => `${item.question}\n${item.answer}`).join('\n')],
  ] as const) checkWords(field, text, issues)
  return issues
}

export const lintErrors = (issues: LintIssue[]) => issues.filter((issue) => issue.level === 'error')

/** Lexical rich text to plain text with "# " headings, for linting the stored description. */
export function lexicalToLintText(value: unknown): string {
  const lines: string[] = []
  const inline = (node: unknown): string => {
    if (!node || typeof node !== 'object') return ''
    const current = node as { text?: string; children?: unknown[] }
    if (typeof current.text === 'string') return current.text
    return (current.children ?? []).map(inline).join('')
  }
  const block = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const current = node as { type?: string; tag?: string; children?: unknown[]; root?: unknown }
    if (current.root) return block(current.root)
    if (current.type === 'root') return (current.children ?? []).forEach(block)
    if (current.type === 'heading') lines.push(`# ${inline(current)}`)
    else if (current.type === 'list') for (const item of current.children ?? []) lines.push(`- ${inline(item)}`)
    else lines.push(inline(current))
  }
  block(value)
  return lines.filter((line) => line.trim()).join('\n')
}

type Rows<T extends string> = Array<Record<T, string>> | null | undefined
const values = <T extends string>(rows: Rows<T>, field: T) => (rows ?? []).map((row) => row[field]).filter(Boolean)

/** Live programme fields, as the lint expects them. */
export function copyFromCourse(course: Record<string, unknown>): ProgrammeCopy {
  const meta = (course.meta ?? {}) as { title?: string; description?: string }
  return {
    seoTitle: meta.title ?? null,
    metaDescription: meta.description ?? null,
    shortDescription: (course.shortDescription as string) ?? null,
    description: lexicalToLintText(course.description),
    objectives: values(course.objectives as Rows<'objective'>, 'objective'),
    requirements: values(course.requirements as Rows<'requirement'>, 'requirement'),
    whoItsFor: values(course.whoItsFor as Rows<'item'>, 'item'),
    toolsCovered: values(course.toolsCovered as Rows<'tool'>, 'tool'),
    careerPaths: values(course.careerPaths as Rows<'role'>, 'role'),
    faq: ((course.faq ?? []) as Array<{ question: string; answer: string }>).map(({ question, answer }) => ({ question, answer })),
    primaryKeyword: (course.primaryKeyword as string) ?? null,
    secondaryKeywords: values(course.secondaryKeywords as Rows<'keyword'>, 'keyword'),
  }
}
