/**
 * Human titles for Studio (brief 6.3): a hidden, read-only `displayTitle` text field used as
 * `admin.useAsTitle` on collections whose records otherwise show as a bare id. It is filled by a
 * field-level beforeChange hook and backfilled by migration 20261019_090000_display_titles.
 *
 * Purely presentational: it never blocks a write. If a lookup fails the previous title (or a
 * fallback) is kept. Titles are only recomputed when the fields they are built from change.
 */
import type { Field, FieldHook, PayloadRequest } from 'payload'

type Doc = Record<string, unknown>
type Build = (doc: Doc, lookup: Lookup) => Promise<string | null>

export const DISPLAY_TITLE_MAX = 160

function idOf(value: unknown): number | string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') {
    const record = value as { id?: unknown; value?: unknown }
    if (record.value !== undefined) return idOf(record.value)
    return record.id === undefined ? null : (record.id as number | string)
  }
  return value as number | string
}

/** Small memoised Local API reader bound to the request (keeps the write's transaction). */
export class Lookup {
  private cache = new Map<string, Promise<Doc | null>>()
  constructor(private req: PayloadRequest) {}

  doc(collection: string, value: unknown, select: Record<string, true>): Promise<Doc | null> {
    if (value && typeof value === 'object' && !('relationTo' in (value as object)) && Object.keys(select).some((key) => key in (value as object))) {
      return Promise.resolve(value as Doc)
    }
    const id = idOf(value)
    if (id === null) return Promise.resolve(null)
    const key = `${collection}:${id}`
    let hit = this.cache.get(key)
    if (!hit) {
      hit = this.req.payload
        .findByID({ collection: collection as never, id, depth: 0, select: select as never, overrideAccess: true, req: this.req, disableErrors: true })
        .then((doc) => (doc as unknown as Doc | null) ?? null)
        .catch(() => null)
      this.cache.set(key, hit)
    }
    return hit
  }

  async personName(collection: 'users' | 'leads', value: unknown): Promise<string | null> {
    const doc = await this.doc(collection, value, collection === 'users' ? { firstName: true, lastName: true, email: true } : { firstName: true, email: true })
    return doc ? nameOf(doc) : null
  }

  async title(collection: string, value: unknown, field = 'title'): Promise<string | null> {
    const doc = await this.doc(collection, value, { [field]: true })
    const title = doc?.[field]
    return typeof title === 'string' && title.trim() ? title.trim() : null
  }
}

export function nameOf(doc: Doc): string | null {
  const name = [doc.firstName, doc.lastName].filter((part) => typeof part === 'string' && part.trim()).join(' ').trim()
  if (name) return name
  return typeof doc.email === 'string' && doc.email ? doc.email : null
}

export function joinTitle(parts: Array<string | null | undefined | false>): string | null {
  const text = parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' · ')
  return text ? text.slice(0, DISPLAY_TITLE_MAX) : null
}

export function excerpt(text: unknown, length = 60): string | null {
  if (typeof text !== 'string') return null
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(idOf(a) ?? a ?? null) === JSON.stringify(idOf(b) ?? b ?? null)

/**
 * The `displayTitle` field. `dependsOn` lists the fields the title is built from; on update the
 * title is only rebuilt when one of them changed (or no title exists yet).
 */
export function displayTitleField(dependsOn: string[], build: Build): Field {
  const hook: FieldHook = async ({ data, originalDoc, operation, req, value }) => {
    const merged: Doc = { ...(originalDoc ?? {}), ...(data ?? {}) }
    const existing = typeof value === 'string' && value ? value : typeof originalDoc?.displayTitle === 'string' ? originalDoc.displayTitle : null
    if (operation === 'update' && existing && dependsOn.every((key) => sameValue(merged[key], originalDoc?.[key]))) return existing
    try {
      return (await build(merged, new Lookup(req))) ?? existing ?? (merged.id !== undefined ? `#${merged.id}` : null)
    } catch (error) {
      req.payload.logger.warn({ msg: 'displayTitle: could not build a title', err: error instanceof Error ? error.message : String(error) })
      return existing
    }
  }
  return {
    name: 'displayTitle',
    type: 'text',
    label: 'Title',
    admin: { readOnly: true, hidden: true },
    hooks: { beforeChange: [hook] },
  }
}

const perMonth = (price: unknown, interval: unknown) => {
  const amount = Number(price)
  if (!Number.isFinite(amount)) return null
  const formatted = `₦${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(amount)}`
  return interval === 'annually' ? `${formatted}/yr` : `${formatted}/mo`
}

/** One builder per collection (brief 6.3). */
export const DISPLAY_TITLES = {
  enrollments: displayTitleField(['student', 'course'], async (doc, l) =>
    joinTitle([await l.personName('users', doc.student), await l.title('courses', doc.course)]),
  ),
  subscriptions: displayTitleField(['user', 'course', 'plan'], async (doc, l) => {
    const plan = await l.doc('plans', doc.plan, { price: true, interval: true })
    return joinTitle([await l.personName('users', doc.user), await l.title('courses', doc.course), plan ? perMonth(plan.price, plan.interval) : null])
  }),
  messages: displayTitleField(['person', 'stepId', 'channel'], async (doc, l) => {
    const person = doc.person as { relationTo?: string; value?: unknown } | null
    const name = person?.relationTo === 'users' || person?.relationTo === 'leads' ? await l.personName(person.relationTo, person.value) : null
    return joinTitle([typeof doc.stepId === 'string' ? doc.stepId : null, typeof doc.channel === 'string' ? doc.channel : null, name])
  }),
  reviews: displayTitleField(['rating', 'student', 'course'], async (doc, l) =>
    joinTitle([doc.rating ? `★${doc.rating}` : null, await l.personName('users', doc.student), await l.title('courses', doc.course)]),
  ),
  discussions: displayTitleField(['body'], async (doc) => excerpt(doc.body, 60)),
  laptopApplications: displayTitleField(['user', 'cohortLabel'], async (doc, l) =>
    joinTitle([await l.personName('users', doc.user), typeof doc.cohortLabel === 'string' ? `${doc.cohortLabel} cohort`.replace(/cohort cohort$/i, 'cohort') : null]),
  ),
  accessExtensions: displayTitleField(['student', 'course', 'daysAdded'], async (doc, l) =>
    joinTitle([await l.personName('users', doc.student), (await l.title('courses', doc.course)) ?? 'All programmes', doc.daysAdded ? `+${doc.daysAdded} days` : null]),
  ),
  lessonProgress: displayTitleField(['student', 'lesson'], async (doc, l) =>
    joinTitle([await l.personName('users', doc.student), await l.title('lessons', doc.lesson)]),
  ),
  quizAttempts: displayTitleField(['student', 'quiz', 'score'], async (doc, l) =>
    joinTitle([await l.personName('users', doc.student), await l.title('quizzes', doc.quiz), typeof doc.score === 'number' ? `${doc.score}%` : null]),
  ),
  referrals: displayTitleField(['referrer', 'referredUser'], async (doc, l) => {
    const [from, to] = await Promise.all([l.personName('users', doc.referrer), l.personName('users', doc.referredUser)])
    return joinTitle([from && to ? `${from} → ${to}` : from ?? to])
  }),
  affiliates: displayTitleField(['user', 'affiliateCode'], async (doc, l) =>
    joinTitle([await l.personName('users', doc.user), typeof doc.affiliateCode === 'string' ? doc.affiliateCode : null]),
  ),
}
