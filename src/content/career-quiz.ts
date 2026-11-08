// SYNCED from skillsair/src/content/quiz-v2.ts by scripts/sync-quiz-to-backend.ts. Edit the frontend copy.
/**
 * Career Match quiz v2: 12 core questions (11 from the old QSM "Tech Quiz" plus one new one),
 * 3 context questions and an optional tie-breaker. Transparent, rules-based scoring: each
 * answer gives 0–3 points to career outcomes, and a career's match is the share of the points
 * it could have earned. Not AI-powered and not a scientific test.
 *
 * Source material: src/content/quiz-qsm.generated.ts (scripts/convert-qsm-quiz.ts). Answers
 * marked `qsm` keep their original QSM weights, except the rebalancing edits listed in
 * QSM_WEIGHT_CHANGES (checked in quiz.test.ts).
 *
 * This file has NO imports on purpose: the backend keeps an identical copy at
 * skillsair-backend/src/content/career-quiz.ts to validate answers and recompute scores on the
 * server. After editing, run `node scripts/sync-quiz-to-backend.ts`.
 */

export const QUIZ_VERSION = "v2" as const;

// ---------------------------------------------------------------------------------------------
// Careers
// ---------------------------------------------------------------------------------------------

export const CAREER_IDS = [
  "frontend",
  "backend",
  "ethical-hacking",
  "smartphone-videography",
  "cybersecurity",
  "mobile-app",
  "content-creation",
  "graphics-design",
  "product-management",
  "data-analysis",
  "it-support",
  "qa-testing",
  "ui-ux",
  "cloud",
] as const;

export type CareerId = (typeof CAREER_IDS)[number];

export const TRAIT_IDS = ["creative", "analytical", "builder", "protector", "people"] as const;
export type TraitId = (typeof TRAIT_IDS)[number];

export const TRAIT_LABELS: Record<TraitId, { name: string; noun: string }> = {
  creative: { name: "Creative", noun: "a Creative" },
  analytical: { name: "Analytical", noun: "an Analyst" },
  builder: { name: "Builder", noun: "a Builder" },
  protector: { name: "Protector", noun: "a Protector" },
  people: { name: "People & Strategy", noun: "a People & Strategy person" },
};

export interface Career {
  id: CareerId;
  name: string;
  /**
   * Slug of the SkillsAir programme this career leads to. The career is "open" only when a
   * course with this slug exists and is published; otherwise it is "waitlist". To open a
   * waitlist career, set its slug here and publish the course.
   */
  programmeSlug?: string;
  /** Shown under the programme when it covers more than this career. */
  programmeNote?: string;
  oneLiner: string;
  love: [string, string, string];
  hard: [string, string, string];
  /** One line describing a typical day, for the tie-breaker question. */
  day: string;
}

