import * as migration_20261010_224035_initial_schema from './20261010_224035_initial_schema.js';
import * as migration_20261013_120000_course_tree_joins from './20261013_120000_course_tree_joins.js';
import * as migration_20261014_080000_newsletter_subscribers from './20261014_080000_newsletter_subscribers.js';
import * as migration_20261015_120000_rebuild_leads_pricing from './20261015_120000_rebuild_leads_pricing.js';
import * as migration_20261016_090000_laptop_applications from './20261016_090000_laptop_applications.js';
import * as migration_20261016_150000_plan_kind from './20261016_150000_plan_kind.js';
import * as migration_20261017_090000_email_lifecycle from './20261017_090000_email_lifecycle.js';
import * as migration_20261018_090000_email_content from './20261018_090000_email_content.js';
import * as migration_20261018_120000_message_outcomes from './20261018_120000_message_outcomes.js';
import * as migration_20261019_090000_display_titles from './20261019_090000_display_titles.js';
import * as migration_20261020_090000_subscription_billing from './20261020_090000_subscription_billing.js';
import * as migration_20261022_090000_lesson_resources from './20261022_090000_lesson_resources.js';
import * as migration_20261022_100000_bonus_courses from './20261022_100000_bonus_courses.js';
import * as migration_20261023_090000_learning_quality_foundations from './20261023_090000_learning_quality_foundations.js';
import * as migration_20261023_100000_lesson_captions from './20261023_100000_lesson_captions.js';
import * as migration_20261023_110000_certificate_exam from './20261023_110000_certificate_exam.js';
import * as migration_20261023_120000_scale_indexes from './20261023_120000_scale_indexes.js';
import * as migration_20261025_090000_guided_plan from './20261025_090000_guided_plan.js';
import * as migration_20261025_100000_email_overrides from './20261025_100000_email_overrides.js';
import * as migration_20261027_090000_guided_plan_days from './20261027_090000_guided_plan_days.js';
import * as migration_20261028_045139_ambassadors_foundation from './20261028_045139_ambassadors_foundation.js';

export const migrations = [
  {
    up: migration_20261010_224035_initial_schema.up,
    down: migration_20261010_224035_initial_schema.down,
    name: '20261010_224035_initial_schema'
  },
  {
    up: migration_20261013_120000_course_tree_joins.up,
    down: migration_20261013_120000_course_tree_joins.down,
    name: '20261013_120000_course_tree_joins'
  },
  {
    up: migration_20261014_080000_newsletter_subscribers.up,
    down: migration_20261014_080000_newsletter_subscribers.down,
    name: '20261014_080000_newsletter_subscribers'
  },
  {
    up: migration_20261015_120000_rebuild_leads_pricing.up,
    down: migration_20261015_120000_rebuild_leads_pricing.down,
    name: '20261015_120000_rebuild_leads_pricing'
  },
  {
    up: migration_20261016_090000_laptop_applications.up,
    down: migration_20261016_090000_laptop_applications.down,
    name: '20261016_090000_laptop_applications'
  },
  {
    up: migration_20261016_150000_plan_kind.up,
    down: migration_20261016_150000_plan_kind.down,
    name: '20261016_150000_plan_kind'
  },
  {
    up: migration_20261017_090000_email_lifecycle.up,
    down: migration_20261017_090000_email_lifecycle.down,
    name: '20261017_090000_email_lifecycle'
  },
  {
    up: migration_20261018_090000_email_content.up,
    down: migration_20261018_090000_email_content.down,
    name: '20261018_090000_email_content'
  },
  {
    up: migration_20261018_120000_message_outcomes.up,
    down: migration_20261018_120000_message_outcomes.down,
    name: '20261018_120000_message_outcomes'
  },
  {
    up: migration_20261019_090000_display_titles.up,
    down: migration_20261019_090000_display_titles.down,
    name: '20261019_090000_display_titles'
  },
  {
    up: migration_20261020_090000_subscription_billing.up,
    down: migration_20261020_090000_subscription_billing.down,
    name: '20261020_090000_subscription_billing'
  },
  {
    up: migration_20261022_090000_lesson_resources.up,
    down: migration_20261022_090000_lesson_resources.down,
    name: '20261022_090000_lesson_resources'
  },
  {
    up: migration_20261022_100000_bonus_courses.up,
    down: migration_20261022_100000_bonus_courses.down,
    name: '20261022_100000_bonus_courses'
  },
  {
    up: migration_20261023_090000_learning_quality_foundations.up,
    down: migration_20261023_090000_learning_quality_foundations.down,
    name: '20261023_090000_learning_quality_foundations'
  },
  {
    up: migration_20261023_100000_lesson_captions.up,
    down: migration_20261023_100000_lesson_captions.down,
    name: '20261023_100000_lesson_captions'
  },
  {
    up: migration_20261023_110000_certificate_exam.up,
    down: migration_20261023_110000_certificate_exam.down,
    name: '20261023_110000_certificate_exam'
  },
  {
    up: migration_20261023_120000_scale_indexes.up,
    down: migration_20261023_120000_scale_indexes.down,
    name: '20261023_120000_scale_indexes'
  },
  {
    up: migration_20261025_090000_guided_plan.up,
    down: migration_20261025_090000_guided_plan.down,
    name: '20261025_090000_guided_plan'
  },
  {
    up: migration_20261025_100000_email_overrides.up,
    down: migration_20261025_100000_email_overrides.down,
    name: '20261025_100000_email_overrides'
  },
  {
    up: migration_20261027_090000_guided_plan_days.up,
    down: migration_20261027_090000_guided_plan_days.down,
    name: '20261027_090000_guided_plan_days'
  },
  {
    up: migration_20261028_045139_ambassadors_foundation.up,
    down: migration_20261028_045139_ambassadors_foundation.down,
    name: '20261028_045139_ambassadors_foundation'
  },
];
