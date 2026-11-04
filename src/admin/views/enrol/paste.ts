/** Reading a pasted list on the Enrol learners screen: emails, and programme names written after them. */

export interface Programme {
  id: number
  title: string
  slug: string
}

/** Anything with an @ counts, so a mistyped address comes back from the server as a failed line instead of vanishing. */
const EMAIL = /[^\s<>(),;|"']+@[^\s<>(),;|"']+/g

/** Commas, semicolons, spaces or new lines; a pasted "Ada Obi <ada@x.com>" keeps the address. */
export function parseEmails(text: string): string[] {
  return text.match(EMAIL) ?? []
}

export interface PastedLine {
  emails: string[]
  /** Programme names written after the emails on the same line, as typed. */
  names: string[]
}

/**
 * One line can name programmes after the email(s): "ada@x.com, UI/UX; Data Analysis". Anything
 * on the line that isn't an email (split on commas, semicolons, tabs or "|") is a programme name.
 * Text before the first email (a name, as in "Ada Obi <ada@x.com>") is ignored.
 */
export function parsePastedLines(text: string): PastedLine[] {
  return text
    .split(/\r?\n/)
    .map((line): PastedLine | null => {
      const emails = [...(line.match(EMAIL) ?? [])]
      if (!emails.length) return null
      const first = line.indexOf(emails[0]!)
      const rest = line.slice(first).replace(EMAIL, ' ').replace(/[<>()"']/g, ' ')
      const names = rest.split(/[,;|\t]+/).map((part) => part.trim()).filter(Boolean)
      return { emails, names }
    })
    .filter((line): line is PastedLine => line !== null)
}

const norm = (text: string) => text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Exact title or slug first; otherwise the one programme whose title starts with (or contains) the name. */
export function matchProgramme(name: string, programmes: Programme[]): Programme | null {
  const key = norm(name)
  if (!key) return null
  const exact = programmes.find((programme) => norm(programme.title) === key || norm(programme.slug) === key)
  if (exact) return exact
  for (const test of [(title: string) => title.startsWith(key), (title: string) => title.includes(key)]) {
    const hits = programmes.filter((programme) => test(norm(programme.title)))
    if (hits.length === 1) return hits[0]!
    if (hits.length > 1) return null
  }
  return null
}