export const careers: Record<CareerId, Career> = {
  frontend: {
    id: "frontend",
    name: "Frontend Development",
    programmeSlug: "frontend-development",
    oneLiner: "Build the parts of websites and apps people see and tap, and watch your code come to life.",
    love: ["Building screens real people use", "Seeing your changes on screen straight away", "Mixing creativity with problem-solving"],
    hard: ["Websites behave differently on different phones and browsers", "Turning a designer's idea into code takes patience", "The tools change often, so you keep learning"],
    day: "You turn a design into a working web page, then tweak it until it looks right on every phone.",
  },
  backend: {
    id: "backend",
    name: "Backend Development",
    programmeSlug: "website-development-full-stack",
    programmeNote: "Website Development (Full Stack) covers both frontend and backend.",
    oneLiner: "Build the hidden engine behind apps: the servers, databases and logic that make everything work.",
    love: ["Solving tricky logic problems", "Working with databases, APIs and servers", "Building systems that handle thousands of users"],
    hard: ["Finding bugs can take hours of patient digging", "Your best work is often invisible to users", "Putting apps online has its own learning curve"],
    day: "You build the logic that saves a customer's order and sends their receipt, then make it faster.",
  },
  "ethical-hacking": {
    id: "ethical-hacking",
    name: "Ethical Hacking",
    programmeSlug: "ethical-hacking",
    oneLiner: "Think like an attacker to find security holes before criminals do, with permission.",
    love: ["The puzzle of getting into systems (legally)", "Always something new to learn", "Getting paid to think like a hacker"],
    hard: ["You need solid networking and Linux basics first", "Many attempts fail before one works", "Employers often look for recognised certifications"],
    day: "You try to break into a company's website (with their permission) and write up how you did it.",
  },
  "smartphone-videography": {
    id: "smartphone-videography",
    name: "Smartphone Videography",
    programmeSlug: "smart-phone-videography",
    oneLiner: "Shoot and edit videos that look professional, using the phone already in your pocket.",
    love: ["Start with the phone you already have", "Creating videos people stop scrolling for", "Short-form video is in demand everywhere"],
    hard: ["It's a crowded field, so you must stand out", "Editing well takes practice", "Finding steady clients takes time"],
    day: "You film a small business's new product on your phone and edit it into a 30-second reel.",
  },
  cybersecurity: {
    id: "cybersecurity",
    name: "Cybersecurity",
    programmeSlug: "cybersecurity",
    oneLiner: "Protect people, companies and their data from hackers, scams and online threats.",
    love: ["Protecting systems from real threats", "Making a real difference to people's safety online", "Strong demand for people who can do it"],
    hard: ["Threats change constantly, so you keep studying", "Incidents can be high-pressure", "Entry-level certifications help you get hired"],
    day: "You watch for warning signs on a company's network and shut down a suspicious login.",
  },
  "mobile-app": {
    id: "mobile-app",
    name: "Mobile App Development",
    programmeSlug: "mobile-app-development",
    oneLiner: "Build Android and iPhone apps that people carry everywhere and use every day.",
    love: ["Building apps people use every day", "Seeing your app on a real phone", "Combining design with logic"],
    hard: ["Fixing bugs that only appear on certain phones", "Phone software updates keep changing things", "App store rules and reviews take patience"],
    day: "You add a new feature to an app, test it on three different phones and fix what breaks.",
  },
  "content-creation": {
    id: "content-creation",
    name: "Content Creation",
    oneLiner: "Tell stories, grow an audience and turn your creativity into income online.",
    love: ["Freedom to express yourself", "Instant feedback from your audience", "Building your own brand"],
    hard: ["Income is unpredictable at first", "You need to post consistently", "Platform changes can affect your reach"],
    day: "You plan a week of posts, film two of them and reply to comments from your audience.",
  },
  "graphics-design": {
    id: "graphics-design",
    name: "Graphics Design",
    programmeSlug: "graphics-design",
    oneLiner: "Design logos, flyers and social media graphics that make brands look good.",
    love: ["Expressing ideas through visuals", "Seeing your designs out in the real world", "Lots of variety: logos, flyers, social posts"],
    hard: ["Clients often ask for many revisions", "Design trends change constantly", "Building a strong portfolio takes time"],
    day: "You design a logo and flyer for a new business and adjust them after the owner's feedback.",
  },
  "product-management": {
    id: "product-management",
    name: "Product Management",
    programmeSlug: "product-management",
    oneLiner: "Decide what gets built and why, and lead the team that ships it.",
    love: ["Shaping what a product becomes", "Working with designers, developers and customers", "Solving real problems for lots of users"],
    hard: ["Balancing what different people want", "Success depends on the whole team, not just you", "First roles can be competitive without experience"],
    day: "You talk to users, decide which feature the team builds next and explain why.",
  },
  "data-analysis": {
    id: "data-analysis",
    name: "Data Analysis",
    programmeSlug: "data-analysis",
    oneLiner: "Turn messy numbers into clear answers that help businesses make better decisions.",
    love: ["Finding answers hidden in data", "Building charts and dashboards", "Helping businesses decide with facts"],
    hard: ["Cleaning messy data takes a lot of the time", "Some statistics to learn", "Explaining findings to non-technical people"],
    day: "You pull last month's sales into a dashboard and spot which product is losing money.",
  },
  "it-support": {
    id: "it-support",
    name: "IT Support & Technical Operations",
    oneLiner: "Keep computers, networks and systems running, and help people when tech goes wrong.",
    love: ["Helping people solve problems every day", "A practical way into tech", "Every day brings a new puzzle"],
    hard: ["Dealing with frustrated users", "Some problems repeat a lot", "Some roles include on-call shifts"],
    day: "You fix a colleague's laptop, set up the office printer and reset three passwords.",
  },
  "qa-testing": {
    id: "qa-testing",
    name: "QA & Software Testing",
    oneLiner: "Find the bugs before users do, and make sure software works the way it should.",
    love: ["Being the last check before a release", "Structured, step-by-step problem-solving", "A clear path into test automation"],
    hard: ["It can feel repetitive at times", "Pressure when deadlines are tight", "Automation needs some coding"],
    day: "You test a new app update step by step and report the bugs you find to the developers.",
  },
  "ui-ux": {
    id: "ui-ux",
    name: "UI/UX Design",
    programmeSlug: "uiux",
    oneLiner: "Design apps and websites that are easy and pleasant to use.",
    love: ["Designing screens people enjoy using", "Solving user problems creatively", "Watching real people use what you designed"],
    hard: ["Balancing what users want with what the business needs", "Design feedback can feel personal", "You'll often need to defend your ideas"],
    day: "You watch someone struggle with an app, then redesign the screen so it just makes sense.",
  },
  cloud: {
    id: "cloud",
    name: "Cloud Engineering",
    programmeSlug: "cloud-engineering",
    oneLiner: "Set up and run the cloud servers (like AWS) that keep apps online, fast and safe.",
    love: ["Keeping apps online for thousands of people", "Working with tools big companies rely on", "Automating boring work away"],
    hard: ["Lots of services and terms to learn at first", "Outages need calm, quick fixing", "Small mistakes can cost money, so you double-check"],
    day: "You set up the servers for a new app on AWS and make sure it stays up when traffic spikes.",
  },
};

// ---------------------------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------------------------

