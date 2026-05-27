import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('alert_state');
  if (!exists) {
    await knex.schema.createTable('alert_state', (table) => {
      table.text('key').primary();
      table.bigInteger('down_since').notNullable();
      table.integer('alerted').notNullable().defaultTo(0);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('alert_state');
}
