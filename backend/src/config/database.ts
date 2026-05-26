import knex from 'knex';

const dbPath = process.env.DB_PATH || '/app/data/indexmon.db';

const db = knex({
  client: 'better-sqlite3',
  connection: {
    filename: dbPath,
  },
  useNullAsDefault: true,
});

export { db as knex };