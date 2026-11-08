import { defineEmail, firstNameOf } from './define.js'

export interface QuizResultEmailData {
  firstName: string
  /** e.g. "Data Analysis" */
  topMatch: string
  /** "Strong match", "Good match" or "Worth exploring" */
  matchLabel: string
  percent: number
  /** True when SkillsAir doesn't run the top match yet (waitlist). */
  comingSoon: boolean
  /** The best open programme to apply for, if any. */
  openProgramme: string | null
  resultUrl: string
  cardUrl: string
}

/**
 * Career Match quiz result (sent once, straight after the quiz gate, instead of the A0 offer
 * email for quiz applicants). One static result-card image and one button to the result page,
 * where the scholarship offer and Apply button are. No scores are claimed to be scientific.
 */
export const quizResult = defineEmail({
  id: 'quiz-result',
  kind: 'transactional',
  track: 'A',
  stepId: 'A0-quiz',
  sample: {
    firstName: 'Tobi',
    topMatch: 'Data Analysis',
    matchLabel: 'Strong match',
    percent: 82,
    comingSoon: false,
    openProgramme: 'Data Analysis',
    resultUrl: 'https://skillsair.com/quiz/result/sample',
    cardUrl: 'https://skillsair.com/quiz/result/sample/card',
  } as QuizResultEmailData,
  copy: {
    subject: { label: 'Subject', kind: 'subject', default: '{{firstName}}, your Career Match: {{topMatch}}' },
    preheader: { label: 'Preview text', kind: 'preheader', default: 'Your top 3, your strengths and your scholarship offer.' },
    greeting: { label: 'Greeting', default: 'Hi {{firstName}},' },
    intro: { label: 'Opening line', default: 'Thanks for taking the Career Match quiz. Your top match is **{{topMatch}}** ({{matchLabel}}, {{percent}}%).' },
    honest: { label: 'What the result is', default: "It's based on what you told us, not a test you can fail." },
    open: { label: 'When the top match is open', default: 'Your result page has your top 3, your strengths and your scholarship offer for {{openProgramme}}.' },
    waitlist: { label: 'When the top match is coming soon', default: "We don't run {{topMatch}} yet. Tap below to join the waitlist, and see the programmes that fit you and are open now, like {{openProgramme}}." },
    ctaLabel: { label: 'Button', kind: 'button', default: 'See my result' },
  },
  vars: (data) => ({
    firstName: firstNameOf(data.firstName),
    topMatch: data.topMatch,
    matchLabel: data.matchLabel.toLowerCase(),
    percent: String(data.percent),
    openProgramme: data.openProgramme ?? 'another programme',
  }),
  varDocs: {
    firstName: 'Their first name ("there" when we don’t know it)',
    topMatch: 'Their top career match, e.g. Data Analysis',
    matchLabel: 'strong match, good match or worth exploring',
    percent: 'Their match percentage (number only)',
    openProgramme: 'The best open programme for them to apply to',
  },
  subject: (_data, c) => c.subject(),
  preheader: (_data, c) => c.preheader(),
  body: (data, c) => ({
    blocks: [
      c.greeting(),
      c.intro(),
      { image: { src: data.cardUrl, alt: `${data.topMatch}: ${data.matchLabel}, ${data.percent}%`, width: 540, height: 675 } },
      data.comingSoon ? c.waitlist() : c.open(),
      { small: c.honest() },
    ],
    button: { label: c.ctaLabel(), url: data.resultUrl },
  }),
})
