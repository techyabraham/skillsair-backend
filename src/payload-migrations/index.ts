import * as migration_20261010_224035_initial_schema from './20261010_224035_initial_schema.js';
import * as migration_20261013_120000_course_tree_joins from './20261013_120000_course_tree_joins.js';
import * as migration_20261014_080000_newsletter_subscribers from './20261014_080000_newsletter_subscribers.js';

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
];