type Weights = Partial<Record<CareerId, number>>;

export interface QuizOption {
  id: string;
  label: string;
  /** Points per career (0–3). For `qsm` answers: the QSM weights plus QSM_WEIGHT_CHANGES. */
  weights: Weights;
  traits: TraitId[];
  /** Completes "You said you …" on the result page. */
  why: string;
  /** Carried over from QSM (Cloud Engineering is derived, see effectiveWeights). */
  qsm?: boolean;
}

export interface QuizQuestion {
  id: string;
  /** QSM question id this came from, if any. */
  qsmId?: number;
  question: string;
  options: QuizOption[];
}

const q = (id: string, label: string, weights: Weights, traits: TraitId[], why: string): QuizOption => ({ id, label, weights, traits, why, qsm: true });
const added = (id: string, label: string, weights: Weights, traits: TraitId[], why: string): QuizOption => ({ id, label, weights, traits, why });

export const coreQuestions: QuizQuestion[] = [
  {
    id: "q9",
    qsmId: 9,
    question: "Pick the line that sounds most like you:",
    options: [
      q("q9-a", "I have a good eye for what looks good and what doesn't", { frontend: 2, "graphics-design": 3, "ui-ux": 3, "smartphone-videography": 1 }, ["creative"], "have a good eye for what looks good"),
      q("q9-b", "I enjoy figuring out how systems connect and work together", { backend: 3, "mobile-app": 2, "data-analysis": 1, "it-support": 2, "ethical-hacking": 1, cloud: 3 }, ["builder", "analytical"], "enjoy figuring out how systems connect"),
      q("q9-c", "I naturally think about what could go wrong", { "ethical-hacking": 3, cybersecurity: 3, "qa-testing": 3 }, ["protector"], "naturally think about what could go wrong"),
      q("q9-d", "I love telling stories and grabbing people's attention", { "smartphone-videography": 3, "content-creation": 3 }, ["creative", "people"], "love telling stories that grab attention"),
      q("q9-e", "I'm good at seeing the big picture and organising messy things", { backend: 1, "product-management": 3, "data-analysis": 1 }, ["people", "analytical"], "are good at seeing the big picture"),
      q("q9-f", "I like finding patterns and drawing conclusions from information", { "ethical-hacking": 2, "data-analysis": 3 }, ["analytical"], "enjoy finding patterns in information"),
    ],
  },
  {
    id: "q19",
    qsmId: 19,
    question: "You've finished a project. How do you know it's actually good?",
    options: [
      q("q19-a", "It looks polished and professional", { frontend: 2, "graphics-design": 3, "ui-ux": 3, "smartphone-videography": 1 }, ["creative"], "judge your work by how polished it looks"),
      q("q19-b", "It works without errors or crashes", { backend: 3, "mobile-app": 2, "it-support": 2, "qa-testing": 2 }, ["builder"], "judge your work by whether it runs without errors"),
      q("q19-c", "It's secure and can't easily be hacked", { "ethical-hacking": 3, cybersecurity: 3 }, ["protector"], "judge your work by how secure it is"),
      q("q19-d", "People engage with it and share it", { "smartphone-videography": 3, "content-creation": 3, "product-management": 2 }, ["people", "creative"], "judge your work by whether people share it"),
      q("q19-e", "It meets the goals we agreed at the start", { "product-management": 3, "qa-testing": 2 }, ["people"], "judge your work by whether it meets the goals"),
      q("q19-f", "The numbers show it's working", { "product-management": 2, "data-analysis": 3 }, ["analytical"], "judge success by the data"),
    ],
  },
  {
    id: "q14",
    qsmId: 14,
    question: "What matters most to you in your next career?",
    options: [
      q("q14-a", "Creative freedom and expressing myself", { "smartphone-videography": 2, "content-creation": 2, "graphics-design": 2, "ui-ux": 2 }, ["creative"], "want creative freedom"),
      q("q14-b", "Solving problems and technical challenges", { backend: 2, "ethical-hacking": 2, "mobile-app": 2, "data-analysis": 2 }, ["analytical", "builder"], "want technical challenges"),
      q("q14-c", "Job security and a clear path to grow", { cybersecurity: 2, "data-analysis": 1, "it-support": 2, "qa-testing": 2 }, ["protector"], "value job security and a clear path"),
      q("q14-d", "Earning well as my skills grow", { backend: 2, cybersecurity: 2, "mobile-app": 2, "data-analysis": 2 }, ["builder"], "want your earnings to grow with your skills"),
      q("q14-e", "Working remotely, from anywhere", { frontend: 1, backend: 1, "smartphone-videography": 1, "mobile-app": 1, "content-creation": 1, "graphics-design": 1, "data-analysis": 1 }, ["builder"], "want to work from anywhere"),
      q("q14-f", "Making an impact and helping people", { "content-creation": 1, "product-management": 2, "it-support": 2, "ui-ux": 2 }, ["people"], "want to make an impact on people"),
    ],
  },
  {
    id: "q18",
    qsmId: 18,
    question: "Which project sounds most exciting?",
    options: [
      q("q18-a", "Designing a beautiful, easy-to-use app screen", { frontend: 2, "mobile-app": 3, "ui-ux": 3 }, ["creative", "builder"], "would love designing easy-to-use app screens"),
      q("q18-b", "Building a system that handles millions of users smoothly", { backend: 3, cybersecurity: 1, "mobile-app": 2 }, ["builder"], "would love building systems for millions of users"),
      q("q18-c", "Testing a platform for security holes before hackers find them", { "ethical-hacking": 3, cybersecurity: 3 }, ["protector"], "would love hunting for security holes"),
      q("q18-d", "Making a video that tells a story and gets shared everywhere", { "smartphone-videography": 3, "content-creation": 2 }, ["creative"], "would love making videos that get shared"),
      q("q18-e", "Leading a team to launch a product from idea to market", { frontend: 1, backend: 1, "product-management": 3 }, ["people"], "would love leading a product launch"),
      q("q18-f", "Digging into user data to find what drives decisions", { "product-management": 2, "data-analysis": 3 }, ["analytical"], "would love digging into data"),
      added("q18-g", "Keeping websites and apps online and fast for thousands of people", { cloud: 3, frontend: 1, backend: 1 }, ["builder", "protector"], "would love keeping apps online and fast"),
    ],
  },
  {
    id: "q6",
    qsmId: 6,
    question: "Which of these sounds most satisfying?",
    options: [
      q("q6-a", "Building something people can see and use", { frontend: 3, "mobile-app": 2, "graphics-design": 2, "ui-ux": 3 }, ["builder", "creative"], "enjoy building things people can see and use"),
      q("q6-b", "Making systems run smoothly behind the scenes", { backend: 3, cybersecurity: 2, "it-support": 3 }, ["builder"], "enjoy making systems run smoothly"),
      q("q6-c", "Finding weak spots before bad actors do", { "ethical-hacking": 3, cybersecurity: 3 }, ["protector"], "enjoy finding weak spots before bad actors do"),
      q("q6-d", "Creating content that gets people's attention", { "smartphone-videography": 3, "content-creation": 3, "graphics-design": 2 }, ["creative"], "enjoy creating content that gets attention"),
      q("q6-e", "Turning chaos into clear processes", { "product-management": 3, "it-support": 2, "qa-testing": 2 }, ["people", "analytical"], "enjoy turning chaos into clear processes"),
      q("q6-f", "Discovering insights hidden in information", { "ethical-hacking": 1, "data-analysis": 3 }, ["analytical"], "enjoy discovering insights in information"),
      added("q6-g", "Setting up the cloud servers that apps run on", { cloud: 3, frontend: 1, backend: 1 }, ["builder"], "enjoy setting up the servers apps run on"),
    ],
  },
  {
    id: "q7",
    qsmId: 7,
    question: "How do you like to see the results of your work?",
    options: [
      q("q7-a", "Straight away: I love seeing changes instantly", { frontend: 3, "content-creation": 2, "graphics-design": 2, "ui-ux": 2, "smartphone-videography": 1 }, ["creative"], "like seeing results straight away"),
      q("q7-b", "Over time: I'm patient with behind-the-scenes improvements", { backend: 3, cybersecurity: 2, "it-support": 2 }, ["builder"], "are patient with behind-the-scenes work"),
      q("q7-c", "Through prevention: knowing I stopped something bad happening", { "ethical-hacking": 3, cybersecurity: 3 }, ["protector"], "like knowing you stopped something bad happening"),
      q("q7-d", "Through likes, views and comments", { "smartphone-videography": 3, "content-creation": 3 }, ["people", "creative"], "measure results in likes, views and comments"),
      q("q7-e", "Through numbers that show improvement", { "product-management": 2, "data-analysis": 3 }, ["analytical"], "like numbers that show improvement"),
      q("q7-f", "Through quality: fewer bugs, a smoother experience", { backend: 2, "it-support": 2, "qa-testing": 3 }, ["protector", "builder"], "measure results in quality and fewer bugs"),
    ],
  },
  {
    id: "q11",
    qsmId: 11,
    question: "How detail-oriented are you?",
    options: [
      q("q11-a", "Very: I notice small visual mistakes others miss", { frontend: 1, "graphics-design": 3, "ui-ux": 3 }, ["creative"], "notice small visual mistakes others miss"),
      q("q11-b", "Very: I can't rest until every possible problem is covered", { backend: 2, "ethical-hacking": 2, cybersecurity: 2, "qa-testing": 3 }, ["protector"], "can't rest until every problem is covered"),
      q("q11-c", "Moderately: I focus on the details that matter most", { frontend: 2, "mobile-app": 2, "it-support": 2 }, ["builder"], "focus on the details that matter most"),
      q("q11-d", "Not very: I prefer the creative big picture", { "smartphone-videography": 3, "content-creation": 3 }, ["creative"], "prefer the creative big picture"),
      q("q11-e", "Strategic: I know when to zoom in and when to zoom out", { backend: 1, "product-management": 3, "data-analysis": 2 }, ["people", "analytical"], "know when to zoom in and when to zoom out"),
    ],
  },
  {
    id: "q10",
    qsmId: 10,
    question: "Which kind of workplace sounds best?",
    options: [
      q("q10-a", "Creative and visual: colours, layouts and style", { frontend: 2, "graphics-design": 3, "ui-ux": 3, "smartphone-videography": 1 }, ["creative"], "picture a creative, visual workplace"),
      q("q10-b", "Structured and logical: code, systems and how they fit together", { backend: 3, cybersecurity: 2, "mobile-app": 2, "it-support": 2 }, ["builder"], "picture a structured, logical workplace"),
      q("q10-c", "Investigative and protective: security and risk", { "ethical-hacking": 3, cybersecurity: 3 }, ["protector"], "picture an investigative, protective workplace"),
      q("q10-d", "Lively and expressive: cameras, stories and content", { "smartphone-videography": 3, "content-creation": 2 }, ["creative", "people"], "picture a lively workplace full of cameras and stories"),
      q("q10-e", "Team-based and strategic: plans and roadmaps", { "product-management": 3 }, ["people"], "picture a team-based, strategic workplace"),
      q("q10-f", "Data-driven: numbers, charts and insights", { backend: 1, "data-analysis": 3 }, ["analytical"], "picture a data-driven workplace"),
      added("q10-g", "Hands-on with servers and cloud platforms like AWS", { cloud: 3, frontend: 1, backend: 1 }, ["builder"], "picture working hands-on with cloud platforms"),
    ],
  },
  {
    id: "q17",
    qsmId: 17,
    question: "A friend shows you their new app or website. What do you notice first?",
    options: [
      q("q17-a", "How it looks: colours, layout, style", { frontend: 2, "graphics-design": 3, "ui-ux": 3, "smartphone-videography": 1 }, ["creative"], "notice how things look first"),
      q("q17-b", "How it works: the features and how you move around it", { frontend: 2, backend: 1, "mobile-app": 2, "product-management": 2, "ui-ux": 2 }, ["builder"], "notice how things work first"),
      q("q17-c", "What could go wrong: bugs, security problems", { "ethical-hacking": 2, cybersecurity: 2, "qa-testing": 3 }, ["protector"], "spot what could go wrong first"),
      q("q17-d", "The content: the message and the story", { "smartphone-videography": 2, "content-creation": 3, "graphics-design": 1 }, ["creative", "people"], "notice the message and the story first"),
      q("q17-e", "The big question: does it solve a real problem?", { "product-management": 3, "data-analysis": 1, "ui-ux": 2 }, ["people"], "ask whether it solves a real problem"),
    ],
  },
  {
    id: "q3",
    qsmId: 3,
    question: "When something doesn't work well (a confusing app, a slow process, an ugly poster), what's your first instinct?",
    options: [
      q("q3-a", "Think about how to redesign it so it looks better", { "content-creation": 2, "graphics-design": 3, "ui-ux": 3 }, ["creative"], "want to redesign things that look wrong"),
      q("q3-b", "Wonder what's broken behind the scenes and how to fix it", { frontend: 2, backend: 3, "mobile-app": 2, "it-support": 2, "ethical-hacking": 1 }, ["builder"], "want to fix what's broken behind the scenes"),
      q("q3-c", "Think about how someone could attack or abuse it", { "ethical-hacking": 3, cybersecurity: 3 }, ["protector"], "think about how things could be attacked"),
      q("q3-d", "Capture or document the problem creatively", { "smartphone-videography": 3, "content-creation": 3, "graphics-design": 2 }, ["creative"], "want to capture problems creatively"),
      q("q3-e", "Ask why it was built that way and how to improve the process", { "product-management": 3, "qa-testing": 2, "ui-ux": 1 }, ["people"], "ask why things were built that way"),
      q("q3-f", "Look for the data that would prove it's really a problem", { backend: 1, "data-analysis": 3 }, ["analytical"], "look for data that proves the problem"),
    ],
  },
  {
    id: "q13",
    qsmId: 13,
    question: "How much coding are you comfortable with?",
    options: [
      q("q13-a", "A lot: coding is the main thing I want to learn", { backend: 3, "ethical-hacking": 2, cybersecurity: 2, "mobile-app": 3 }, ["builder"], "want coding to be the main thing you learn"),
      q("q13-b", "Some, if it helps me build things", { frontend: 3, "mobile-app": 2, "data-analysis": 2 }, ["builder"], "are happy to code if it helps you build"),
      q("q13-c", "Very little: I prefer visual and creative tools", { "smartphone-videography": 3, "content-creation": 3, "graphics-design": 3, "ui-ux": 3 }, ["creative"], "prefer visual, creative tools to code"),
      q("q13-d", "I want to understand code, but not write it all day", { "product-management": 3, "data-analysis": 1, "it-support": 2, "qa-testing": 2 }, ["people", "analytical"], "want to understand code without writing it all day"),
      q(
        "q13-e",
        "Whatever the role needs",
        { frontend: 1, backend: 1, "ethical-hacking": 1, "smartphone-videography": 1, cybersecurity: 1, "mobile-app": 1, "content-creation": 1, "graphics-design": 1, "product-management": 1, "data-analysis": 1, "it-support": 1, "qa-testing": 1, "ui-ux": 1 },
        ["builder"],
        "are open to whatever coding the role needs",
      ),
    ],
  },
  {
    id: "saturday",
    question: "Which of these would you rather spend a Saturday figuring out?",
    options: [
      added("saturday-a", "Setting up a home Wi-Fi network so every device works", { cloud: 3, "it-support": 3 }, ["builder"], "would spend a Saturday setting up a network"),
      added("saturday-b", "Making a short video that gets shared in group chats", { "smartphone-videography": 3 }, ["creative"], "would spend a Saturday making a video people share"),
      added("saturday-c", "Designing a flyer for a friend's business", { "graphics-design": 3, "ui-ux": 1 }, ["creative"], "would spend a Saturday designing a flyer"),
      added("saturday-d", "Planning how a new app should work, screen by screen", { "ui-ux": 2, "product-management": 2, "mobile-app": 1 }, ["people", "creative"], "would spend a Saturday planning an app screen by screen"),
      added("saturday-e", "Working out from receipts where the money is going", { "data-analysis": 3 }, ["analytical"], "would spend a Saturday working out where the money goes"),
      added("saturday-f", "Finding out if your phone has been hacked", { cybersecurity: 3 }, ["protector"], "would spend a Saturday checking if a phone was hacked"),
      added("saturday-g", "Building a simple website for a church or club", { frontend: 3, backend: 3, "mobile-app": 1 }, ["builder"], "would spend a Saturday building a website"),
    ],
  },
];

