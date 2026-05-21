import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('users'))) {
    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('username').notNullable().unique();
      table.string('email').notNullable().defaultTo('');
      table.string('password').notNullable();
      table.string('role').notNullable().defaultTo('user');
    });
  }

  if (!(await knex.schema.hasTable('sessions'))) {
    await knex.schema.createTable('sessions', (table) => {
      table.increments('id').primary();
      table.string('session_token').notNullable().unique();
      table.integer('user_id').notNullable().references('id').inTable('users');
      table.timestamp('expires_at').notNullable();
    });
  }

  if (!(await knex.schema.hasTable('indexer_history'))) {
    await knex.schema.createTable('indexer_history', (table) => {
      table.increments('id').primary();
      table.string('indexer_id').notNullable();
      table.string('name').notNullable();
      table.string('status').notNullable();
      table.timestamp('last_checked').notNullable();
    });
  }

  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_indexer_history_lookup ON indexer_history(indexer_id, last_checked)'
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('indexer_history');
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('users');
}
