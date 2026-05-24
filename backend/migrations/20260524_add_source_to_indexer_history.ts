import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('indexer_history', 'source');
  if (!hasCol) {
    await knex.schema.alterTable('indexer_history', (table) => {
      table.string('source').notNullable().defaultTo('prowlarr');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('indexer_history', (table) => {
    table.dropColumn('source');
  });
}