/**
 * Cloud Engineering is new in v2. Besides its own options, every QSM answer gives it points
 * from the Backend and IT Support labels at their weight minus one (minimum 0).
 */
export function effectiveWeights(option: QuizOption): Weights {
  if (!option.qsm) return option.weights;
  const derived = Math.max(0, (option.weights.backend ?? 0) - 1, (option.weights["it-support"] ?? 0) - 1);
  const cloud = Math.max(option.weights.cloud ?? 0, derived);
  return cloud > 0 ? { ...option.weights, cloud } : option.weights;
}

/**
 * Every place where a kept QSM answer's weights differ from the original ([QSM, v2]).
 * Normalising alone did not balance the old weights: QA & Testing, IT Support and Product
 * Management picked up 1–2 "ride-along" points on many other careers' answers, so with random
 * answers QA won ~10× more often than Smartphone Videography. These edits remove most
 * ride-alongs and split near-identical pairs (Videography vs Content Creation, Graphics vs
 * UI/UX) so each career can be told apart. quiz.test.ts fails if any other weight drifts from
 * the QSM source, and checks the resulting balance. (The new Saturday question also gives IT
 * Support 3 for the Wi-Fi answer alongside Cloud.)
 */
export const QSM_WEIGHT_CHANGES: Record<string, Partial<Record<CareerId, [number, number]>>> = {
  "q9-a": { "smartphone-videography": [0, 1] },
  "q9-b": { "ethical-hacking": [0, 1], cloud: [0, 3] },
  "q9-d": { "product-management": [1, 0] },
  "q9-e": { "data-analysis": [2, 1], "qa-testing": [1, 0] },
  "q9-f": { "qa-testing": [1, 0] },
  "q19-a": { "smartphone-videography": [0, 1] },
  "q19-e": { "it-support": [1, 0] },
  "q18-a": { "mobile-app": [2, 3] },
  "q18-c": { "qa-testing": [2, 0] },
  "q18-d": { "content-creation": [3, 2] },
  "q6-c": { "qa-testing": [2, 0] },
  "q7-a": { "smartphone-videography": [0, 1] },
  "q7-c": { "qa-testing": [2, 0] },
  "q7-d": { "product-management": [1, 0] },
  "q7-e": { "qa-testing": [2, 0] },
  "q11-a": { "qa-testing": [2, 0] },
  "q11-c": { "data-analysis": [2, 0] },
  "q11-d": { "product-management": [1, 0] },
  "q10-a": { "smartphone-videography": [0, 1] },
  "q10-c": { "qa-testing": [2, 0] },
  "q10-d": { "content-creation": [3, 2] },
  "q10-e": { "it-support": [1, 0], "qa-testing": [1, 0] },
  "q10-f": { "product-management": [1, 0] },
  "q17-a": { "smartphone-videography": [0, 1] },
  "q17-b": { "ui-ux": [0, 2] },
  "q17-d": { "product-management": [1, 0], "graphics-design": [0, 1] },
  "q3-b": { "ethical-hacking": [0, 1] },
  "q3-c": { "qa-testing": [1, 0] },
  "q3-e": { "it-support": [1, 0], "ui-ux": [0, 1] },
  "q3-f": { "qa-testing": [2, 0] },
};

