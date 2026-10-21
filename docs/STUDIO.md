# SkillsAir Studio (Payload admin)

SkillsAir Studio is the Payload admin panel (`Dockerfile.admin`, e.g. `cms.skillsair.com/admin`) restyled and extended for the SkillsAir team. It changes only the admin experience. Collection data, access rules, hooks, endpoints and jobs are unchanged. The one exception is the `displayTitle` field described below.

## Where things live

| Area | Files |
|---|---|
| Theme source of truth | `scripts/admin-theme.config.mjs` (brand anchors, tokens, contrast pairs) |
| Generated theme | `src/app/(payload)/styles/tokens.css`, `theme.css` (from `npm run admin:theme`; do not edit by hand) |
| Styles index | `src/app/(payload)/admin.css` imports fonts, tokens, theme, Payload overrides, then the Studio styles |
| Navigation | `src/admin/nav/` (custom `Nav`, built on Payload's own NavWrapper, NavGroup and Logout) and `src/admin/studio-config.ts` (groups and order) |
| Brand | `src/admin/brand/StudioBrand.tsx` (icon, wordmark, Adire pattern, login panel) |
| Component library | `src/admin/ui/` (cards, stat cards, pills, charts, countdown, tabs, timeline, chat bubbles…) |
| Data layer | `src/admin/data/` (`metrics.ts`, `queue.ts`, `lifecycle.ts`, `nav.ts`, role checks in `auth.ts`, 60-second cache in `cache.ts`, per-page batching in `batch.ts`) |
| Views | `src/admin/views/` (Overview, Imisi's queue, Lifecycle emails, Studio guide, Studio kit) |
| List cells and strips | `src/admin/cells/cells.tsx`, `src/admin/lists/strips.tsx` |
| Edit-view panels | `src/admin/edit/` (applicant profile and tabs, programme outline, pricing and checklist, Learner 360, scholarship window panel, laptop story) |
| Command bar and ribbon | `src/admin/command/` |

Every custom view and panel checks the role on the server (`initPageResult.req.user` or `req.user`). Business numbers, the queue and lifecycle stats are for admins only. Instructors get their own Overview (their programmes only) and see "Not available for your role" on admin pages.

## Scripts

| Command | What it does |
|---|---|
| `npm run admin:theme` | Regenerates `tokens.css` and `theme.css` from `scripts/admin-theme.config.mjs` (OKLCH ramps). |
| `npm run admin:contrast` | WCAG contrast check of every text/surface pair in light and dark. Runs first in `npm run admin:build` and fails the build below 4.5:1 (3:1 for large text and UI). |
| `npm test` | Includes `src/admin/data/metrics.test.ts` (Lagos-day buckets, periods, working hours, conversion maths, formatting). |
| `node --loader ts-node/esm scripts/studio-metrics-check.ts` | Compares Overview numbers with independent Local API counts and measures the Overview's database round trips (budget 8) and time. Read-only. |
| `node scripts/studio-e2e.mjs` | Browser checks: mark done updates the queue and badge, command bar, instructor refusals, 390px queue targets. Needs `STUDIO_URL`, `STUDIO_QA_EMAIL/PASSWORD` and optionally `STUDIO_QA_INSTRUCTOR_EMAIL/PASSWORD`. Local or staging only. |
| `node scripts/studio-qa.mjs [--axe]` | Screenshots (light/dark × 1440/390) and axe checks of the key screens. Local or staging only. |
| `node --loader ts-node/esm scripts/seed-studio-demo.ts --yes-local` | **Local only.** Seeds demo applicants, learners, payments and messages (all `@studio-demo.test`) and a demo instructor. Refuses to run unless the database is on localhost and no email/WhatsApp keys are set. Never run it against staging or production. |

`playwright-core` and `@axe-core/playwright` use the installed Chrome (`channel: 'chrome'`); nothing is downloaded.

## Environment

| Variable | Effect |
|---|---|
| `STUDIO_ENV_LABEL` | Shows an amber ribbon above the header (for example `STAGING`). With no label, the ribbon shows `DEVELOPMENT` outside production and nothing in production. |
| `CORS_ORIGINS` | Must include the admin's own origin (for example `https://cms.skillsair.com`). Payload only trusts the session cookie on requests from listed origins, so Imisi's Reply and Mark done buttons return 403 without it. |
| `FRONTEND_URL` | Used by "View on site" on programmes. |
| `ACCESS_GRACE_DAYS`, `CERTIFICATE_PRICE_NGN`, `LIFECYCLE_DRY_RUN`, `LIFECYCLE_LIVE_TRACKS` | Read as before. Studio shows them (grace dates, certificate price in the admin pricing summary, dry-run banner). |

Imisi's working hours (Mon–Sat 9–6 WAT) are in `src/admin/studio-config.ts` (`WORKING_HOURS`).

## Data change: `displayTitle`

Enrolments, subscriptions, messages, reviews, discussions, laptop applications, access extensions, lesson progress, quiz attempts, referrals and affiliates have a hidden, read-only `displayTitle` text field, used as the record title (for example "Ada Obi · Data Analysis · ₦2,000/mo"). A field-level `beforeChange` hook fills it (`src/hooks/display-title.ts`), and migration `20261019_090000_display_titles` adds the column and backfills existing rows. It adds one field to those collections' API responses and changes no existing field.

## Payload class overrides

These selectors target Payload 3.85.1's own classes. Recheck them after upgrading Payload.

- **Theme variables** (in `@layer payload`): `--theme-elevation-*`, `--color-base-*`, `--color-success|warning|error|blue-*`, `--theme-bg`, `--theme-input-bg`, `--theme-text`, `--theme-overlay`, `--theme-border-color`, `--style-radius-s|m|l`, `--font-body`, `--font-mono`, `--nav-width`, `--accessibility-outline`.
- **Buttons:** `.btn`, `.btn--style-primary` (and `.btn--disabled`), `.btn--style-secondary` (through `--bg-color`, `--color`, `--hover-bg`, `--hover-color`, `--btn-border`).
- **Header:** `.app-header`, `.step-nav`, `.template-default__nav-toggler-wrapper .hamburger`, `.template-default--nav-open` (read through `body:has(...)`).
- **Nav:** `.nav`, `.nav__scroll` (`--nav-padding-*`), `.nav__wrap`, `.nav__header` (width), `.nav__controls`, `.nav__mobile-close`, `.nav__link`, `.nav__link-indicator`, `.nav__link-label`, `.nav-group`, `.nav-group__toggle`, `.nav-group__label`, `.nav-group__indicator`, `.settings-menu-button`.
- **Lists and tables:** `.table` (thead, odd-row striping, hover), `.pill`, `.pagination`, `.per-page`, `.list-header__title`, `.collection-list__title`.
- **Forms and documents:** `.field-type input|textarea|select`, `.react-select .rs__control`, `.field-description`, `.view-description`, `.doc-header__title`, `.render-title`.
- **Overlays:** `.drawer__content`, `.popup__content`, `.payload-toast-container .payload-toast-item`.
- **Screens:** `.template-minimal`, `.login.template-minimal`, `.login__brand` (hidden; the login panel shows the logo), `.not-found__wrap`, `.not-found__content`.
- **Media:** `.thumbnail-card`, `.thumbnail`.
- **Behaviour:** `NavDefaultOpen` (`src/admin/nav/NavDefaultOpen.tsx`) reopens the sidebar above 1024px because Payload closes it at every width up to 1440px. It depends on `useNav` and `useWindowInfo` breakpoints.
