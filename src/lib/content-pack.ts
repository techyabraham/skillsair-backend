/**
 * Content packs (content/packs/<course-slug>/): questions.json and programme.json written from the
 * course transcripts. Schema validation and the item-writing lint rules (Learning Quality build,
 * section 2.5). Pure: content:import uses it before anything is written.
 */
import { z } from 'zod'

export const packQuestionSchema = z.object({
  key: z.string().trim().min(3).max(120),
  lessonDriveFileId: z.string().trim().min(10),
  chapterOrder: z.number().int().min(0),
  type: z.enum(['single', 'multiple', 'true_false']),
  prompt: z.string().trim().min(8).max(400),
  options: z.array(z.string().trim().min(1)).min(2).max(6),
  correct: z.array(z.number().int().min(0)).min(1),
  explanation: z.string().trim().min(1),
  sourceTimestamp: z.string().trim().regex(/^(\d{1,2}:)?\d{1,2}:\d{2}$/).optional(),
  pools: z.array(z.enum(['knowledge_check', 'chapter', 'exam'])).min(1),
})
export type PackQuestion = z.infer<typeof packQuestionSchema>

export const programmeCopySchema = z.object({
  seoTitle: z.string().trim().min(1),
  metaDescription: z.string().trim().min(1),
  shortDescription: z.string().trim().min(1),
  description: z.string().trim().min(1),
  objectives: z.array(z.string().trim().min(1)),
  requirements: z.array(z.string().trim().min(1)),
  whoItsFor: z.array(z.string().trim().min(1)).default([]),
  toolsCovered: z.array(z.string().trim().min(1)).default([]),
  careerPaths: z.array(z.string().trim().min(1)).default([]),
  faq: z.array(z.object({ question: z.string().trim().min(1), answer: z.string().trim().min(1) })),
  primaryKeyword: z.string().trim().min(1),
  secondaryKeywords: z.array(z.string().trim().min(1)).default([]),
})
export type ProgrammePack = z.infer<typeof programmeCopySchema>

export interface PackIssue {
  level: 'error' | 'warning'
  key: string
  message: string
}

const ALL_NONE = /\b(all|none|both|neither) of (the )?(above|these|the above)\b/i
const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

function bigrams(text: string): Map<string, number> {
  const s = norm(text).replace(/ /g, '')
  const out = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1)
  return out
}

/** Dice similarity of character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = bigrams(a)
  const y = bigrams(b)
  let overlap = 0
  let total = 0
  for (const [gram, count] of x) { overlap += Math.min(count, y.get(gram) ?? 0); total += count }
  for (const count of y.values()) total += count
  return total ? (2 * overlap) / total : 0
}

/** Validates and lints a questions.json array. Questions with errors are skipped by the importer. */
export function lintQuestions(raw: unknown[], knownDriveFileIds?: Set<string>): { valid: PackQuestion[]; issues: PackIssue[] } {
  const issues: PackIssue[] = []
  const valid: PackQuestion[] = []
  const seenKeys = new Set<string>()
  raw.forEach((item, index) => {
    const parsed = packQuestionSchema.safeParse(item)
    const key = (item as { key?: string })?.key ?? `#${index + 1}`
    if (!parsed.success) {
      issues.push({ level: 'error', key, message: `Schema: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}` })
      return
    }
    const q = parsed.data
    const errors: string[] = []
    if (seenKeys.has(q.key)) errors.push('duplicate key in the pack')
    seenKeys.add(q.key)
    if (q.correct.some((i) => i >= q.options.length)) errors.push('a correct index is outside the options')
    if (new Set(q.options.map(norm)).size !== q.options.length) errors.push('duplicate options')
    if (q.options.some((option) => option.length > 120)) errors.push('an option is over 120 characters')
    if (ALL_NONE.test(q.prompt) || q.options.some((option) => ALL_NONE.test(option))) errors.push('"all/none of the above" is not allowed')
    if (q.type === 'single' && q.correct.length !== 1) errors.push('single-answer questions need exactly one correct option')
    if (q.type === 'multiple' && (q.correct.length < 2 || q.correct.length > 3)) errors.push('multiple-answer questions need 2–3 correct options')
    if (q.type === 'true_false' && (q.options.length !== 2 || q.correct.length !== 1)) errors.push('true/false needs 2 options and one correct')
    if (knownDriveFileIds && !knownDriveFileIds.has(q.lessonDriveFileId)) errors.push(`lesson video ${q.lessonDriveFileId} isn't in the database`)
    if (q.explanation.split(/\s+/).length > 60) issues.push({ level: 'warning', key: q.key, message: 'explanation is over 60 words' })
    if (q.type !== 'true_false' && q.options.length !== 4) issues.push({ level: 'warning', key: q.key, message: `${q.options.length} options (4 expected)` })
    if (/\bnot\b.*\bnot\b|\bexcept\b/i.test(q.prompt)) issues.push({ level: 'warning', key: q.key, message: 'possible trick or double negative in the prompt' })
    if (q.type !== 'true_false') {
      const lengths = q.options.map((option) => option.length)
      const correctLongest = Math.max(...q.correct.map((i) => lengths[i] ?? 0))
      const others = lengths.filter((_, i) => !q.correct.includes(i))
      if (others.length && correctLongest > 1.8 * Math.max(...others)) issues.push({ level: 'warning', key: q.key, message: 'the correct option is much longer than the distractors' })
    }
    if (errors.length) issues.push({ level: 'error', key: q.key, message: errors.join('; ') })
    else valid.push(q)
  })

  // Near-duplicate prompts within a chapter.
  const byChapter = new Map<number, PackQuestion[]>()
  for (const q of valid) byChapter.set(q.chapterOrder, [...(byChapter.get(q.chapterOrder) ?? []), q])
  for (const list of byChapter.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i] as PackQuestion
      const b = list[j] as PackQuestion
      if (similarity(a.prompt, b.prompt) > 0.85) issues.push({ level: 'warning', key: b.key, message: `near-duplicate of ${a.key}` })
    }
  }

  // Correct-answer positions balanced across A–D (single-answer, 4 options).
  const positions = [0, 0, 0, 0]
  for (const q of valid) if (q.type === 'single' && q.options.length === 4) positions[q.correct[0] as number]! += 1
  const total = positions.reduce((sum, n) => sum + n, 0)
  if (total >= 20) {
    positions.forEach((n, i) => {
      const share = n / total
      if (share > 0.4 || share < 0.1) issues.push({ level: 'warning', key: '(pack)', message: `correct answer is option ${'ABCD'[i]} in ${Math.round(share * 100)}% of questions (aim for about 25%)` })
    })
  }
  return { valid, issues }
}