// ---------------------------------------------------------------------------------------------
// Context questions (same values as Apply step 3; they don't change the match scores)
// ---------------------------------------------------------------------------------------------

export const CONTEXT_QUESTIONS = [
  {
    id: "currentStatus",
    question: "Right now I am:",
    options: [
      { id: "student", label: "Student" },
      { id: "graduate_nysc", label: "Graduate or NYSC" },
      { id: "working_switch", label: "Working, want to switch" },
      { id: "not_working", label: "Not working" },
    ],
  },
  {
    id: "device",
    question: "I'll learn on:",
    options: [
      { id: "laptop", label: "Laptop" },
      { id: "phone_only", label: "Phone only for now" },
      { id: "both", label: "Both" },
    ],
  },
  {
    id: "weeklyHours",
    question: "Time I can give weekly:",
    options: [
      { id: "under_5", label: "Under 5 hrs" },
      { id: "5_8", label: "5–8 hrs" },
      { id: "8_plus", label: "8+ hrs" },
    ],
  },
] as const;

export type ContextKey = (typeof CONTEXT_QUESTIONS)[number]["id"];
export interface QuizContext {
  currentStatus: "student" | "graduate_nysc" | "working_switch" | "not_working";
  device: "laptop" | "phone_only" | "both";
  weeklyHours: "under_5" | "5_8" | "8_plus";
}

