# Content packs

One folder per programme slug. Each holds:

- `questions.json`: chapter-quiz and final-exam questions, each tied to a lesson by its Google Drive file ID.
- `programme.json`: the programme page copy (SEO title, meta description, description, objectives, FAQ…).

| Programme | Questions | Chapter pool | Exam pool |
| --- | --- | --- | --- |
| `cloud-engineering` | 308 | 204 | 104 |
| `cybersecurity` | 254 | 152 | 102 |
| `data-analysis` | 157 | 79 | 102 |
| `freelancers-academy` | 60 | 60 | none (free bonus course) |
| `graphics-design` | 369 | 264 | 105 |
| `mobile-app-development` | 247 | 146 | 101 |
| `product-management` | 235 | 132 | 103 |
| `smart-phone-videography` | 177 | 97 | 102 |
| `uiux` | 190 | 108 | 102 |
| `website-development-full-stack` | 262 | 156 | 106 |

## Loading them

Run after the Drive curriculum import (the importer matches questions to lessons by Drive file ID):

```bash
npm run content:lint -- --pack content/packs/data-analysis/programme.json   # optional: lint one pack's copy
npm run content:import -- --all                    # dry run: shows what would change
npm run content:import -- --all --execute          # creates the chapter quizzes and final exams, updates programme pages
```

Re-running is safe: only changed questions are updated, and questions removed from a pack are retired, not deleted.
Every exam pool has at least 100 questions, so each final exam (40 questions drawn per attempt) publishes
whatever the programme's total video duration.
