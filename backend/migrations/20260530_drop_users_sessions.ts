import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('sessions')) {
    await knex.schema.dropTable('sessions');
  }
  if (await knex.schema.hasTable('users')) {
    await knex.schema.dropTable('users');
  }
}

export async function down(knex: Knex): Promise<void> {
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
}
