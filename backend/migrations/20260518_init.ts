import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.string('id').primary();
    table.string('email').unique().notNullable();
    table.string('password').notNullable();
    table.enum('role', ['admin', 'user']).defaultTo('user');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('indexer_history', (table) => {
    table.increments('id').primary();
    table.string('indexer_id').notNullable();
    table.string('name').notNullable();
    table.enum('status', ['up', 'down']).notNullable();
    table.timestamp('last_checked').notNullable();
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('users');
  await knex.schema.dropTable('indexer_history');
}