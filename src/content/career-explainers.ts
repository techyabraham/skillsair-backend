/**
 * Email C: a short, honest explainer of what someone in the school's career path does.
 * Switch to real graduate stories once they exist (with permission).
 */

interface Explainer {
  role: string
  body: string
}

const EXPLAINERS: Record<string, Explainer> = {
  ai: { role: 'AI specialist', body: 'Most days involve using AI tools to speed up real work: drafting, summarising, automating repetitive tasks and checking the results carefully. The skill employers pay for is knowing which tool fits the job and when not to trust it.' },
  contentcreation: { role: 'content creator', body: 'A typical day mixes planning, shooting or writing, editing and checking what worked last week. Brands pay for creators who can turn an idea into posts people actually watch, on a schedule.' },
  data: { role: 'data analyst', body: 'A typical day: pull numbers from a spreadsheet or database, clean them up, find what changed and explain it in a simple chart. Companies pay for someone who turns messy data into a clear decision.' },
  design: { role: 'designer', body: 'Designers spend the day turning a brief into screens or visuals, getting feedback and refining. The work is half creativity, half understanding what users and clients actually need.' },
  engineering: { role: 'software engineer', body: 'Engineers spend most of the day reading code, building small features, fixing bugs and testing. It rewards patience and problem-solving more than genius.' },
  nocodedevelopment: { role: 'no-code developer', body: 'No-code builders turn a business problem into a working app, website or automation using visual tools, often in days. Small businesses pay well for someone who can ship fast.' },
  products: { role: 'product manager', body: 'Product managers talk to users, decide what to build next, write clear plans and keep designers and engineers moving in the same direction. It suits organised people who like solving problems with others.' },
  salesandmarketing: { role: 'digital marketer', body: 'A typical day: plan campaigns, write ads, look at what is converting and adjust the budget. Businesses pay for people who can show that their marketing brought in customers.' },
  security: { role: 'security analyst', body: 'Security analysts watch for unusual activity, investigate alerts, fix weak settings and teach colleagues to avoid scams. It suits careful people who enjoy puzzles.' },
  smartphone: { role: 'smartphone creator', body: 'Phone-first creators shoot, edit and publish videos and photos for brands and events using only a smartphone. It is one of the quickest skills to turn into paid gigs.' },
}

export function careerExplainer(schoolName: string): Explainer {
  const key = schoolName.toLowerCase().replace(/^school of /, '').replace(/[^a-z]/g, '')
  return EXPLAINERS[key] ?? { role: 'tech professional', body: 'Most entry-level tech roles mix learning, doing small real tasks and improving with feedback. Employers look for proof you can do the work: a certificate they can verify and projects you can show.' }
}
