/**
 * Local testing only: writes a synthetic content pack for a programme from its real curriculum
 * (every chapter gets chapter-quiz and exam questions; long lessons get knowledge checks), plus a
 * programme.json that passes the copy lint. The questions are placeholders for exercising the
 * assessment engine, never real content: real packs come from the pack writer.
 *
 * Usage: node --loader ts-node/esm scripts/make-fixture-pack.ts <course-slug> <out-dir>
 */
import fs from 'node:fs'
import path from 'node:path'

const [slug, outDir] = process.argv.slice(2)
if (!slug || !outDir) { console.log('Usage: make-fixture-pack.ts <course-slug> <out-dir>'); process.exit(1) }
const { getPayload } = await import('payload')
const { default: config } = await import('../payload.config.js')
const payload = await getPayload({ config })
const { relationId } = await import('../src/lib/course-access.js')
const course = (await payload.find({ collection: 'courses', where: { slug: { equals: slug } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as { id: number; title: string }
const sections = (await payload.find({ collection: 'sections', where: { course: { equals: course.id } }, sort: 'order', limit: 1000, depth: 0, overrideAccess: true })).docs as unknown as Array<{ id: number; title: string; order: number }>
const lessons = (await payload.find({ collection: 'lessons', where: { section: { in: sections.map((s) => s.id) } }, sort: 'order', limit: 10000, depth: 0, overrideAccess: true })).docs as unknown as Array<{ id: number; title: string; section: unknown; driveFileId?: string | null; duration?: number | null }>

const questions: unknown[] = []
let n = 0
for (const section of sections) {
  const own = lessons.filter((lesson) => Number(relationId(lesson.section)) === section.id && lesson.driveFileId)
  if (!own.length) continue
  // 14 chapter-quiz questions and 8 exam questions per chapter; 2 knowledge checks on the first lesson.
  for (let i = 0; i < 22; i++) {
    const lesson = own[i % own.length]!
    const correct = n % 4
    n++
    questions.push({
      key: `fixture-${slug}-${section.order}-${i}`,
      lessonDriveFileId: lesson.driveFileId,
      chapterOrder: section.order,
      type: 'single',
      prompt: `Fixture check ${n}: in "${lesson.title}", which option is marked as the right one for scenario ${i + 1}?`,
      options: ['Option one for this scenario', 'Option two for this scenario', 'Option three for this scenario', 'Option four for this scenario'],
      correct: [correct],
      explanation: `Fixture explanation: option ${correct + 1} is the right one, as shown in the lesson.`,
      sourceTimestamp: '01:30',
      pools: i < 14 ? ['chapter'] : ['exam'],
    })
  }
  for (let i = 0; i < 2; i++) {
    n++
    questions.push({
      key: `fixture-${slug}-${section.order}-kc-${i}`,
      lessonDriveFileId: own[0]!.driveFileId,
      chapterOrder: section.order,
      type: i === 0 ? 'true_false' : 'multiple',
      prompt: `Fixture quick check ${n}: about "${own[0]!.title}", pick the right answer for statement ${i + 1}.`,
      options: i === 0 ? ['True', 'False'] : ['First right answer', 'A wrong answer here', 'Second right answer', 'Another wrong answer'],
      correct: i === 0 ? [0] : [0, 2],
      explanation: 'Fixture explanation for a quick check.',
      sourceTimestamp: '00:45',
      pools: ['knowledge_check'],
    })
  }
}

const paragraph = (topic: string) => `${topic} You work through short lessons, practise straight after each one and check your understanding with a quiz at the end of every chapter. Each step builds on the one before, so you always know what to do next and why it matters for the work you want to do. You learn on your own schedule, with a weekly plan that keeps you moving and a clear finish line.`
const description = [
  `The ${course.title.toLowerCase()} course in Nigeria from SkillsAir takes you from zero to confident, practical work you can show an employer.`,
  '',
  '## What you will be able to do',
  ...Array.from({ length: 6 }, (_, i) => `- Apply skill ${i + 1} from the programme so you can handle real tasks with confidence.`),
  '',
  `## How the ${course.title.toLowerCase()} course in Nigeria works`,
  paragraph('The guided 12-week plan sets about eight hours of learning a week.'),
  paragraph('If you prefer, you can learn self-paced instead.'),
  '',
  "## What's inside",
  ...sections.map((section) => `- ${section.title}: the key ideas of this chapter, with practice.`),
  '',
  '## Tools you will use',
  paragraph('You use free tools wherever possible and we tell you exactly what to install.'),
  '',
  "## Who it's for",
  paragraph('Graduates, NYSC members and career changers who want practical skills.'),
  '',
  '## After you finish',
  paragraph('You can earn a verifiable certificate by passing the final exam, and certified graduates get access to internship openings from a growing partner network, with no job guarantees.'),
  paragraph('Every learner also gets the free Freelancer’s Academy bonus course to start winning clients.'),
  paragraph('Questions are answered in the FAQ below, and our team is on WhatsApp if you need help choosing.'),
].join('\n')
const programme = {
  seoTitle: `${course.title} course in Nigeria · SkillsAir`.slice(0, 60),
  metaDescription: `Learn ${course.title.toLowerCase()} online in Nigeria with a guided 12-week plan, chapter quizzes and real projects. Start from zero and apply today.`.slice(0, 155).padEnd(140, '.'),
  shortDescription: `Practical ${course.title.toLowerCase()} skills from zero, with a guided plan and projects.`,
  description,
  objectives: Array.from({ length: 6 }, (_, i) => `Use core skill ${i + 1} so you can complete real tasks on your own`),
  requirements: ['A laptop or phone with a stable internet connection', 'Free software only; we show you what to install', 'No prior knowledge needed: we start from zero', 'About 8 hours a week'],
  whoItsFor: ['Graduates and NYSC members who want practical skills', 'Career changers moving into tech', 'Students who want a head start'],
  toolsCovered: ['Tool one', 'Tool two'],
  careerPaths: ['Junior analyst', 'Support specialist', 'Associate'],
  faq: Array.from({ length: 4 }, (_, i) => ({ question: `Fixture question ${i + 1}?`, answer: `Fixture answer ${i + 1}.` })),
  primaryKeyword: `${course.title.toLowerCase()} course in Nigeria`,
  secondaryKeywords: ['fixture keyword'],
}
fs.mkdirSync(path.join(outDir, slug), { recursive: true })
fs.writeFileSync(path.join(outDir, slug, 'questions.json'), `${JSON.stringify(questions, null, 2)}\n`)
fs.writeFileSync(path.join(outDir, slug, 'programme.json'), `${JSON.stringify(programme, null, 2)}\n`)
console.log(`fixture pack: ${questions.length} questions across ${sections.length} chapters -> ${path.join(outDir, slug)}`)
process.exit(0)
