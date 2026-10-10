import * as migration_20261010_224035_initial_schema from './20261010_224035_initial_schema.js';

export const migrations = [
  {
    up: migration_20261010_224035_initial_schema.up,
    down: migration_20261010_224035_initial_schema.down,
    name: '20261010_224035_initial_schema'
  },
];
