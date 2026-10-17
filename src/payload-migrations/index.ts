import * as migration_20261010_224035_initial_schema from './20261010_224035_initial_schema.js';
import * as migration_20261013_120000_course_tree_joins from './20261013_120000_course_tree_joins.js';
import * as migration_20261014_080000_newsletter_subscribers from './20261014_080000_newsletter_subscribers.js';
import * as migration_20261015_120000_rebuild_leads_pricing from './20261015_120000_rebuild_leads_pricing.js';
import * as migration_20261016_090000_laptop_applications from './20261016_090000_laptop_applications.js';
import * as migration_20261016_150000_plan_kind from './20261016_150000_plan_kind.js';
import * as migration_20261017_090000_email_lifecycle from './20261017_090000_email_lifecycle.js';

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
];