/** 12 core + 3 context taps (the tie-breaker is an occasional extra). */
export const QUIZ_TAPS = coreQuestions.length + CONTEXT_QUESTIONS.length;

// ---------------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------------

/** Question id → option id for the 12 core questions. */
export type QuizAnswers = Record<string, string>;

export interface CareerScore {
  career: CareerId;
  /** 0–100, rounded. */
  percent: number;
  /** Unrounded share, used for sorting and the tie-breaker. */
  exact: number;
  earned: number;
  max: number;
}

export type MatchLabel = "Strong match" | "Good match" | "Worth exploring";

export function matchLabel(percent: number): MatchLabel {
  if (percent >= 75) return "Strong match";
  if (percent >= 60) return "Good match";
  return "Worth exploring";
}

/** If the top two are this close (percentage points), ask the tie-breaker. */
export const TIE_BREAKER_GAP = 5;
/** Percentage points added to the tie-breaker winner (capped at 100). */
export const TIE_BREAKER_BONUS = 3;

const careerOrder = new Map<CareerId, number>(CAREER_IDS.map((id, index) => [id, index]));
const optionIndex = new Map<string, Map<string, QuizOption>>(
  coreQuestions.map((question) => [question.id, new Map(question.options.map((option) => [option.id, option]))]),
);

