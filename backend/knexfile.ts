import type { Knex } from 'knex';
import path from 'path';

const config: Knex.Config = {
  client: 'sqlite3',
  connection: {
    filename: path.resolve(__dirname, 'data/db.sqlite'),
  },
  useNullAsDefault: true,
  migrations: {
    directory: path.resolve(__dirname, 'migrations'),
  },
};

export default config;