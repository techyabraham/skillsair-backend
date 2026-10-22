/**
 * Course content names from Google Drive: tidying (clutter only, the author's wording is kept)
 * and matching keys used by the Drive curriculum import (src/migrations/import-drive-curriculum.ts).
 */
export const ext = (name: string) => (/\.([a-z0-9]{1,6})$/i.exec(name)?.[1] ?? '').toLowerCase()

/** Removes clutter only; keeps the author's wording and numbering. */
export function tidyName(raw: string, isFile: boolean): string {
  let name = raw.trim()
  if (isFile && ext(name)) name = name.slice(0, -(ext(name).length + 1))
  name = name.replace(/^copy of\s+/i, '')
  name = name.replace(/\[[^\]]*\.(com|net|org|io|info|me)[^\]]*\]/gi, '')
  name = name.replace(/^\d{5,}\s*-\s*/, '')
  // Uploader handles such as "(@free_design_courses)".
  name = name.replace(/\s*[([]@[^)\]]*[)\]]/g, '')
  // "01 - 01 Class Preview" -> "01 - Class Preview"
  const doubled = /^(\d+)\s*-\s*(\d+)[\s.:-]+(.*)$/.exec(name)
  if (doubled && Number(doubled[1]) === Number(doubled[2]) && doubled[3]) name = `${doubled[1]} - ${doubled[3]}`
  // "4. 3. Your profile overview" -> "3. Your profile overview" (file position, then lesson number)
  name = name.replace(/^\d+\.\s+(?=\d+\.\s)/, '')
  // "1-Module 1 - Course Introduction" -> "Module 1 - Course Introduction" (the sort number repeats the label)
  name = name.replace(/^\d+\s*[.\-:),]\s*(?=(module|chapter|section|part|unit|week|day)\s*\d)/i, '')
  // "Master Project_ MealsToGo" -> "Master Project: MealsToGo" (an underscore stood in for a colon)
  name = name.replace(/(\S)_\s+/g, '$1: ')
  // "[Photoshop I]Fundamentals" -> "[Photoshop I] Fundamentals"
  name = name.replace(/\](?=[A-Za-z0-9])/g, '] ')
  // "Illustrator-CC-2020-MasterClass" -> "Illustrator CC 2020 MasterClass" (hyphens used as spaces)
  if (!/\s/.test(name) && /[A-Za-z]-[A-Za-z0-9]/.test(name)) name = name.replace(/-/g, ' ')
  return name.replace(/\s{2,}/g, ' ').replace(/^[\s_-]+/, '').replace(/[\s_-]+$/, '').trim()
}

export const leadingNumber = (name: string): number | null => {
  const match = /^(\d{1,4})(?!\d)/.exec(name.replace(/^copy of\s+/i, '').replace(/^\d{5,}\s*-\s*/, ''))
  return match ? Number(match[1]) : null
}

/** Wording without numbering, "Module 3 -" style labels, case or punctuation. */
export const words = (title: string) => tidyName(title, false)
  .replace(/^(?:\d+\s*[.\-:)]*\s*)?(?:(?:module|chapter|section|part|unit|week|day)\s*\d+\s*[.\-:)]*\s*)?/i, '')
  .replace(/^\d+\s*[.\-:)]*\s*/, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')
export const sectionKey = (title: string) => words(title)
/** Lesson key: number plus wording, so repeated titles ("Section Intro") stay distinct. */
export const lessonKey = (title: string) => `${leadingNumber(tidyName(title, false)) ?? ''}|${words(title)}`

/** Small spelling differences ("The Kits" / "The Kit") still match; short keys must be exact. */
export function similar(a: string, b: string): boolean {
  if (a === b) return true
  const shortest = Math.min(a.length, b.length)
  const allowed = shortest >= 10 ? 2 : shortest >= 5 ? 1 : 0
  if (!allowed || Math.abs(a.length - b.length) > allowed) return false
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0] ?? 0
    previous[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j] ?? 0
      previous[j] = Math.min(above + 1, (previous[j - 1] ?? 0) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return (previous[b.length] ?? 99) <= allowed
}
