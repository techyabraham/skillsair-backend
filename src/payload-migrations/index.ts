import * as migration_20261010_224035_initial_schema from './20261010_224035_initial_schema.js';
import * as migration_20261013_120000_course_tree_joins from './20261013_120000_course_tree_joins.js';

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
];