/** The maximum each career could earn across the core questions. */
export const careerMaxima: Record<CareerId, number> = (() => {
  const maxima = Object.fromEntries(CAREER_IDS.map((id) => [id, 0])) as Record<CareerId, number>;
  for (const question of coreQuestions) {
    for (const id of CAREER_IDS) {
      maxima[id] += Math.max(0, ...question.options.map((option) => effectiveWeights(option)[id] ?? 0));
    }
  }
  return maxima;
})();

const sortScores = (scores: CareerScore[]) =>
  scores.sort((a, b) => b.exact - a.exact || b.earned - a.earned || (careerOrder.get(a.career) ?? 0) - (careerOrder.get(b.career) ?? 0));

/** Raw match scores for an answer set (no tie-breaker), sorted best first. */
export function scoreCareers(answers: QuizAnswers): CareerScore[] {
  const earned = Object.fromEntries(CAREER_IDS.map((id) => [id, 0])) as Record<CareerId, number>;
  for (const question of coreQuestions) {
    const option = optionIndex.get(question.id)?.get(answers[question.id] ?? "");
    if (!option) continue;
    for (const [career, points] of Object.entries(effectiveWeights(option)) as Array<[CareerId, number]>) earned[career] += points;
  }
  return sortScores(
    CAREER_IDS.map((career) => {
      const max = careerMaxima[career];
      const exact = max ? Math.min(100, (earned[career] / max) * 100) : 0;
      return { career, exact, percent: Math.round(exact), earned: earned[career], max };
    }),
  );
}

/** The two careers to pit against each other, or null when the top two aren't close. */
export function tieBreakerPair(scores: CareerScore[]): [CareerId, CareerId] | null {
  const [first, second] = scores;
  if (!first || !second || first.exact - second.exact > TIE_BREAKER_GAP) return null;
  return [first.career, second.career];
}

export interface QuizResult {
  quizVersion: typeof QUIZ_VERSION;
  scores: CareerScore[];
  traits: Record<TraitId, number>;
  topMatch: CareerId;
  /** The tie-breaker that was applied, if any. */
  tieBreaker: { pair: [CareerId, CareerId]; winner: CareerId } | null;
}

