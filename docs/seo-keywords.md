# SEO keywords and programme copy

How each programme page targets search, and the rules the content lint (`npm run content:lint`, the Studio
"Learning quality" panel and the save check on pack-managed programmes) enforces. Programme copy is
written in content packs (`programme.json`) and imported with `npm run content:import`.

## Rules (enforced by `src/lib/content-lint.ts`)

| Field | Rule | Level |
| --- | --- | --- |
| SEO title (`meta.title`) | ≤ 60 characters, contains the primary keyword, keyword first, ends "· SkillsAir" | error / warnings |
| Meta description (`meta.description`) | 140–155 characters, includes the primary keyword | error / warning |
| Short description | ≤ 160 characters | error |
| Description | 600–900 words; primary keyword in the first sentence and one heading; not stuffed (about 3 uses per 600 words) | error / warning |
| Objectives | 6–8, each ≤ 120 characters, phrased "… so you can …" | error / warning |
| Requirements | 3–6 | error |
| Who it's for | 3–4 lines | warning |
| Career paths | 3–5 honest role titles, no salary promises | warning |
| FAQ | 4–6 questions (also published as FAQPage structured data) | error |
| Everywhere | No levels ("beginner", "advanced" …), no prices, no job or income guarantees, British spelling | error / warning |

`primaryKeyword` and `secondaryKeywords` are admin-only fields: they never reach the public API.
Programmes with a primary keyword are "pack-managed": a Studio save that breaks an error rule is
blocked until it is fixed (content imports and History restores skip that check).

## What the page publishes

- `<title>` and meta description from `meta.title` / `meta.description` (falls back to the programme title and short description).
- Canonical `https://skillsair.com/programmes/<slug>`; Open Graph and Twitter cards with a generated 1200 × 630 image (`opengraph-image.tsx`).
- JSON-LD: `Course` (teaches = objectives, coursePrerequisites = requirements, about = tools; no `educationalLevel`), `BreadcrumbList` (Schools → school → programme) and `FAQPage` (the programme's own FAQ first, then the general ones shown on the page).
- Sitemap `lastmod` from each programme's last CMS edit; a school's `lastmod` is its newest programme.

## Keyword plan

Primary keywords target "learn X" / "X course" searches from Nigeria. The volumes behind these
choices were not measured here: confirm each in Google Search Console (Performance → Queries,
country Nigeria) and Keyword Planner before a pack is written, and revisit quarterly.

| Programme (slug) | Primary keyword | Secondary keywords |
| --- | --- | --- |
| `data-analysis` | data analysis course | learn data analysis online, Excel and Power BI course, SQL for data analysis, data analyst training Nigeria |
| `cybersecurity` | cybersecurity course | learn cybersecurity online, ethical hacking course, network security training, cybersecurity for beginners Nigeria |
| `graphics-design` | graphic design course | learn graphic design online, Photoshop and Illustrator course, CorelDRAW training, logo design course |
| `website-development-full-stack` | web development course | full stack web development, learn HTML CSS JavaScript, React course, website design training Nigeria |
| `cloud-engineering` | cloud engineering course | AWS course online, cloud computing training, DevOps basics, Linux for cloud |
| `product-management` | product management course | learn product management, product manager training, Agile and Scrum course |
| `uiux` | UI/UX design course | learn UI UX design online, Figma course, user research training, product design course |
| `mobile-app-development` | mobile app development course | learn app development, Flutter course, Android app development, build mobile apps |
| `smart-phone-videography` | smartphone videography course | mobile video editing course, learn videography with your phone, CapCut course, content creation course |
| `freelancers-academy` (bonus) | freelancing course | how to start freelancing, Upwork and Fiverr training, freelance clients, remote work skills |

Notes:

- One primary keyword per programme; never target the same primary keyword on two pages.
- "Nigeria" belongs in secondary phrases and natural copy, not stuffed into titles.
- The prompt's honesty rules win over keywords: no "guaranteed job", no salary figures, no level words.
