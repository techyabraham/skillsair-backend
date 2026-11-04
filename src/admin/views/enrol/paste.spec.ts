import { describe, expect, it } from 'vitest'
import { matchProgramme, parseEmails, parsePastedLines, type Programme } from './paste.js'

const programmes: Programme[] = [
  { id: 1, title: 'UI/UX', slug: 'uiux' },
  { id: 2, title: 'Data Analysis', slug: 'data-analysis' },
  { id: 3, title: 'Website Development (Full Stack)', slug: 'website-development-full-stack' },
  { id: 4, title: 'Cyber Security', slug: 'cybersecurity' },
  { id: 5, title: 'Mobile App Development', slug: 'mobile-app-development' },
]

describe('Enrol learners paste parsing', () => {
  it('reads emails however they are separated, keeping mistyped ones for the server to report', () => {
    expect(parseEmails('Ada Obi <ada@x.com>, tobi@x.com; kemi@gmail\nnot an email')).toEqual(['ada@x.com', 'tobi@x.com', 'kemi@gmail'])
  })

  it('takes programme names written after the email on the same line', () => {
    expect(parsePastedLines('Ada Obi <ada@x.com>, UI/UX; Data Analysis\ntobi@x.com\n\nno email here\nkemi@x.com | Cyber Security')).toEqual([
      { emails: ['ada@x.com'], names: ['UI/UX', 'Data Analysis'] },
      { emails: ['tobi@x.com'], names: [] },
      { emails: ['kemi@x.com'], names: ['Cyber Security'] },
    ])
    expect(parsePastedLines('a@x.com, b@x.com')).toEqual([{ emails: ['a@x.com', 'b@x.com'], names: [] }])
  })

  it('matches programme names by title, slug or an unambiguous start', () => {
    expect(matchProgramme('ui/ux', programmes)?.id).toBe(1)
    expect(matchProgramme('UIUX', programmes)?.id).toBe(1)
    expect(matchProgramme('cybersecurity', programmes)?.id).toBe(4)
    expect(matchProgramme('Website Development', programmes)?.id).toBe(3)
    expect(matchProgramme('Full Stack', programmes)?.id).toBe(3)
    expect(matchProgramme('Development', programmes)).toBeNull()
    expect(matchProgramme('Music', programmes)).toBeNull()
  })
})
