import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), document: text('document').notNull(), revision: integer('revision').notNull(), updatedAt: text('updated_at').notNull(),
});
export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(), name: text('name').notNull(), kind: text('kind').notNull(), mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(), sha256: text('sha256').notNull(), storageKey: text('storage_key').notNull(),
});
export const gameSaves = sqliteTable('game_saves', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), slot: text('slot').notNull(),
  revision: integer('revision').notNull(), document: text('document'), checksum: text('checksum'), updatedAt: text('updated_at').notNull(),
}, table => [index('idx_game_saves_project_id').on(table.projectId)]);

export const authorAccounts = sqliteTable('author_accounts', {
  projectId: text('project_id').primaryKey(), userId: text('user_id').notNull(),
});
export const publishedGames = sqliteTable('published_games', {
  projectId: text('project_id').primaryKey(), revision: integer('revision').notNull(), authorRevision: integer('author_revision').notNull(),
  document: text('document').notNull(), fingerprint: text('fingerprint').notNull(), publishedAt: text('published_at').notNull(),
});
export const playerSaves = sqliteTable('player_saves', {
  projectId: text('project_id').notNull(), userId: text('user_id').notNull(), slot: text('slot').notNull(),
  revision: integer('revision').notNull(), document: text('document'), checksum: text('checksum'), updatedAt: text('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.projectId, table.userId, table.slot] })]);