/** Full result: scores (with the tie-breaker bonus, if one was asked and answered) and traits. */
export function scoreQuiz(answers: QuizAnswers, tieBreakerWinner?: string | null): QuizResult {
  const scores = scoreCareers(answers);
  const pair = tieBreakerPair(scores);
  let tieBreaker: QuizResult["tieBreaker"] = null;
  if (pair && tieBreakerWinner && (pair as string[]).includes(tieBreakerWinner)) {
    const winner = tieBreakerWinner as CareerId;
    const score = scores.find((item) => item.career === winner)!;
    score.exact = Math.min(100, score.exact + TIE_BREAKER_BONUS);
    score.percent = Math.round(score.exact);
    sortScores(scores);
    tieBreaker = { pair, winner };
  }
  return { quizVersion: QUIZ_VERSION, scores, traits: scoreTraits(answers), topMatch: scores[0]!.career, tieBreaker };
}

export function scoreTraits(answers: QuizAnswers): Record<TraitId, number> {
  const earned = Object.fromEntries(TRAIT_IDS.map((id) => [id, 0])) as Record<TraitId, number>;
  const max = Object.fromEntries(TRAIT_IDS.map((id) => [id, 0])) as Record<TraitId, number>;
  for (const question of coreQuestions) {
    for (const trait of TRAIT_IDS) if (question.options.some((option) => option.traits.includes(trait))) max[trait] += 1;
    const option = optionIndex.get(question.id)?.get(answers[question.id] ?? "");
    for (const trait of option?.traits ?? []) earned[trait] += 1;
  }
  return Object.fromEntries(TRAIT_IDS.map((id) => [id, max[id] ? Math.round((earned[id] / max[id]) * 100) : 0])) as Record<TraitId, number>;
}

/** The two strongest traits, highest first. */
export function topTraits(traits: Record<TraitId, number>): [TraitId, TraitId] {
  const sorted = [...TRAIT_IDS].sort((a, b) => traits[b] - traits[a] || TRAIT_IDS.indexOf(a) - TRAIT_IDS.indexOf(b));
  return [sorted[0]!, sorted[1]!];
}

/**
 * "You said you … and …": the two answers that gave the most points to this career (ties go to
 * the earlier question). Null if fewer than one answer contributed.
 */
export function whyLine(answers: QuizAnswers, career: CareerId): string | null {
  const contributions: Array<{ why: string; points: number; order: number }> = [];
  coreQuestions.forEach((question, order) => {
    const option = optionIndex.get(question.id)?.get(answers[question.id] ?? "");
    const points = option ? effectiveWeights(option)[career] ?? 0 : 0;
    if (option && points > 0) contributions.push({ why: option.why, points, order });
  });
  contributions.sort((a, b) => b.points - a.points || a.order - b.order);
  const [first, second] = contributions;
  if (!first) return null;
  return second ? `You said you ${first.why} and ${second.why}.` : `You said you ${first.why}.`;
}

// ---------------------------------------------------------------------------------------------
// Validation (used by the server; never trust client scores)
// ---------------------------------------------------------------------------------------------

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateAnswers(input: unknown): ValidationResult<QuizAnswers> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Answers are missing." };
  const record = input as Record<string, unknown>;
  const answers: QuizAnswers = {};
  for (const question of coreQuestions) {
    const value = record[question.id];
    if (typeof value !== "string" || !optionIndex.get(question.id)?.has(value)) return { ok: false, error: `Missing or unknown answer for ${question.id}.` };
    answers[question.id] = value;
  }
  const unknown = Object.keys(record).filter((key) => !optionIndex.has(key));
  if (unknown.length) return { ok: false, error: "Unknown question." };
  return { ok: true, value: answers };
}

export function validateContext(input: unknown): ValidationResult<QuizContext> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Context answers are missing." };
  const record = input as Record<string, unknown>;
  for (const question of CONTEXT_QUESTIONS) {
    const value = record[question.id];
    if (typeof value !== "string" || !question.options.some((option) => option.id === value)) return { ok: false, error: `Missing or unknown answer for ${question.id}.` };
  }
  return { ok: true, value: { currentStatus: record.currentStatus, device: record.device, weeklyHours: record.weeklyHours } as QuizContext };
}

export function isCareerId(value: unknown): value is CareerId {
  return typeof value === "string" && careerOrder.has(value as CareerId);
}

// ---------------------------------------------------------------------------------------------
// Open / waitlist status (resolved at runtime from the published catalogue)
// ---------------------------------------------------------------------------------------------

export type CareerStatus = "open" | "waitlist";

/** Open when the career has a programme slug and that course is published; otherwise waitlist. */
export function careerStatus(career: CareerId, publishedSlugs: ReadonlySet<string>): CareerStatus {
  const slug = careers[career].programmeSlug;
  return slug && publishedSlugs.has(slug) ? "open" : "waitlist";
}

/** The highest-ranked open career, or null if none is open. */
export function topOpenMatch(scores: CareerScore[], publishedSlugs: ReadonlySet<string>): CareerScore | null {
  return scores.find((score) => careerStatus(score.career, publishedSlugs) === "open") ?? null;
}

// ---------------------------------------------------------------------------------------------
// Answer order (shuffled per question, seeded per session so Back doesn't reshuffle)
// ---------------------------------------------------------------------------------------------

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function shuffleWithSeed<T>(items: readonly T[], seed: string): T[] {
  let state = hashString(seed) || 1;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap]!, out[index]!];
  }
  return out;
}
