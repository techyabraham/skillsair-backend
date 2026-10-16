/**
 * The ten SkillsAir schools and the owner's programme line-up for each. A course can sit in
 * more than one school (UI/UX is in Design and Products; Smartphone Videography is in Content
 * Creation and Smartphone Creators). The first school in this list that names a course is its
 * home school (`categories[0]`). Keep in sync with `src/content/site.ts` in the frontend.
 */
export interface PlannedProgramme {
  title: string
  alsoKnownAs?: string[]
}

export interface SchoolLineup {
  name: string
  formerNames?: string[]
  description: string
  programmes: PlannedProgramme[]
}

const SMARTPHONE_VIDEOGRAPHY: PlannedProgramme = { title: 'Smartphone Videography and Content Creation', alsoKnownAs: ['Smartphone Videography'] }
const UI_UX: PlannedProgramme = { title: 'UI/UX Design', alsoKnownAs: ['UI/UX', 'UI UX', 'Product Design'] }

export const SCHOOLS: SchoolLineup[] = [
  { name: 'School of AI', description: 'Use and build with AI, the skill every industry is now hiring for.', programmes: [] },
  { name: 'School of Content Creation', description: 'Create content brands and audiences pay attention to.', programmes: [SMARTPHONE_VIDEOGRAPHY] },
  {
    name: 'School of Data',
    description: 'Turn raw numbers into decisions, and put AI to work on the busywork.',
    programmes: [{ title: 'Data Analysis' }, { title: 'AI Automation' }, { title: 'Prompt Engineering' }],
  },
  {
    name: 'School of Design',
    description: 'Design products and visuals people love to use.',
    programmes: [UI_UX, { title: 'Graphics Design', alsoKnownAs: ['Graphic Design'] }],
  },
  {
    name: 'School of Engineering',
    description: 'Build the software that runs modern businesses.',
    programmes: [
      { title: 'Frontend Development', alsoKnownAs: ['Front-end Development', 'Front End Development'] },
      { title: 'Backend Development', alsoKnownAs: ['Back-end Development', 'Back End Development'] },
      { title: 'Mobile App Development' },
      { title: 'Cloud Engineering (AWS Solutions Architect)', alsoKnownAs: ['Cloud Engineering', 'AWS Solutions Architect'] },
      { title: 'Website Development (Full Stack)', alsoKnownAs: ['Website Development', 'Full Stack Development', 'Fullstack Development'] },
    ],
  },
  { name: 'School of No-Code Development', description: 'Build real apps and websites without writing code.', programmes: [] },
  {
    name: 'School of Products',
    description: 'Learn to lead products from idea to launch.',
    programmes: [{ title: 'Product Management' }, { title: 'Product Design (UI/UX)', alsoKnownAs: ['Product Design', ...(UI_UX.alsoKnownAs ?? []), UI_UX.title] }],
  },
  { name: 'School of Sales and Marketing', description: 'Grow brands and close deals with digital skills.', programmes: [] },
  {
    name: 'School of Security',
    description: 'Protect systems and data from attackers.',
    programmes: [{ title: 'Cyber Security', alsoKnownAs: ['Cybersecurity'] }, { title: 'Ethical Hacking' }],
  },
  {
    name: 'School of Smartphone Creators',
    formerNames: ['School of Smart Phone', 'School of Smartphone'],
    description: 'Shoot, design and stream with just your phone, and turn it into income.',
    programmes: [SMARTPHONE_VIDEOGRAPHY, { title: 'Mobile Graphics Design', alsoKnownAs: ['Mobile Graphic Design'] }, { title: 'Mobile Streaming' }],
  },
]

export const normaliseName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The school a category name refers to, including former names ("School of Smart Phone"). */
export function findSchool(name: string): SchoolLineup | undefined {
  const key = normaliseName(name)
  return SCHOOLS.find((school) => normaliseName(school.name) === key || (school.formerNames ?? []).some((former) => normaliseName(former) === key))
}

/** True when a course title is the planned programme or one of its other names ("Data Analysis with Excel" counts). */
export function matchesProgramme(courseTitle: string, planned: PlannedProgramme): boolean {
  const title = normaliseName(courseTitle)
  if (title.length < 4) return false
  return [planned.title, ...(planned.alsoKnownAs ?? [])].some((name) => {
    const key = normaliseName(name)
    return title === key || title.startsWith(key) || key.startsWith(title)
  })
}

/** The schools a course belongs to, home school first. */
export function schoolsForCourse(courseTitle: string): SchoolLineup[] {
  return SCHOOLS.filter((school) => school.programmes.some((planned) => matchesProgramme(courseTitle, planned)))
}
