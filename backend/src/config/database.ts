import knex from 'knex';

export const dbPath = process.env.DB_PATH || '/app/data/indexmon.db';

const db = knex({
  client: 'better-sqlite3',
  connection: {
    filename: dbPath,
  },
  useNullAsDefault: true,
  pool: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterCreate: (conn: any, cb: any) => {
      conn.pragma('journal_mode = WAL');
      conn.pragma('busy_timeout = 5000');
      cb();
    },
  },
});

export { db as knex };